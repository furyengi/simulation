import { type Instant } from '../time/instant';
import { arcsecToRad } from '../units';

/**
 * Earth Orientation Parameters (EOP) — the measured, irregular part of Earth's rotation.
 *
 * Source: IERS (EOP 14 C04 series and IERS Bulletin A predictions), as redistributed by CelesTrak
 * (`EOP-All.csv` / `EOP-Last5Years.csv`). Provenance and freshness are tracked by the data provider
 * in `@simulation/environment`; this module is pure and does no I/O.
 *
 * What is used:
 *   UT1−UTC  (s)       — drives Earth's rotation angle. |UT1−UTC| < 0.9 s by construction.
 *   xp, yp   (rad)     — polar motion (CIP offset in the ITRF).
 *   LOD      (s)       — excess length of day; scales the Earth rotation rate ω.
 *
 * What is NOT used in Phase 1: celestial-pole offsets (dX, dY / dψ, dε; ≲ 1 mas ≈ 3 cm at
 * the surface) and sub-daily ocean-tide / libration variations in UT1 and polar motion (≲ 0.1 ms
 * in UT1 ≈ 5 cm at the equator). Both are documented as accepted limitations (docs/reference-frames.md).
 */
export interface EarthOrientationParameters {
  /** UT1 − UTC, seconds. */
  readonly dut1S: number;
  /** Polar motion x-component, radians. */
  readonly xpRad: number;
  /** Polar motion y-component, radians. */
  readonly ypRad: number;
  /** Excess length of day, seconds. */
  readonly lodS: number;
}

export type EopQuality =
  /** Interpolated between two IERS-observed (final/rapid) daily values. */
  | 'OBSERVED'
  /** At least one bracketing value is an IERS prediction. */
  | 'PREDICTED'
  /** No EOP data covers this instant; zeros were substituted. Worst-case position error ≲ 450 m. */
  | 'UNAVAILABLE';

export interface EopLookup {
  readonly params: EarthOrientationParameters;
  readonly quality: EopQuality;
}

/** One daily row of the EOP series. Values are exactly as published (arcseconds / seconds). */
export interface EopRow {
  readonly mjd: number;
  readonly xpArcsec: number;
  readonly ypArcsec: number;
  readonly dut1S: number;
  readonly lodS: number;
  /** TAI − UTC, seconds. */
  readonly datS: number;
  readonly dataType: 'O' | 'P';
}

const UNIX_EPOCH_MJD = 40_587;
const MICROS_PER_DAY = 86_400_000_000;

export const mjdOf = (t: Instant): number => UNIX_EPOCH_MJD + t.unixMicros / MICROS_PER_DAY;

/**
 * A daily EOP series with linear interpolation.
 *
 * UT1−UTC jumps by 1 s at a leap second, which would corrupt naive interpolation across one. We
 * therefore interpolate UT1−TAI (= UT1−UTC − ΔAT), which is continuous, and convert back.
 */
export class EopTable {
  private constructor(private readonly rows: readonly EopRow[]) {}

  static fromRows(rows: readonly EopRow[]): EopTable {
    const sorted = [...rows].sort((a, b) => a.mjd - b.mjd);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.mjd === sorted[i - 1]!.mjd) throw new Error('EopTable: duplicate MJD rows');
    }
    return new EopTable(sorted);
  }

  /** An empty table: every lookup reports `UNAVAILABLE`. */
  static none(): EopTable {
    return new EopTable([]);
  }

  /**
   * Parse CelesTrak `EOP-*.csv`.
   * Header: `DATE,MJD,X,Y,UT1-UTC,LOD,DPSI,DEPS,DX,DY,DAT,DATA_TYPE` (X, Y in arcsec; UT1-UTC, LOD, DAT in s).
   */
  static parseCelestrakCsv(csv: string): EopTable {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const header = lines[0]?.split(',').map((h) => h.trim());
    if (!header) throw new Error('EOP CSV is empty');
    const col = (name: string): number => {
      const i = header.indexOf(name);
      if (i < 0) throw new Error(`EOP CSV is missing required column "${name}"`);
      return i;
    };
    const iMjd = col('MJD');
    const iX = col('X');
    const iY = col('Y');
    const iUt = col('UT1-UTC');
    const iLod = col('LOD');
    const iDat = col('DAT');
    const iType = col('DATA_TYPE');
    const rows: EopRow[] = [];
    for (const line of lines.slice(1)) {
      const f = line.split(',');
      const num = (i: number): number => Number(f[i]);
      const type = f[iType]?.trim();
      const row: EopRow = {
        mjd: num(iMjd),
        xpArcsec: num(iX),
        ypArcsec: num(iY),
        dut1S: num(iUt),
        lodS: num(iLod),
        datS: num(iDat),
        dataType: type === 'P' ? 'P' : 'O',
      };
      if ([row.mjd, row.xpArcsec, row.ypArcsec, row.dut1S, row.lodS, row.datS].some(Number.isNaN)) {
        continue; // skip malformed/blank rows rather than inventing values
      }
      rows.push(row);
    }
    return EopTable.fromRows(rows);
  }

  get size(): number {
    return this.rows.length;
  }
  get firstMjd(): number | undefined {
    return this.rows[0]?.mjd;
  }
  get lastMjd(): number | undefined {
    return this.rows[this.rows.length - 1]?.mjd;
  }
  /** MJD of the last row flagged as observed (`O`), i.e. where predictions begin. */
  get lastObservedMjd(): number | undefined {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]!.dataType === 'O') return this.rows[i]!.mjd;
    }
    return undefined;
  }

  lookup(t: Instant): EopLookup {
    const mjd = mjdOf(t);
    const rows = this.rows;
    if (rows.length === 0 || mjd < rows[0]!.mjd || mjd > rows[rows.length - 1]!.mjd) {
      return { params: { dut1S: 0, xpRad: 0, ypRad: 0, lodS: 0 }, quality: 'UNAVAILABLE' };
    }
    // Binary search for the bracketing pair.
    let lo = 0;
    let hi = rows.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]!.mjd <= mjd) lo = mid;
      else hi = mid;
    }
    const a = rows[lo]!;
    const b = rows[Math.min(lo + 1, rows.length - 1)]!;
    const w = b.mjd === a.mjd ? 0 : (mjd - a.mjd) / (b.mjd - a.mjd);
    const lerp = (x: number, y: number): number => x + (y - x) * w;

    // Interpolate UT1−TAI (continuous), then convert to UT1−UTC with the interpolated ΔAT step
    // of the bracket's *later* end if the two differ (leap second inside the bracket).
    const ut1Tai = lerp(a.dut1S - a.datS, b.dut1S - b.datS);
    const datHere = w < 1 ? a.datS : b.datS;
    const dut1S = ut1Tai + datHere;

    return {
      params: {
        dut1S,
        xpRad: arcsecToRad(lerp(a.xpArcsec, b.xpArcsec)),
        ypRad: arcsecToRad(lerp(a.ypArcsec, b.ypArcsec)),
        lodS: lerp(a.lodS, b.lodS),
      },
      quality: a.dataType === 'O' && b.dataType === 'O' ? 'OBSERVED' : 'PREDICTED',
    };
  }
}

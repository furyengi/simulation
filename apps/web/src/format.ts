/** Formatting for an engineering display: fixed precision, explicit units, no rounding surprises. */

export const DEG = 180 / Math.PI;

/** `2026-09-30 17:04:12.345 UTC` from an ISO-8601 UTC string or unix ms. */
export function fmtUtc(v: string | number): string {
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().replace('T', ' ').replace('Z', '')} UTC`;
}

export const fmtUtcMs = (ms: number): string => fmtUtc(Math.round(ms));

export function fmtNum(v: number | null | undefined, digits = 3, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

export function fmtSci(v: number | null | undefined, digits = 3, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toExponential(digits)}${unit ? ` ${unit}` : ''}`;
}

export function fmtKm(m: number, digits = 3): string {
  return `${(m / 1000).toFixed(digits)} km`;
}

export function fmtLatLon(latDeg: number, lonDeg: number, digits = 4): string {
  const ns = latDeg >= 0 ? 'N' : 'S';
  const ew = lonDeg >= 0 ? 'E' : 'W';
  return `${Math.abs(latDeg).toFixed(digits)}° ${ns}, ${Math.abs(lonDeg).toFixed(digits)}° ${ew}`;
}

/** Human-readable duration with sign: `+3 d 04:12:05` / `−00:35:12`. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const sign = seconds < 0 ? '−' : '+';
  let s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${sign}${d ? `${d} d ` : ''}${hh}:${mm}:${ss}`;
}

export function fmtRate(rate: number): string {
  return rate === 1
    ? '1× real time'
    : `${rate.toLocaleString('en-US', { maximumFractionDigits: 3 })}×`;
}

export function fmtVec(v: readonly number[], unit: string, digits = 3): string {
  return `[${v.map((x) => x.toFixed(digits)).join(', ')}] ${unit}`;
}

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareWithHorizons } from './horizons';

const ref = (name: string): string =>
  fileURLToPath(new URL(`./reference/${name}`, import.meta.url));

// Supported simulation range starts 1972; the Horizons tables run 1900–2100.
const FROM = '1972-01-01T00:00:00Z';
const TO = '2099-12-31T00:00:00Z';

describe('Sun and Moon vs JPL Horizons (DE431mx), topocentric ICRF astrometric RA/Dec', () => {
  it('Sun', () => {
    const c = compareWithHorizons('sun', ref('Horizons_Sun.txt'), FROM, TO);
    expect(c.count).toBeGreaterThan(4000);
    // Claimed accuracy of the theory: ~1 arcminute. The measured value is far better; the bound
    // below is the CLAIM being verified, not a fitted tolerance.
    expect(c.maxArcsec).toBeLessThan(60);
    // Regression guard at the measured behaviour (max 2.77″, mean 0.77″ on 2026-09-30).
    expect(c.maxArcsec).toBeLessThan(3.5);
    expect(c.meanArcsec).toBeLessThan(1.2);
  });

  it('Moon', () => {
    const c = compareWithHorizons('moon', ref('Horizons_Moon.txt'), FROM, TO);
    expect(c.count).toBeGreaterThan(4000);
    expect(c.maxArcsec).toBeLessThan(60);
    // Regression guard at the measured behaviour (max 23.5″, mean 13.2″ on 2026-09-30).
    expect(c.maxArcsec).toBeLessThan(30);
    expect(c.meanArcsec).toBeLessThan(16);
  });
});

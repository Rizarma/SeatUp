import { describe, it, expect } from 'vitest';
import { getGridLevels, minorOpacity } from './grid';

describe('getGridLevels (infinite grid ala Miro)', () => {
  it('zoom pas venue (vb 1200): major 40, minor 8', () => {
    const g = getGridLevels(1200);
    expect(g.major).toBeCloseTo(40, 6);
    expect(g.minor).toBeCloseTo(8, 6);
  });

  it('zoom-in 5x (vb 240): level turun satu tingkat', () => {
    const g = getGridLevels(240);
    expect(g.major).toBeCloseTo(8, 6);
    expect(g.minor).toBeCloseTo(1.6, 6);
  });

  it('minor menegas saat zoom-in (alpha naik)', () => {
    const wide = getGridLevels(2000); // lebih zoom-out
    const tight = getGridLevels(600); // lebih zoom-in, level sama (p=0)
    expect(tight.power).toBe(wide.power);
    expect(tight.minorAlpha).toBeGreaterThan(wide.minorAlpha);
  });

  it('promosi level kontinu: major baru == minor lama', () => {
    // batas level p=0 <-> p=-1 ada di vb=500 (Lc=0)
    const before = getGridLevels(501);
    const after = getGridLevels(499);
    if (before.power !== after.power) {
      // minor lama (alpha~1) menjadi major baru
      expect(after.major).toBeCloseTo(before.minor, 6);
    } else {
      expect(after.major).toBeCloseTo(before.major, 6);
    }
  });

  it('minorOpacity monoton naik dan terbatas max', () => {
    expect(minorOpacity(0)).toBe(0);
    expect(minorOpacity(1)).toBeCloseTo(0.85, 6);
    expect(minorOpacity(0.5)).toBeGreaterThan(0);
    expect(minorOpacity(0.5)).toBeLessThan(minorOpacity(1));
  });

  it('tahan terhadap vb aneh', () => {
    for (const w of [0, -10, NaN, Infinity, 2, 100000]) {
      const g = getGridLevels(w);
      expect(Number.isFinite(g.major)).toBe(true);
      expect(Number.isFinite(g.minor)).toBe(true);
      expect(g.minorAlpha).toBeGreaterThanOrEqual(0);
      expect(g.minorAlpha).toBeLessThanOrEqual(1);
    }
  });
});

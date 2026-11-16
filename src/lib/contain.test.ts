import { describe, it, expect } from 'vitest';
import {
  SEAT_R, flattenPath, isClosedPath, pointInside, discInside, classifySeats, sectionGeomFor, revalidateSeats,
} from './contain';
import type { VenueObject } from './venue';
import { makeObject } from './venue';
import type { Pt } from './venue';

const sq = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function secObj(ring: Pt[], rule: 'evenodd' | 'nonzero' = 'evenodd'): VenueObject {
  void rule;
  const o = makeObject({ kind: 'section', label: 'S' });
  o.isSection = true;
  o.points = ring;
  return o;
}

describe('isClosedPath', () => {
  it('subpath tanpa Z = terbuka', () => {
    expect(isClosedPath('M0 0H10V10')).toBe(false);
    expect(isClosedPath('M0 0H10V10H0Z')).toBe(true);
    expect(isClosedPath('M0 0H10V10H0Z M20 20H30V30')).toBe(false);
    expect(isClosedPath('M0 0H10V10H0Z M20 20H30V30H20Z')).toBe(true);
  });
});

describe('flattenPath', () => {
  it('kurva kubik di-flatten mendekati garis lurus', () => {
    const rings = flattenPath('M0 0C10 0 10 0 20 0Z');
    expect(rings.length).toBe(1);
    const ys = rings[0].map((p) => p[1]);
    expect(Math.max(...ys.map(Math.abs))).toBeLessThanOrEqual(0.5 + 1e-9);
  });
  it('busur A menghasilkan banyak segmen (sweep=1 -> -y sesuai spec SVG)', () => {
    const rings = flattenPath('M0 0A50 50 0 0 1 100 0Z');
    expect(rings[0].length).toBeGreaterThan(6);
    const xs = rings[0].map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(100, 0);
    const ys = rings[0].map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-50, 0);
  });
  it('lubang donat evenodd: tengah di luar', () => {
    const d = 'M0 0H100V100H0Z M30 30H70V70H30Z';
    const sec = { rings: flattenPath(d), rule: 'evenodd' as const };
    expect(pointInside(10, 10, sec)).toBe(true);
    expect(pointInside(50, 50, sec)).toBe(false);
    const nz = { rings: flattenPath(d), rule: 'nonzero' as const };
    // kedua subpath searah -> lubang tertutup (winding 2)
    expect(pointInside(50, 50, nz)).toBe(true);
  });
});

describe('discInside (footprint, bukan pusat)', () => {
  const sec = { rings: [sq(0, 0, 100, 100)], rule: 'evenodd' as const };
  it('pusat di dalam tapi cakram keluar = ditolak', () => {
    expect(pointInside(96, 50, sec)).toBe(true);
    expect(discInside(96, 50, SEAT_R, sec)).toBe(false);
    expect(discInside(90, 50, SEAT_R, sec)).toBe(true);
  });
  it('cekung: pusat di cekungan = di luar', () => {
    const c: Pt[] = [[0, 0], [100, 0], [100, 100], [60, 100], [60, 40], [40, 40], [40, 100], [0, 100]];
    const cs = { rings: [c], rule: 'evenodd' as const };
    expect(pointInside(50, 60, cs)).toBe(false);
    expect(discInside(50, 60, SEAT_R, cs)).toBe(false);
    expect(discInside(20, 60, SEAT_R, cs)).toBe(true);
  });
});

describe('classifySeats + sectionGeomFor', () => {
  it('vektor busur + transform skala diikuti', () => {
    const o = makeObject({ kind: 'vector', label: 'V' });
    o.isSection = true;
    o.d = 'M0 0A50 50 0 0 1 100 0Z';
    o.vTransform = { tx: 10, ty: 20, scale: 2 };
    o.svgFillRule = 'nonzero';
    const g = sectionGeomFor(o);
    expect(g).not.toBeNull();
    // busur setengah lingkaran r=50 skala 2 di atas chord (y<=0 path)
    const xs = g!.rings[0].map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(210, 0);
    const ok = classifySeats([{ x: 110, y: 0 }, { x: 110, y: 40 }], g!);
    expect(ok).toEqual([true, false]);
  });
  it('lubang SVG menolak kursi di atas lubang', () => {
    const o = makeObject({ kind: 'vector', label: 'V' });
    o.isSection = true;
    o.d = 'M0 0H100V100H0Z M40 40H60V60H40Z';
    o.svgFillRule = 'evenodd';
    const g = sectionGeomFor(o)!;
    const ok = classifySeats([{ x: 10, y: 10 }, { x: 50, y: 50 }], g);
    expect(ok).toEqual([true, false]);
  });
  it('bukan section -> null; open path tetap geometri tapi bukan section default', () => {
    const o = makeObject({ kind: 'vector', label: 'V' });
    o.d = 'M0 0H10';
    expect(sectionGeomFor(o)).toBeNull();
    expect(isClosedPath(o.d)).toBe(false);
  });
});

describe('revalidateSeats', () => {
  it('kursi keluar setelah section digeser -> invalid; kembali -> valid', () => {
    const s = secObj(sq(0, 0, 100, 100));
    s.id = 'sec-1';
    const r = makeObject({ kind: 'row-straight', label: 'R' });
    r.sectionId = 'sec-1';
    r.seats = [
      { id: 'a', row: 'A', number: '1', x: 50, y: 50, status: 'available', price: 0, sectionId: 'sec-1' },
      { id: 'b', row: 'A', number: '2', x: 150, y: 50, status: 'available', price: 0, sectionId: 'sec-1' },
    ];
    const v1 = revalidateSeats([s, r]);
    expect(v1.objects[1].seats[0].invalid).toBe(false);
    expect(v1.objects[1].seats[1].invalid).toBe(true);
    expect(v1.invalidCount).toBe(1);
    // section hilang -> semua invalid
    const v2 = revalidateSeats([r]);
    expect(v2.objects[0].seats.every((x) => x.invalid)).toBe(true);
  });
});

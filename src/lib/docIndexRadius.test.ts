import { describe, expect, it } from 'vitest';
import { emptyVenue } from './venue';
import type { Seat, VenueObject } from './venue';
import { getDocIndex, queryBox, queryBoxVisible, queryPoint, type DocIndex } from './docIndex';

function docMixed(): ReturnType<typeof emptyVenue> {
  const base = emptyVenue();
  const section: VenueObject = {
    id: 's', kind: 'section', label: 'S',
    points: [[-2000, -2000], [3000, -2000], [3000, 2000], [-2000, 2000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: base.categories[0].id,
  };
  const mk = (id: string, x: number, y: number, radius: number): Seat => ({
    id, row: 'A', number: id, x, y, status: 'available' as const, price: 0, sectionId: 's', radius,
  });
  const row: VenueObject = {
    id: 'r', kind: 'row-straight', label: 'R', points: [[0, 0]], closed: false,
    width: 28, price: 0, rowParams: null, sectionId: 's',
    seats: [
      mk('big', 0, 0, 100),
      mk('far', 1000, 0, 8),
      mk('small', 80, 0, 8),
      mk('neg', -1500, -1200, 8),
    ],
    source: { origin: 'canvas', confidence: 1 }, guess: null,
  };
  return { ...base, objects: [section, row] };
}

function brutePoint(idx: DocIndex, x: number, y: number, r: number): string | null {
  const pad = Math.max(r, 2);
  let best: string | null = null;
  let bestD = Infinity;
  for (const ref of idx.allSeats) {
    const s = ref.seat;
    const tol = (s.radius ?? 8) + pad;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= tol && d < bestD) { best = s.id; bestD = d; }
  }
  return best;
}

function docRepro(): ReturnType<typeof emptyVenue> {
  const base = emptyVenue();
  const section: VenueObject = {
    id: 's', kind: 'section', label: 'S',
    points: [[-2000, -2000], [3000, -2000], [3000, 2000], [-2000, 2000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: base.categories[0].id,
  };
  const row: VenueObject = {
    id: 'r', kind: 'row-straight', label: 'R', points: [[0, 0]], closed: false,
    width: 28, price: 0, rowParams: null, sectionId: 's',
    seats: [
      { id: 'big', row: 'A', number: '1', x: 0, y: 0, status: 'available' as const, price: 0, sectionId: 's', radius: 100 },
      { id: 'far', row: 'A', number: '2', x: 1000, y: 0, status: 'available' as const, price: 0, sectionId: 's', radius: 8 },
    ],
    source: { origin: 'canvas', confidence: 1 }, guess: null,
  };
  return { ...base, objects: [section, row] };
}

describe('hit-test radius besar (temuan #6, jalur produksi)', () => {
  it('reproduksi: seat radius 100 di (0,0) + seat di (1000,0) → query (80,0) = big', () => {
    const idx = getDocIndex(docRepro());
    // Titik di dalam lingkaran visual (radius 100) meskipun sel grid ~24.
    const hit = queryPoint(idx, 80, 0, 8);
    expect(hit?.seat.id).toBe('big');
  });

  it('pusat, tepi visual, dan luar toleransi (tanpa pengecoh dekat)', () => {
    const idx = getDocIndex(docRepro());
    expect(queryPoint(idx, 0, 0, 8)?.seat.id).toBe('big');
    // Tepi: jarak 95 dari pusat big (radius 100 + pad 8 = 108) → hit.
    expect(queryPoint(idx, 95, 0, 8)?.seat.id).toBe('big');
    // Luar: jarak 200 → di luar jangkauan big, kandidat terdekat bukan big.
    const far = queryPoint(idx, 250, 0, 8);
    expect(far).toBeNull();
  });

  it('campuran radius & bertumpuk: mengikuti aturan pusat-terdekat', () => {
    const idx = getDocIndex(docMixed());
    // (80,0): big jarak 80, small jarak 0 → small menang (pusat terdekat).
    expect(queryPoint(idx, 80, 0, 8)?.seat.id).toBe('small');
    // (40,0): big 40 vs small 40 → seri; salah satu, tapi konsisten dengan brute force.
    const got = queryPoint(idx, 40, 0, 8)?.seat.id;
    expect(got).toBe(brutePoint(idx, 40, 0, 8));
  });

  it('oracle brute-force deterministik pada grid campuran', () => {
    const idx = getDocIndex(docMixed());
    const pts: Array<[number, number]> = [[0, 0], [80, 0], [1000, 0], [-1500, -1200], [500, 500], [90, 10]];
    for (const [x, y] of pts) {
      expect(queryPoint(idx, x, y, 8)?.seat.id ?? null).toBe(brutePoint(idx, x, y, 8));
    }
  });

  it('culling viewport: seat besar tetap terlihat bila bentuk menyentuh viewport', () => {
    const idx = getDocIndex(docMixed());
    const out: ReturnType<typeof queryBoxVisible> = [];
    // Viewport jauh dari pusat big (200..400) tetapi lingkaran radius 100 dari x=0 tak menyentuh → kosong.
    queryBoxVisible(idx, 200, -50, 400, 50, out);
    expect(out.find((r) => r.seat.id === 'big')).toBeUndefined();
    // Viewport 50..300: lingkaran big (hingga x=100) menyentuh → big ikut.
    queryBoxVisible(idx, 50, -50, 300, 50, out);
    expect(out.find((r) => r.seat.id === 'big')).toBeDefined();
  });

  it('marquee tetap pusat-dalam-kotak (tak melebar oleh radius besar)', () => {
    const idx = getDocIndex(docMixed());
    const out = queryBox(idx, 50, -50, 300, 50, []);
    // big pusat (0,0) di luar kotak → tidak ikut marquee.
    expect(out.find((r) => r.seat.id === 'big')).toBeUndefined();
    expect(out.find((r) => r.seat.id === 'small')).toBeDefined();
  });
});

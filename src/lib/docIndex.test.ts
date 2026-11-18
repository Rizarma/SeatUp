import { describe, expect, it } from 'vitest';
import { emptyVenue } from './venue';
import type { VenueObject } from './venue';
import { getDocIndex, queryBox, queryPoint } from './docIndex';

function docWithSeats(coords: Array<[number, number]>): ReturnType<typeof emptyVenue> {
  const base = emptyVenue();
  const section: VenueObject = {
    id: 's', kind: 'section', label: 'S', points: [[-100000, -100000], [100000, -100000], [100000, 100000], [-100000, 100000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: base.categories[0].id,
  };
  const row: VenueObject = {
    id: 'r', kind: 'row-straight', label: 'R', points: [[0, 0]], closed: false,
    width: 28, price: 0, rowParams: null, sectionId: 's',
    seats: coords.map(([x, y], i) => ({
      id: `seat-${i}`, row: 'A', number: String(i + 1), x, y,
      status: 'available' as const, price: 0, sectionId: 's', radius: 8,
    })),
    source: { origin: 'canvas', confidence: 1 }, guess: null,
  };
  return { ...base, objects: [section, row] };
}

describe('docIndex grid mencakup seluruh seat (temuan #6)', () => {
  it('reproduksi: seat (0,0) dan (20000,0) keduanya ter-query', () => {
    const doc = docWithSeats([[0, 0], [20000, 0]]);
    const idx = getDocIndex(doc);
    expect(idx.grid.cols).toBeLessThanOrEqual(512);
    expect(idx.grid.rows).toBeLessThanOrEqual(512);
    const a = queryPoint(idx, 0, 0, 10);
    const b = queryPoint(idx, 20000, 0, 10);
    expect(a?.seat.id).toBe('seat-0');
    expect(b?.seat.id).toBe('seat-1');
    const box = queryBox(idx, 19990, -10, 20010, 10, []);
    expect(box.map((r) => r.seat.id)).toEqual(['seat-1']);
  });

  it('layout horizontal panjang: semua seat ter-query via oracle brute-force', () => {
    const coords: Array<[number, number]> = [];
    for (let i = 0; i < 200; i++) coords.push([i * 150, 0]);
    const doc = docWithSeats(coords);
    const idx = getDocIndex(doc);
    for (let i = 0; i < coords.length; i++) {
      const [x, y] = coords[i];
      const hit = queryPoint(idx, x, y, 10);
      expect(hit?.seat.id).toBe(`seat-${i}`);
    }
    const all = queryBox(idx, -100, -100, 30000, 100, []);
    expect(all.length).toBe(200);
  });

  it('negatif, sparse, outlier jauh tetap tercakup', () => {
    const doc = docWithSeats([[-5000, -3000], [0, 0], [90000, 40000]]);
    const idx = getDocIndex(doc);
    expect(queryPoint(idx, -5000, -3000, 10)?.seat.id).toBe('seat-0');
    expect(queryPoint(idx, 90000, 40000, 10)?.seat.id).toBe('seat-2');
    const box = queryBox(idx, 89990, 39990, 90010, 40010, []);
    expect(box.length).toBe(1);
  });

  it('dokumen kosong dan satu seat', () => {
    const empty = emptyVenue();
    const idxEmpty = getDocIndex(empty);
    expect(queryPoint(idxEmpty, 0, 0, 10)).toBeNull();
    expect(queryBox(idxEmpty, 0, 0, 10, 10, []).length).toBe(0);
    const one = docWithSeats([[5, 5]]);
    const idxOne = getDocIndex(one);
    expect(queryPoint(idxOne, 5, 5, 10)?.seat.id).toBe('seat-0');
  });

  it('seat tepat pada batas sel dan extent tidak hilang', () => {
    const doc = docWithSeats([[0, 0], [100, 0], [200, 0]]);
    const idx = getDocIndex(doc);
    // query kecil di sekitar tiap seat harus tepat satu
    for (const x of [0, 100, 200]) {
      const box = queryBox(idx, x - 1, -1, x + 1, 1, []);
      expect(box.length).toBe(1);
    }
  });
});

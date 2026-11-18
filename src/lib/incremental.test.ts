import { describe, expect, it } from 'vitest';
import { revalidateSeats, revalidateSeatsIncremental } from './contain';
import { emptyVenue } from './venue';
import type { VenueObject } from './venue';

function doc2(): VenueObject[] {
  const base = emptyVenue();
  const section: VenueObject = {
    id: 's', kind: 'section', label: 'S', points: [[0, 0], [500, 0], [500, 400], [0, 400]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: base.categories[0].id,
  };
  const row: VenueObject = {
    id: 'r', kind: 'row-straight', label: 'R', points: [[10, 10]], closed: false,
    width: 28, price: 0, rowParams: null, sectionId: 's',
    seats: Array.from({ length: 20 }, (_, i) => ({
      id: `seat-${i}`, row: 'A', number: String(i + 1), x: 20 + i * 20, y: 50,
      status: 'available' as const, price: 0, sectionId: 's', radius: 8,
    })),
    source: { origin: 'canvas', confidence: 1 }, guess: null,
  };
  return [section, row];
}

describe('revalidateSeatsIncremental', () => {
  it('identik dengan versi penuh saat edit label saja (tanpa gerak)', () => {
    const prev = revalidateSeats(doc2()).objects;
    const next = prev.map((o) => o.id === 'r'
      ? { ...o, seats: o.seats.map((s) => ({ ...s, row: 'Z' })) }
      : o);
    const inc = revalidateSeatsIncremental(prev, next);
    const full = revalidateSeats(next);
    expect(inc.objects.map((o) => o.seats.map((s) => s.invalid))).toEqual(
      full.objects.map((o) => o.seats.map((s) => s.invalid)));
    expect(inc.invalidCount).toBe(full.invalidCount);
    // baris tak tersentuh mempertahankan referensi
    expect(inc.objects[0]).toBe(next[0]);
  });
  it('mendeteksi seat yang digeser keluar section', () => {
    const prev = revalidateSeats(doc2()).objects;
    const next = prev.map((o) => o.id === 'r'
      ? { ...o, seats: o.seats.map((s, i) => (i === 0 ? { ...s, x: 9000, y: 9000 } : s)) }
      : o);
    const inc = revalidateSeatsIncremental(prev, next);
    expect(inc.objects[1].seats[0].invalid).toBe(true);
    expect(inc.objects[1].seats[1].invalid).toBe(false);
    expect(inc.invalidCount).toBe(1);
  });
  it('tanpa perubahan mengembalikan referensi sama', () => {
    const prev = revalidateSeats(doc2()).objects;
    const inc = revalidateSeatsIncremental(prev, prev);
    expect(inc.objects).toBe(prev);
  });
});

import { describe, expect, it } from 'vitest';
import { arcSeats, straightSeats } from './venue';
import { buildSectionSummaryPath, groupRowSeats, orderSeatsPhysically, splitRowSegments } from './rowSummary';
import type { SeatRef } from './docIndex';

function ref(objId: string, row: string, num: string, x: number, y: number, invalid = false): SeatRef {
  return {
    objId,
    seat: { id: `${objId}-${row}-${num}`, row, number: num, x, y, status: 'available', price: 0, sectionId: 'sec', invalid: invalid || undefined },
  };
}

describe('groupRowSeats', () => {
  it('grup per (objId,row); label sama di objek lain terpisah', () => {
    const refs = [ref('o1', 'A', '1', 0, 0), ref('o1', 'A', '2', 26, 0), ref('o2', 'A', '1', 0, 100), ref('o1', 'B', '1', 0, 34)];
    const g = groupRowSeats(refs);
    expect(g).toHaveLength(3);
    expect(g.find((x) => x.objId === 'o1' && x.row === 'A')?.seats).toHaveLength(2);
  });
  it('invalid disaring; section kosong -> polos', () => {
    expect(groupRowSeats([ref('o1', 'A', '1', 0, 0, true)])).toHaveLength(0);
    expect(buildSectionSummaryPath([]).d).toBe('');
  });
});

describe('orderSeatsPhysically', () => {
  it('lurus teracak tetap berurutan', () => {
    const seats = [ref('o', 'A', '3', 52, 0), ref('o', 'A', '1', 0, 0), ref('o', 'A', '2', 26, 0)].map((r) => r.seat);
    expect(orderSeatsPhysically(seats).map((s) => s.number)).toEqual(['1', '2', '3']);
  });
  it('diagonal teracak tetap berurutan', () => {
    const gen = straightSeats([0, 0], 45, 1, 5, 26, 34, 0);
    const seats = gen.map((s, i) => ({ id: `s${i}`, row: s.row, number: s.number, x: s.x, y: s.y, status: 'available' as const, price: 0, sectionId: 'sec' }));
    const shuffled = [seats[3], seats[0], seats[4], seats[1], seats[2]];
    const ordered = orderSeatsPhysically(shuffled);
    // Ujung-ke-ujung: x monoton (diagonal 45° naik).
    for (let i = 1; i < ordered.length; i++) expect(ordered[i].x).toBeGreaterThan(ordered[i - 1].x);
  });
  it('busur U mengikuti lengkung (bukan sort-x)', () => {
    const gen = arcSeats([0, 0], 100, 20, 0, 180, 1, 9, 0);
    const seats = gen.map((s, i) => ({ id: `a${i}`, row: s.row, number: s.number, x: s.x, y: s.y, status: 'available' as const, price: 0, sectionId: 'sec' }));
    const shuffled = [...seats].reverse();
    const ordered = orderSeatsPhysically(shuffled);
    // Adjacent harus tetangga busur (jarak chord kecil), bukan lompat antar lengan.
    for (let i = 1; i < ordered.length; i++) {
      expect(Math.hypot(ordered[i].x - ordered[i - 1].x, ordered[i].y - ordered[i - 1].y)).toBeLessThan(60);
    }
  });
});

describe('splitRowSegments', () => {
  it('putus di lorong (celah >> spasi)', () => {
    const seats = [
      ref('o', 'A', '1', 0, 0).seat,
      ref('o', 'A', '2', 26, 0).seat,
      ref('o', 'A', '3', 52, 0).seat,
      ref('o', 'A', '4', 152, 0).seat,
      ref('o', 'A', '5', 178, 0).seat,
    ];
    const segs = splitRowSegments(seats);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(3);
    expect(segs[1]).toHaveLength(2);
  });
  it('toleran jitter kecil dalam baris', () => {
    const seats = [0, 26.3, 51.8, 78.1].map((x, i) => ref('o', 'A', String(i + 1), x, 0.4 * i).seat);
    expect(splitRowSegments(seats)).toHaveLength(1);
  });
});

describe('buildSectionSummaryPath', () => {
  it('satu kursi -> dot; baris -> satu subpath', () => {
    const single = buildSectionSummaryPath([ref('o', 'A', '1', 10, 20)]);
    expect(single.d).toContain('M 10 20');
    expect(single.segments).toBe(1);
    const row = buildSectionSummaryPath([ref('o', 'A', '1', 0, 0), ref('o', 'A', '2', 26, 0)]);
    expect(row.d).toContain('L 26 0');
  });
  it('offset drag menggeser path', () => {
    const refs = [ref('o', 'A', '1', 0, 0), ref('o', 'A', '2', 26, 0)];
    const moved = buildSectionSummaryPath(refs, [10, 5]);
    expect(moved.d).toContain('M 10 5');
    expect(moved.d).toContain('L 36 5');
  });
});

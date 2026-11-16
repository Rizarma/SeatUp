import { describe, it, expect } from 'vitest';
import {
  labelAt, straightSeats, arcSeats, douglasPeucker, polygonArea, sampleVenue,
} from './venue';
import type { Pt } from './venue';
import { validateVenueDoc } from './validate';

describe('labelAt', () => {
  it('A..Z lalu AA', () => {
    expect(labelAt(0)).toBe('A');
    expect(labelAt(25)).toBe('Z');
    expect(labelAt(26)).toBe('AA');
  });
});

describe('straightSeats', () => {
  it('baris lurus horizontal', () => {
    const seats = straightSeats([100, 200], 0, 2, 3, 26, 30, 0);
    expect(seats).toHaveLength(6);
    expect(seats[0]).toMatchObject({ row: 'A', number: '1', x: 100, y: 200 });
    expect(seats[2]).toMatchObject({ row: 'A', number: '3', x: 152, y: 200 });
    expect(seats[3]).toMatchObject({ row: 'B', number: '1', x: 100, y: 230 });
  });
  it('rotasi 90 derajat mengarah ke bawah (y SVG)', () => {
    const seats = straightSeats([0, 0], 90, 1, 2, 10, 10, 0);
    expect(seats[1].x).toBeCloseTo(0, 5);
    expect(seats[1].y).toBeCloseTo(10, 5);
  });
});

describe('arcSeats', () => {
  it('busur simetris di tengah span', () => {
    const seats = arcSeats([600, 400], 200, 30, 0, 180, 1, 5, 0);
    expect(seats).toHaveLength(5);
    // tengah span = 90deg -> tepat di bawah pusat
    expect(seats[2].x).toBeCloseTo(600, 5);
    expect(seats[2].y).toBeCloseTo(600, 5);
    // ujung di kiri-kanan pusat
    expect(seats[0].x).toBeCloseTo(800, 5);
    expect(seats[4].x).toBeCloseTo(400, 5);
  });
  it('baris konsentris bertambah radius', () => {
    const seats = arcSeats([0, 0], 100, 20, 90, 0, 2, 1, 0);
    expect(seats[0].y).toBeCloseTo(100, 5);
    expect(seats[1].y).toBeCloseTo(120, 5);
  });
});

describe('douglasPeucker', () => {
  it('mereduksi garis lurus ber-noise kecil', () => {
    const pts: Pt[] = [[0, 0], [10, 0.5], [20, -0.5], [30, 0.3], [40, 0]];
    expect(douglasPeucker(pts, 1)).toEqual([[0, 0], [40, 0]]);
  });
  it('mempertahankan sudut tajam', () => {
    const pts: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(douglasPeucker(pts, 1)).toHaveLength(4);
  });
});

describe('polygonArea', () => {
  it('persegi 10x10 = 100', () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
  });
});

describe('sampleVenue', () => {
  it('lolos validasi skema', () => {
    const v = validateVenueDoc(JSON.parse(JSON.stringify(sampleVenue())));
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it('punya stage + row melengkung berisi kursi', () => {
    const doc = sampleVenue();
    const arc = doc.objects.find((o) => o.kind === 'row-arc');
    expect(arc).toBeDefined();
    expect(arc?.seats.length).toBe(3 * 14);
  });
});

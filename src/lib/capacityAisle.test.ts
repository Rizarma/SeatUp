import { describe, expect, it } from 'vitest';
import { __capacityCacheSizeForTest, __clearCapacityCacheForTest, estimateCapacity } from './capacity';
import type { SectionGeom } from './contain';
import type { VenueObject } from './venue';

const geom: SectionGeom = { rings: [[[0, 0], [100, 0], [100, 100], [0, 100]]], rule: 'evenodd' };

function aisle(id: string, x: number, width = 30): VenueObject {
  return {
    id, kind: 'aisle', label: 'Lorong', points: [[x, 0], [x, 100]], closed: false,
    width, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null,
  } as VenueObject;
}

describe('capacity cache invalidasi geometri lorong (temuan #8)', () => {
  it('reproduksi: geser lorong x=0 -> x=50 mengubah total (bukan cached lama)', () => {
    __clearCapacityCacheForTest();
    const a0 = estimateCapacity(geom, 26, 34, 8, [aisle('a', 0)], 0);
    const fresh = estimateCapacity({ rings: [[[0, 0], [100, 0], [100, 100], [0, 100]]], rule: 'evenodd' }, 26, 34, 8, [aisle('a', 50)], 0);
    const moved = estimateCapacity(geom, 26, 34, 8, [aisle('a', 50)], 0);
    expect(moved.total).toBe(fresh.total);
    // Lorong di tepi vs tengah memberi total berbeda pada section 100x100
    expect(moved.total).not.toBe(a0.total);
  });

  it('ubah titik ujung, width, rotation, tambah, hapus menginvalidasi', () => {
    __clearCapacityCacheForTest();
    const base = estimateCapacity(geom, 26, 34, 8, [aisle('a', 47)], 0).total;
    // Pendekkan lorong (hanya 10px di atas) agar jelas membuka slot bawah
    const movedEnd: VenueObject = { ...aisle('a', 47), points: [[47, 0], [47, 10]] };
    expect(estimateCapacity(geom, 26, 34, 8, [movedEnd], 0).total).not.toBe(base);
    // width 30 -> 10 membuka kolom (13 >= 8+5 jelas)
    expect(estimateCapacity(geom, 26, 34, 8, [{ ...aisle('a', 47), width: 10 }], 0).total).not.toBe(base);
    // rotation 90°: vertikal -> horizontal, blokir baris bukan kolom
    expect(estimateCapacity(geom, 26, 34, 8, [{ ...aisle('a', 47), rotation: 90 }], 0).total).not.toBe(base);
    expect(estimateCapacity(geom, 26, 34, 8, [aisle('a', 47), aisle('b', 80)], 0).total).not.toBe(base);
    expect(estimateCapacity(geom, 26, 34, 8, [], 0).total).not.toBe(base);
  });

  it('existing seat hanya mengubah remaining, total geometri sama (cached)', () => {
    __clearCapacityCacheForTest();
    const e0 = estimateCapacity(geom, 26, 34, 8, [aisle('a', 20)], 0);
    const e5 = estimateCapacity(geom, 26, 34, 8, [aisle('a', 20)], 5);
    expect(e5.total).toBe(e0.total);
    expect(e5.remaining).toBe(Math.max(0, e0.total - 5));
  });

  it('label saja tidak memicu hitung ulang (hit cache)', () => {
    __clearCapacityCacheForTest();
    const e1 = estimateCapacity(geom, 26, 34, 8, [aisle('a', 20)], 0);
    // Geometri identik, objek berbeda referensi (simulasi edit label)
    const sameGeom: SectionGeom = { rings: [[[0, 0], [100, 0], [100, 100], [0, 100]]], rule: 'evenodd' };
    const e2 = estimateCapacity(sameGeom, 26, 34, 8, [aisle('a', 20)], 0);
    expect(e2.total).toBe(e1.total);
  });

  it('cache tidak tumbuh tanpa batas selama banyak edit', () => {
    __clearCapacityCacheForTest();
    for (let i = 0; i < 300; i++) {
      estimateCapacity(geom, 26, 34, 8, [aisle(`a${i}`, i)], 0);
    }
    expect(__capacityCacheSizeForTest()).toBeLessThanOrEqual(128);
  });
});

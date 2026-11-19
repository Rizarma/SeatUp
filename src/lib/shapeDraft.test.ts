import { describe, expect, it } from 'vitest';
import {
  buildShapeObject,
  ghostKindForTool,
  isDragGesture,
  isShapeTool,
  toolForGhostKind,
} from './shapeDraft';

const OPTS = { aisleWidth: 28, objectCount: 0 };

describe('shapeDraft geometry (dipakai kedua gesture)', () => {
  it('stage & rectangle memakai dua sudut berlawanan', () => {
    const a: [number, number] = [10, 20];
    const b: [number, number] = [60, 80];
    const rect = buildShapeObject('rect', a, b, OPTS);
    expect(rect).not.toBeNull();
    expect(rect!.d).toBe('M 10 20 H 60 V 80 H 10 Z');
    // Urutan sudut dibalik harus menghasilkan geometri sama.
    const swapped = buildShapeObject('rect', b, a, OPTS);
    expect(swapped!.d).toBe(rect!.d);

    const stage = buildShapeObject('stage', a, b, OPTS);
    expect(stage!.points).toEqual([[10, 20], [60, 20], [60, 80], [10, 80]]);
    const stageSwapped = buildShapeObject('stage', b, a, OPTS);
    expect(stageSwapped!.points).toEqual(stage!.points);
  });

  it('circle memakai dua ujung diameter', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [30, 40];
    const c = buildShapeObject('circle', a, b, OPTS);
    expect(c).not.toBeNull();
    // Diameter hypot(30,40)=50 → rr=25, pusat (15,20).
    expect(c!.d).toBe('M -10 20 A 25 25 0 1 0 40 20 A 25 25 0 1 0 -10 20 Z');
    // Klik–klik dan seret memakai fungsi sama → geometri identik dua arah.
    const rev = buildShapeObject('circle', b, a, OPTS);
    expect(rev!.d).toBe(c!.d);
  });

  it('lorong memakai titik awal–akhir + lebar panel', () => {
    const a: [number, number] = [5, 5];
    const b: [number, number] = [55, 5];
    const aisle = buildShapeObject('aisle', a, b, { aisleWidth: 32, objectCount: 3 });
    expect(aisle).not.toBeNull();
    expect(aisle!.points).toEqual([a, b]);
    expect(aisle!.width).toBe(32);
  });

  it('di bawah ukuran minimum mengembalikan null (jangkar dipertahankan)', () => {
    expect(buildShapeObject('rect', [0, 0], [5, 5], OPTS)).toBeNull();
    expect(buildShapeObject('stage', [0, 0], [10, 10], OPTS)).toBeNull();
    expect(buildShapeObject('circle', [0, 0], [5, 5], OPTS)).toBeNull();
    expect(buildShapeObject('aisle', [0, 0], [5, 5], OPTS)).toBeNull();
    // Tepat di ambang juga ditolak (aturan lama: > 10).
    expect(buildShapeObject('rect', [0, 0], [10, 11], OPTS)).toBeNull();
  });

  it('klik kedua terlalu dekat mengembalikan null (titik awal dipertahankan)', () => {
    // Kedua gesture memakai builder yang sama; pemanggil mempertahankan
    // titik awal bila hasilnya null. Lihat tes interaksi
    // src/components/shapeGesture.test.tsx untuk perbandingan geometri
    // klik–klik vs seret–lepas lewat event pointer nyata.
    expect(buildShapeObject('rect', [12, 34], [14, 36], OPTS)).toBeNull();
    expect(buildShapeObject('aisle', [12, 34], [14, 36], OPTS)).toBeNull();
  });
});

describe('shapeDraft gesture helpers', () => {
  it('ambang 5px layar membedakan klik vs seret', () => {
    expect(isDragGesture(0, 0)).toBe(false);
    expect(isDragGesture(3, 4)).toBe(true); // =5
    expect(isDragGesture(4, 0)).toBe(false);
    expect(isDragGesture(2, 2)).toBe(false);
  });

  it('pemetaan tool ⇄ ghost kind konsisten', () => {
    expect(isShapeTool('stage')).toBe(true);
    expect(isShapeTool('aisle')).toBe(true);
    expect(isShapeTool('rectangle')).toBe(true);
    expect(isShapeTool('circle')).toBe(true);
    expect(isShapeTool('row')).toBe(false);
    expect(isShapeTool('polygon')).toBe(false);
    for (const tool of ['stage', 'aisle', 'rectangle', 'circle'] as const) {
      expect(toolForGhostKind(ghostKindForTool(tool))).toBe(tool);
    }
  });
});

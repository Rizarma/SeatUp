import type { Pt } from './venue';
import { makeObject } from './venue';
import { bboxOf, centerOf, normalizeAngle, rotatePoints, rotateShapeBy, rotationOf, scalePoints, toPointsString, translatePoints } from './geometry';
import { describe, expect, it } from 'vitest';

describe('geometry', () => {
  it('bboxOf menghitung kotak + pusat', () => {
    const b = bboxOf([[0, 0], [10, 20]]);
    expect(b).toMatchObject({ x: 0, y: 0, w: 10, h: 20, cx: 5, cy: 10 });
  });
  it('bboxOf garis tipis diberi w/h minimal 1', () => {
    expect(bboxOf([[5, 5], [5, 5]])).toMatchObject({ w: 1, h: 1 });
    expect(bboxOf([])).toBeNull();
  });
  it('centerOf null untuk kosong', () => {
    expect(centerOf([])).toBeNull();
  });
  it('toPointsString konsisten', () => {
    expect(toPointsString([[1, 2], [3, 4]])).toBe('1,2 3,4');
  });
  it('translatePoints + scalePoints', () => {
    const pts: Pt[] = [[0, 0], [10, 0]];
    expect(translatePoints(pts, 5, 5)).toEqual([[5, 5], [15, 5]]);
    expect(scalePoints(pts, 5, 0, 2)).toEqual([[-5, 0], [15, 0]]);
  });
  it('rotatePoints 90° terhadap pusat bbox (searah jarum jam, y-bawah)', () => {
    const pts: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    // pusat bbox (5,5): sudut kiri-atas -> kanan-atas
    expect(rotatePoints(pts, 90)).toEqual([[10, 0], [10, 10], [0, 10], [0, 0]]);
  });
  it('rotatePoints 180° = simetri pusat + preserve jumlah titik', () => {
    const pts: Pt[] = [[0, 0], [20, 0], [20, 10]];
    const out = rotatePoints(pts, 180);
    expect(out).toHaveLength(3);
    expect(out[0][0]).toBeCloseTo(20, 8);
    expect(out[0][1]).toBeCloseTo(10, 8);
  });
  it('rotatePoints 0°/360° identitas; sudut tak valid melempar', () => {
    const pts: Pt[] = [[1, 2], [3, 4]];
    expect(rotatePoints(pts, 0)).toEqual(pts);
    expect(rotatePoints(pts, 360)).toEqual([[1, 2], [3, 4]]);
    expect(rotatePoints([], 45)).toEqual([]);
    expect(() => rotatePoints(pts, NaN)).toThrow();
  });
  it('normalizeAngle ke (-180, 180]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(190)).toBeCloseTo(-170, 8);
    expect(normalizeAngle(-190)).toBeCloseTo(170, 8);
    expect(normalizeAngle(360)).toBe(0);
    expect(() => normalizeAngle(Infinity)).toThrow();
  });
  it('rotationOf + rotateShapeBy persisten (points di-bake TIDAK)', () => {
    const o = makeObject({ kind: 'stage', label: 'P' });
    o.points = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(rotationOf(o)).toBe(0);
    const r1 = rotateShapeBy(o, 90);
    expect(r1.rotation).toBe(90);
    expect(r1.points).toEqual(o.points);
    expect(r1.id).toBe(o.id);
    expect(rotationOf(rotateShapeBy(r1, 100))).toBe(-170);
    const v = makeObject({ kind: 'vector', label: 'V' });
    const rv = rotateShapeBy(v, 45);
    expect(rv.vTransform?.rotation).toBe(45);
    expect(rotationOf({ ...v, vTransform: null })).toBe(0);
    expect(() => rotateShapeBy(o, NaN)).toThrow();
  });
});

import type { Pt } from './venue';
import { bboxOf, centerOf, scalePoints, toPointsString, translatePoints } from './geometry';
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
});

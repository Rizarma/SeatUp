// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { makeBaseKey, shouldRebuildBase } from './SeatCanvas';

describe('SeatCanvas split base/overlay (temuan #4)', () => {
  const vb = { x: 0, y: 0, w: 1000, h: 700 };
  it('hover/selection (overlay saja) tidak mengubah kunci base', () => {
    const base1 = makeBaseKey({ docRev: 1, previewKey: null }, vb, 1000, 700, 1, false);
    const base2 = makeBaseKey({ docRev: 1, previewKey: null }, vb, 1000, 700, 1, false);
    expect(base1).toBe(base2);
    expect(shouldRebuildBase(base1, base2)).toBe(false);
  });
  it('kamera/resize/DPR/LOD menginvalidasi base', () => {
    const k = makeBaseKey({ docRev: 1, previewKey: null }, vb, 1000, 700, 1, false);
    expect(shouldRebuildBase(k, makeBaseKey({ docRev: 1, previewKey: null }, { ...vb, x: 10 }, 1000, 700, 1, false))).toBe(true);
    expect(shouldRebuildBase(k, makeBaseKey({ docRev: 1, previewKey: null }, vb, 1200, 700, 1, false))).toBe(true);
    expect(shouldRebuildBase(k, makeBaseKey({ docRev: 1, previewKey: null }, vb, 1000, 700, 2, false))).toBe(true);
    expect(shouldRebuildBase(k, makeBaseKey({ docRev: 1, previewKey: null }, vb, 1000, 700, 1, true))).toBe(true);
  });
  it('perubahan dokumen dan preview drag menginvalidasi base', () => {
    const k = makeBaseKey({ docRev: 1, previewKey: null }, vb, 1000, 700, 1, false);
    expect(shouldRebuildBase(k, makeBaseKey({ docRev: 2, previewKey: null }, vb, 1000, 700, 1, false))).toBe(true);
    expect(shouldRebuildBase(k, makeBaseKey({ docRev: 1, previewKey: 'row1|10|5,5|0,0' }, vb, 1000, 700, 1, false))).toBe(true);
  });
  it('tanpa cache awal selalu rebuild', () => {
    expect(shouldRebuildBase(null, makeBaseKey(1, vb, 1000, 700, 1, false))).toBe(true);
  });
});

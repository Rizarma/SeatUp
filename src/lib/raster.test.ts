import { describe, it, expect } from 'vitest';
import { grayscaleToDrafts, traceContour } from './raster';

function rectGray(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const g = new Uint8Array(w * h).fill(255);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) g[y * w + x] = 20;
  }
  return g;
}

describe('traceContour', () => {
  it('kontur persegi terurut dan menutup', () => {
    const w = 20;
    const h = 20;
    const mask = new Uint8Array(w * h);
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 14; x++) mask[y * w + x] = 1;
    const c = traceContour(mask, w, h, 5, 5);
    expect(c.length).toBeGreaterThan(8);
    const xs = c.map((p) => p[0]);
    const ys = c.map((p) => p[1]);
    expect(Math.min(...xs)).toBe(5);
    expect(Math.max(...xs)).toBe(14);
    expect(Math.min(...ys)).toBe(5);
    expect(Math.max(...ys)).toBe(10);
  });
});

describe('grayscaleToDrafts', () => {
  it('dua kotak terpisah -> dua draft', () => {
    const w = 60;
    const h = 40;
    const g = new Uint8Array(w * h).fill(255);
    for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) g[y * w + x] = 10;
    for (let y = 20; y <= 29; y++) for (let x = 40; x <= 54; x++) g[y * w + x] = 10;
    const r = grayscaleToDrafts(g, w, h, 0.1);
    expect(r.componentsRaw).toBe(2);
    expect(r.kept).toBe(2);
    expect(r.shapes[0].areaPct).toBeGreaterThan(r.shapes[1].areaPct);
  });
  it('kotak menyentuh -> satu komponen (keterbatasan pemisahan)', () => {
    const g = rectGray(40, 30, 5, 5, 30, 20);
    const r = grayscaleToDrafts(g, 40, 30, 0.1);
    expect(r.kept).toBe(1);
  });
  it('noise kecil diabaikan oleh minArea', () => {
    const w = 100;
    const h = 100;
    const g = new Uint8Array(w * h).fill(255);
    g[50 * w + 50] = 5;
    const r = grayscaleToDrafts(g, w, h, 0.2);
    expect(r.kept).toBe(0);
  });
});

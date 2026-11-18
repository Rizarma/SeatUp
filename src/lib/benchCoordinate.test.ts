import { describe, expect, it } from 'vitest';
import { worldScale, worldToClientPx, worldToScreen } from './viewTransform';

// Regresi P2 #3: konversi koordinat benchmark memakai definisi TUNGGAL yang
// sama dengan renderer (skala seragam dari lebar). Ekspektasi numerik
// independen — bukan round-trip helper yang berbagi kesalahan.

describe('worldToClientPx satu definisi (P2 #3)', () => {
  it('contoh spesifikasi: viewBox 2000x1000, rect 1000x500, world (1000,500) -> client (500,250)', () => {
    const c = worldToClientPx(1000, 500, { x: 0, y: 0, w: 2000, h: 1000 }, { left: 0, top: 0, width: 1000, height: 500 });
    expect(c.x).toBeCloseTo(500, 9);
    expect(c.y).toBeCloseTo(250, 9);
    // Rumus lama yang salah ((y-vy)/vw*r.height) menghasilkan 125, bukan 250.
    const buggy = 0 + ((500 - 0) / 2000) * 500;
    expect(buggy).toBeCloseTo(125, 9);
    expect(c.y).not.toBeCloseTo(buggy, 3);
  });

  it('landscape: skala dari lebar, konsisten dengan worldToScreen', () => {
    const vb = { x: 100, y: 50, w: 1200, h: 600 };
    const rect = { left: 10, top: 20, width: 600, height: 300 };
    // k = 600/1200 = 0.5
    expect(worldScale(vb, 600)).toBeCloseTo(0.5, 9);
    const c = worldToClientPx(700, 350, vb, rect);
    // screen = ((700-100)*0.5, (350-50)*0.5) = (300,150); + offset rect
    expect(c.x).toBeCloseTo(310, 9);
    expect(c.y).toBeCloseTo(170, 9);
    const [sx, sy] = worldToScreen(700, 350, vb, { w: 600, h: 300 });
    expect(c.x).toBeCloseTo(rect.left + sx, 9);
    expect(c.y).toBeCloseTo(rect.top + sy, 9);
  });

  it('portrait + rect offset nonzero', () => {
    const vb = { x: 0, y: 0, w: 800, h: 1600 };
    const rect = { left: 40, top: 80, width: 400, height: 800 };
    // k = 400/800 = 0.5; world (800,1600) -> screen (400,800) + offset
    const c = worldToClientPx(800, 1600, vb, rect);
    expect(c.x).toBeCloseTo(440, 9);
    expect(c.y).toBeCloseTo(880, 9);
    const origin = worldToClientPx(0, 0, vb, rect);
    expect(origin).toEqual({ x: 40, y: 80 });
  });

  it('pan: viewBox bergeser, titik world yang sama berpindah client', () => {
    const rect = { left: 0, top: 0, width: 1000, height: 500 };
    const before = worldToClientPx(1000, 500, { x: 0, y: 0, w: 2000, h: 1000 }, rect);
    const afterPan = worldToClientPx(1000, 500, { x: 500, y: 250, w: 2000, h: 1000 }, rect);
    // k = 0.5; pan (+500,+250) menggeser client (-250,-125)
    expect(afterPan.x).toBeCloseTo(before.x - 250, 9);
    expect(afterPan.y).toBeCloseTo(before.y - 125, 9);
  });

  it('zoom: viewBox menyempit 2x, jarak client membesar 2x', () => {
    const rect = { left: 0, top: 0, width: 1000, height: 500 };
    const wide = worldToClientPx(1500, 750, { x: 0, y: 0, w: 2000, h: 1000 }, rect);
    const zoomed = worldToClientPx(1500, 750, { x: 500, y: 250, w: 1000, h: 500 }, rect);
    // k wide=0.5 -> (750,375); k zoom=1.0, origin (500,250) -> (1000,500)
    expect(wide.x).toBeCloseTo(750, 9);
    expect(zoomed.x).toBeCloseTo(1000, 9);
    expect(zoomed.y).toBeCloseTo(500, 9);
  });

  it('perubahan tinggi saja: Y memakai skala lebar yang sama (sejajar renderer)', () => {
    // Tinggi viewport berubah 500->800 tanpa mengubah lebar: k tetap 0.5.
    const vb = { x: 0, y: 0, w: 2000, h: 1000 };
    const a = worldToClientPx(1000, 500, vb, { left: 0, top: 0, width: 1000, height: 500 });
    const b = worldToClientPx(1000, 500, vb, { left: 0, top: 0, width: 1000, height: 800 });
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('DPR 1 vs 2: koordinat input tetap CSS px (tak berubah)', () => {
    const vb = { x: 0, y: 0, w: 2000, h: 1000 };
    const rect = { left: 0, top: 0, width: 1000, height: 500 };
    // Fungsi hanya memakai CSS px; DPR tidak menjadi parameter.
    const dpr1 = worldToClientPx(1000, 500, vb, rect);
    const dpr2 = worldToClientPx(1000, 500, vb, rect);
    expect(dpr1).toEqual(dpr2);
    expect(dpr1.x).toBeCloseTo(500, 9);
  });
});

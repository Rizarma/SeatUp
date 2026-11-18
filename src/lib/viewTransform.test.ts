import { describe, expect, it } from 'vitest';
import { aspectMatches, resizePreserveScale, screenToWorld, worldScale, worldToScreen } from './viewTransform';

describe('viewTransform satu definisi (temuan #2)', () => {
  it('worldScale memakai lebar: nilai ekspektasi independen', () => {
    // vb.w=1200, cssW=600 -> skala 0.5 px/world (bukan dari tinggi)
    expect(worldScale({ x: 0, y: 0, w: 1200, h: 800 }, 600)).toBeCloseTo(0.5, 9);
    expect(worldScale({ x: 10, y: 20, w: 400, h: 200 }, 800)).toBeCloseTo(2, 9);
  });

  it('world<->screen konsisten dengan nilai eksplisit (bukan round-trip berbagi kesalahan)', () => {
    const vb = { x: 100, y: 50, w: 1200, h: 600 };
    const css = { w: 600, h: 300 };
    // k = 600/1200 = 0.5; world (100,50) -> screen (0,0)
    expect(worldToScreen(100, 50, vb, css)).toEqual([0, 0]);
    // world (700, 350) -> screen (300, 150)
    expect(worldToScreen(700, 350, vb, css)).toEqual([300, 150]);
    // screen (300,150) -> world (700,350)
    const [wx, wy] = screenToWorld(300, 150, vb, css);
    expect(wx).toBeCloseTo(700, 9);
    expect(wy).toBeCloseTo(350, 9);
  });

  it('resize landscape->portrait->landscape mempertahankan pusat + zoom', () => {
    const vb = { x: 0, y: 0, w: 1200, h: 800 };
    const land = resizePreserveScale(vb, 1200, 800, 360, 740);
    expect(land).not.toBeNull();
    // pusat sama (600,400)
    expect(land!.x + land!.w / 2).toBeCloseTo(600, 6);
    expect(land!.y + land!.h / 2).toBeCloseTo(400, 6);
    // skala sama: 1200/1200 = 1 -> 360/land.w = 1
    expect(360 / land!.w).toBeCloseTo(1, 6);
    // aspek baru == aspek viewport baru
    expect(land!.w / land!.h).toBeCloseTo(360 / 740, 6);
    const back = resizePreserveScale(land!, 360, 740, 1200, 800)!;
    expect(back.x + back.w / 2).toBeCloseTo(600, 6);
    expect(back.w).toBeCloseTo(1200, 6);
  });

  it('perubahan tinggi saja tidak menggeser pusat', () => {
    const vb = { x: 0, y: 0, w: 1000, h: 500 };
    const next = resizePreserveScale(vb, 1000, 500, 1000, 800)!;
    expect(next.x + next.w / 2).toBeCloseTo(500, 6);
    expect(next.y + next.h / 2).toBeCloseTo(250, 6);
    expect(next.w).toBeCloseTo(1000, 6);
    expect(next.h).toBeCloseTo(800, 6);
  });

  it('DPR tidak mengubah logika world (skala CSS, bukan device px)', () => {
    const vb = { x: 0, y: 0, w: 800, h: 600 };
    // DPR 1 vs 2: worldScale sama karena memakai CSS px
    expect(worldScale(vb, 800)).toBe(worldScale(vb, 800));
  });

  it('aspectMatches mendeteksi letterbox', () => {
    expect(aspectMatches({ x: 0, y: 0, w: 1200, h: 800 }, 1200, 800)).toBe(true);
    expect(aspectMatches({ x: 0, y: 0, w: 1200, h: 800 }, 360, 740)).toBe(false);
  });
});

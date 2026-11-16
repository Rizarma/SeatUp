import { describe, it, expect } from 'vitest';
import { fitViewBox, toWorld } from './camera';

describe('fitViewBox', () => {
  it('wadah se-aspek doc -> viewBox pas doc', () => {
    const vb = fitViewBox(1200, 800, 1200, 800);
    expect(vb).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
  });
  it('2560x1440: skala ikut tinggi, viewBox diperlebar', () => {
    const vb = fitViewBox(2560, 1440, 1200, 800);
    // k = min(2560/1200, 1440/800) = min(2.133, 1.8) = 1.8
    expect(vb.h).toBeCloseTo(800, 5);
    expect(vb.w).toBeCloseTo(2560 / 1.8, 3);
    expect(vb.x + vb.w / 2).toBeCloseTo(600, 5);
    expect(vb.y).toBeCloseTo(0, 5);
  });
  it('ultrawide 3440x1440: aspek viewBox == aspek kontainer', () => {
    const vb = fitViewBox(3440, 1440, 1200, 800);
    expect(vb.w / vb.h).toBeCloseTo(3440 / 1440, 8);
    // doc muat penuh di dalam
    expect(vb.x).toBeLessThanOrEqual(0);
    expect(vb.x + vb.w).toBeGreaterThanOrEqual(1200);
    expect(vb.y).toBeLessThanOrEqual(0);
    expect(vb.y + vb.h).toBeGreaterThanOrEqual(800);
  });
  it('potret 360x740: skala ikut lebar, viewBox dipertinggi', () => {
    const vb = fitViewBox(360, 740, 1200, 800);
    expect(vb.w).toBeCloseTo(1200, 5);
    expect(vb.h).toBeGreaterThan(800);
    expect(vb.w / vb.h).toBeCloseTo(360 / 740, 8);
  });
});

describe('toWorld', () => {
  it('tengah kontainer -> tengah view', () => {
    const vb = fitViewBox(2560, 1440, 1200, 800);
    const rect = { left: 0, top: 0, width: 2560, height: 1440 };
    const [x, y] = toWorld(1280, 720, rect, vb);
    expect(x).toBeCloseTo(600, 0);
    expect(y).toBeCloseTo(400, 0);
  });
  it('tepi kiri area perluasan memetakan ke luar doc (workspace)', () => {
    const vb = fitViewBox(2560, 1440, 1200, 800);
    const rect = { left: 0, top: 0, width: 2560, height: 1440 };
    const [x] = toWorld(10, 720, rect, vb);
    expect(x).toBeLessThan(0);
  });
  it('konsisten setelah resize: titik world sama dari ukuran berbeda', () => {
    const a = fitViewBox(1280, 800, 1200, 800);
    const b = fitViewBox(2560, 1440, 1200, 800);
    // world (600,400) harus di tengah kedua kontainer
    const ra = { left: 0, top: 0, width: 1280, height: 800 };
    const rb = { left: 100, top: 50, width: 2560, height: 1440 };
    const ka = 600; // tengah
    void ka;
    const pa = toWorld(640, 400, ra, a);
    const pb = toWorld(100 + 1280, 50 + 720, rb, b);
    expect(pa).toEqual([600, 400]);
    expect(pb).toEqual([600, 400]);
  });
});

it('retains subpixel placement precision when editing compact section seats', () => {
 expect(toWorld(25,25,{left:0,top:0,width:100,height:100},{x:0,y:0,w:1,h:1})).toEqual([0.25,0.25]);
});

import { describe, expect, it, vi } from 'vitest';
import { drawSeatBase, type SeatDrawSpec } from './seatCanvas';
import type { ViewBox } from './camera';

function fakeCtx(calls: { fillStyle: string; alpha: number }[]): CanvasRenderingContext2D {
  const ctx = {
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    arc: () => {},
    rect: () => {},
    fill: () => {
      const c = ctx as unknown as { fillStyle: string; globalAlpha: number };
      calls.push({ fillStyle: String(c.fillStyle), alpha: Number(c.globalAlpha) });
    },
    globalAlpha: 1,
    fillStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

const vb: ViewBox = { x: 0, y: 0, w: 1000, h: 700 };

describe('seatCanvas batch memakai alpha efektif (temuan #7)', () => {
  it('available -> taken dengan warna sama tidak mewarisi opacity (jalur circle)', () => {
    const calls: { fillStyle: string; alpha: number }[] = [];
    const ctx = fakeCtx(calls);
    const seats: SeatDrawSpec[] = [
      { x: 10, y: 10, r: 8, fill: '#22c55e', alpha: 0.9, dimmed: false },
      { x: 30, y: 10, r: 8, fill: '#22c55e', alpha: 0.9, dimmed: true },
    ];
    drawSeatBase(ctx, 1, seats, vb, 1000, 700, false);
    // Dua batch: available eff 0.9, taken/book eff 0.405
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({ fillStyle: '#22c55e', alpha: 0.9 });
    expect(calls[1].alpha).toBeCloseTo(0.405, 5);
  });

  it('urutan dibalik tetap benar (jalur circle)', () => {
    const calls: { fillStyle: string; alpha: number }[] = [];
    const ctx = fakeCtx(calls);
    const seats: SeatDrawSpec[] = [
      { x: 10, y: 10, r: 8, fill: '#22c55e', alpha: 0.9, dimmed: true },
      { x: 30, y: 10, r: 8, fill: '#22c55e', alpha: 0.9, dimmed: false },
    ];
    drawSeatBase(ctx, 1, seats, vb, 1000, 700, false);
    expect(calls.length).toBe(2);
    expect(calls[0].alpha).toBeCloseTo(0.405, 5);
    expect(calls[1]).toEqual({ fillStyle: '#22c55e', alpha: 0.9 });
  });

  it('jalur dot (LOD jauh) memakai alpha efektif', () => {
    const calls: { fillStyle: string; alpha: number }[] = [];
    const ctx = fakeCtx(calls);
    const seats: SeatDrawSpec[] = [
      { x: 10, y: 10, r: 8, fill: '#3b82f6', alpha: 1, dimmed: false },
      { x: 30, y: 10, r: 8, fill: '#3b82f6', alpha: 1, dimmed: true },
    ];
    drawSeatBase(ctx, 1, seats, vb, 1000, 700, true);
    expect(calls.length).toBe(2);
    expect(calls[0].alpha).toBe(1);
    expect(calls[1].alpha).toBeCloseTo(0.45, 5);
  });

  it('status campuran + invalid tidak bergantung urutan array', () => {
    const mk = (dimmed: boolean, fill: string): SeatDrawSpec => ({ x: 0, y: 0, r: 8, fill, alpha: 1, dimmed });
    const orderA = [mk(false, '#22c55e'), mk(true, '#22c55e'), mk(true, '#9ca3af')];
    const orderB = [...orderA].reverse();
    const run = (seats: SeatDrawSpec[]) => {
      const calls: { fillStyle: string; alpha: number }[] = [];
      drawSeatBase(fakeCtx(calls), 1, seats, vb, 1000, 700, false);
      return calls;
    };
    const a = run(orderA);
    const b = run(orderB);
    // Himpunan batch efektif sama (3 batch berbeda), hanya urutan berbeda
    const key = (c: { fillStyle: string; alpha: number }) => `${c.fillStyle}|${c.alpha}`;
    expect(a.map(key).sort()).toEqual(b.map(key).sort());
    expect(a.length).toBe(3);
  });

  it('drawSeatBase dipanggil dengan alpha terverifikasi (bukan hanya hitung draw)', () => {
    const spy = vi.fn();
    const calls: { fillStyle: string; alpha: number }[] = [];
    const ctx = fakeCtx(calls);
    drawSeatBase(ctx, 1, [{ x: 0, y: 0, r: 8, fill: '#fff', alpha: 0.8, dimmed: true }], vb, 1000, 700, false);
    spy(calls);
    expect(spy).toHaveBeenCalledOnce();
    expect(calls[0].alpha).toBeCloseTo(0.36, 5);
  });
});

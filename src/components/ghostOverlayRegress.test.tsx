// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { ghostVisualHash, needsGhostCanvas } from './EditorCanvas';
import { drawOverlay } from '../lib/seatCanvas';

// Temuan #2 (jalur produksi): ghost dengan JUMLAH TETAP tetapi posisi/
// validitas berubah harus memakai koordinat terbaru; base tidak dibangun ulang.

describe('ghost overlay redraw jumlah tetap (temuan #2)', () => {
  it('500 → 501 beralih renderer; 500 tetap SVG, 501 Canvas', () => {
    const anchor = { x: 0, y: 0 };
    expect(needsGhostCanvas('row', anchor, 500)).toBe(false);
    expect(needsGhostCanvas('row', anchor, 501)).toBe(true);
  });

  it('draw overlay memakai koordinat terbaru (jumlah sama)', () => {
    const arcs: Array<{ x: number; y: number; r: number }> = [];
    const ctx = {
      save: () => {}, restore: () => {}, setTransform: () => {},
      beginPath: () => {}, fill: () => {}, stroke: () => {},
      arc: (x: number, y: number) => { arcs.push({ x, y, r: 0 }); },
      fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const vb = { x: 0, y: 0, w: 1000, h: 700 };
    const mk = (dx: number, ok: boolean) => ({ x: 10 + dx, y: 20, r: 8, kind: ok ? 'ghost-ok' as const : 'ghost-bad' as const });
    const g1 = Array.from({ length: 600 }, () => mk(0, true));
    const g2 = Array.from({ length: 600 }, () => mk(50, true));
    expect(ghostVisualHash(g1.map((g) => ({ x: g.x, y: g.y, ok: true })))).not.toBe(
      ghostVisualHash(g2.map((g) => ({ x: g.x, y: g.y, ok: true }))),
    );
    drawOverlay(ctx, 1, g2, vb, 1000);
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs[0].x).toBeCloseTo(10 + 50, 6);
  });

  it('perubahan validitas mengubah warna/status visual', () => {
    const a = Array.from({ length: 600 }, () => ({ x: 0, y: 0, ok: true }));
    const b = a.map((g, i) => (i < 5 ? { ...g, ok: false } : g));
    expect(ghostVisualHash(a)).not.toBe(ghostVisualHash(b));
    void vi;
  });
});

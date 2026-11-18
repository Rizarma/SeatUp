import type { ViewBox } from './camera';
import { clampDpr, worldScale } from './viewTransform';

/**
 * Fondasi renderer seat Canvas 2D yang dipakai bersama editor & preview.
 * - Hit-testing TIDAK di sini (pakai indeks spasial docIndex).
 * - Koordinat world == koordinat doc; transform dikunci dari viewBox aktif.
 * - Menghormati devicePixelRatio + resize via ResizeObserver di komponen.
 */

export interface SeatDrawSpec {
  x: number;
  y: number;
  /** radius world */
  r: number;
  fill: string;
  /** 0..1 */
  alpha: number;
  dimmed: boolean;
}

export interface OverlaySpec {
  x: number;
  y: number;
  r: number;
  kind: 'selected' | 'picked' | 'hover' | 'anchor' | 'ghost-ok' | 'ghost-bad';
}

const OVERLAY_STYLE: Record<OverlaySpec['kind'], { stroke: string; width: number; fill: string | null }> = {
  selected: { stroke: '#1d4ed8', width: 2, fill: null },
  picked: { stroke: '#0F172A', width: 2.5, fill: null },
  hover: { stroke: '#f59e0b', width: 2, fill: 'rgba(245,158,11,0.18)' },
  anchor: { stroke: '#16a34a', width: 2.5, fill: null },
  'ghost-ok': { stroke: '#16a34a', width: 1.5, fill: 'rgba(34,197,94,0.35)' },
  'ghost-bad': { stroke: '#dc2626', width: 1.5, fill: 'rgba(220,38,38,0.45)' },
};

export function setupCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): {
  ctx: CanvasRenderingContext2D;
  dpr: number;
} | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = clampDpr(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { ctx, dpr };
}

/**
 * Gambar lapisan seat dasar. seats sudah dicull ke viewport (+margin) oleh
 * pemanggil. Batch per warna untuk meminimalkan pergantian fillStyle.
 * Level 'dot' (zoom jauh): persegi 2px cepat; selain itu lingkaran batch.
 */
export function drawSeatBase(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  seats: SeatDrawSpec[],
  vb: ViewBox,
  cssW: number,
  cssH: number,
  simple: boolean,
): void {
  ctx.save();
  // Bersihkan dalam koordinat device-pixel (tak terpengaruh transform).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr)));
  if (seats.length === 0) {
    ctx.restore();
    return;
  }

  if (simple) {
    // Jalur cepat zoom-jauh: tanpa save/restore per seat, tanpa arc.
    // Batch memakai alpha EFEKTIF (termasuk dimmed) agar status campuran
    // dengan warna sama tidak mewarisi opacity batch sebelumnya.
    const k = worldScale(vb, cssW) * dpr;
    const ox = vb.x * k;
    const oy = vb.y * k;
    let lastFill = '';
    let lastEff = -1;
    ctx.beginPath();
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      const eff = s.dimmed ? s.alpha * 0.45 : s.alpha;
      if (s.fill !== lastFill || eff !== lastEff) {
        if (lastFill !== '') ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = s.fill;
        ctx.globalAlpha = eff;
        lastFill = s.fill;
        lastEff = eff;
      }
      const sx = s.x * k - ox;
      const sy = s.y * k - oy;
      ctx.rect(sx - 1, sy - 1, 2, 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  const k = (cssW / Math.max(1, vb.w)) * dpr;
  ctx.setTransform(k, 0, 0, k, -vb.x * k, -vb.y * k);
  ctx.lineWidth = 0;
  let lastFill = '';
  let lastEff = -1;
  ctx.beginPath();
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    const eff = s.dimmed ? s.alpha * 0.45 : s.alpha;
    if (s.fill !== lastFill || eff !== lastEff) {
      if (lastFill !== '') ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = s.fill;
      ctx.globalAlpha = eff;
      lastFill = s.fill;
      lastEff = eff;
    }
    ctx.moveTo(s.x + s.r, s.y);
    ctx.arc(s.x, s.y, s.r * 0.875, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Gambar overlay (selection / hover / ghost) di atas lapisan dasar. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  items: OverlaySpec[],
  vb: ViewBox,
  cssW: number,
): void {
  if (items.length === 0) return;
  const k = (cssW / Math.max(1, vb.w)) * dpr;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, -vb.x * k, -vb.y * k);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const st = OVERLAY_STYLE[it.kind];
    const rr = it.kind === 'hover' || it.kind === 'selected' ? it.r * 1.25 : it.r;
    if (st.fill) {
      ctx.beginPath();
      ctx.fillStyle = st.fill;
      ctx.arc(it.x, it.y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.strokeStyle = st.stroke;
    // lineWidth dalam unit world agar tebal konsisten di semua zoom.
    ctx.lineWidth = (st.width * 1.6) / Math.max(0.2, k / dpr);
    ctx.arc(it.x, it.y, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

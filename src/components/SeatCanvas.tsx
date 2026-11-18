import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ViewBox } from '../lib/camera';
import { drawOverlay, drawSeatBase, setupCanvas, type OverlaySpec, type SeatDrawSpec } from '../lib/seatCanvas';
import { clampDpr } from '../lib/viewTransform';

/**
 * Lapisan visual seat Canvas 2D (murni presentasional, pointer-events: none).
 * - Hit-testing tetap di handler SVG/root via indeks spasial.
 * - Redraw dijadwalkan maksimal 1x per rAF; pemanggilan beruntun digabung
 *   (tidak ada antrean callback menumpuk).
 * - Base (seluruh seat viewport) di-cache di offscreen canvas: hover, focus,
 *   selection, dan ghost HANYA menggambar ulang overlay di atas citra base
 *   yang dipakai ulang. Base diinvalidasi oleh kamera (vb), resize/DPR,
 *   perubahan dokumen (baseRev), atau mode LOD (simpleDots).
 */

export interface SeatCanvasHandle {
  /** Minta redraw overlay (digabung ke 1 frame; base dipakai ulang bila kunci sama). */
  requestRedraw: () => void;
}

interface Props {
  vb: ViewBox;
  /** Berubah bila lapisan dasar berubah (identitas revisi doc). */
  baseRev: unknown;
  /** Berubah bila overlay berubah (seleksi / hover / marquee / ghost). */
  overlayRev: unknown;
  buildBase: (out: SeatDrawSpec[]) => void;
  buildOverlay: (out: OverlaySpec[]) => void;
  /** true = pakai jalur persegi cepat (zoom jauh). Diatur pemanggil dari LOD. */
  simpleDots: boolean;
  label: string;
}

/** Kunci cache base: semua input yang memengaruhi citra dasar. */
export function makeBaseKey(
  baseRev: unknown,
  vb: ViewBox,
  cssW: number,
  cssH: number,
  dpr: number,
  simpleDots: boolean,
): string {
  const rev = typeof baseRev === 'object' && baseRev !== null
    ? JSON.stringify(baseRev)
    : String(baseRev);
  return `${rev}|${vb.x},${vb.y},${vb.w},${vb.h}|${Math.round(cssW)}x${Math.round(cssH)}|dpr${dpr}|${simpleDots ? 'dot' : 'full'}`;
}

/** True bila base harus dibangun ulang (kunci berubah / belum ada cache). */
export function shouldRebuildBase(lastKey: string | null, nextKey: string): boolean {
  return lastKey !== nextKey;
}

const SeatCanvas = forwardRef<SeatCanvasHandle, Props>(function SeatCanvas(
  { vb, baseRev, overlayRev, buildBase, buildOverlay, simpleDots, label },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buildersRef = useRef({ buildBase, buildOverlay, simpleDots });
  buildersRef.current = { buildBase, buildOverlay, simpleDots };
  const vbRef = useRef(vb);
  vbRef.current = vb;
  // Sumber kebenaran terbaru untuk frame terjadwal: draw WAJIB membaca
  // dari ref ini (bukan closure penjadwalan) agar invalidasi revisi baru
  // yang datang saat 1 frame pending tidak terserap/hilang.
  const baseRevRef = useRef(baseRev);
  baseRevRef.current = baseRev;
  const rafRef = useRef(0);
  const baseScratch = useRef<SeatDrawSpec[]>([]);
  const overlayScratch = useRef<OverlaySpec[]>([]);
  const baseKeyRef = useRef<string | null>(null);
  const baseOffRef = useRef<HTMLCanvasElement | null>(null);

  const draw = () => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = clampDpr(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const b = buildersRef.current;
    const v = vbRef.current;
    const rev = baseRevRef.current;
    const key = makeBaseKey(rev, v, cssW, cssH, dpr, b.simpleDots);

    const setup = setupCanvas(canvas, cssW, cssH);
    if (!setup) return;
    const { ctx } = setup;

    // --- Base: pakai ulang citra offscreen bila kunci sama ---
    let off = baseOffRef.current;
    if (!off) {
      off = document.createElement('canvas');
      baseOffRef.current = off;
    }
    if (shouldRebuildBase(baseKeyRef.current, key)) {
      const base = baseScratch.current;
      base.length = 0;
      b.buildBase(base);
      const offSetup = setupCanvas(off, cssW, cssH);
      if (offSetup) {
        drawSeatBase(offSetup.ctx, dpr, base, v, cssW, cssH, b.simpleDots);
      }
      baseKeyRef.current = key;
    }

    // --- Komposit: blit base, lalu overlay fresh ---
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr)));
    try {
      if (off.width > 0 && off.height > 0) {
        ctx.drawImage(off, 0, 0);
      }
    } catch {
      // offscreen belum siap: lanjutkan overlay saja
    }
    ctx.restore();
    const overlay = overlayScratch.current;
    overlay.length = 0;
    b.buildOverlay(overlay);
    drawOverlay(ctx, dpr, overlay, v, cssW);
  };

  const requestRedraw = () => {
    if (rafRef.current !== 0) return;
    if (typeof requestAnimationFrame !== 'function') {
      draw();
      return;
    }
    rafRef.current = requestAnimationFrame(draw);
  };

  useImperativeHandle(ref, () => ({ requestRedraw }), []);

  // Perubahan props visual -> gabungkan ke 1 frame.
  // Overlay-only (overlayRev) memakai ulang base bila kunci base sama.
  useEffect(() => {
    requestRedraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vb, baseRev, overlayRev, simpleDots]);

  // Resize -> redraw (ResizeObserver, bukan render loop).
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => requestRedraw());
    ro.observe(parent);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
    // StrictMode menjalankan setup → cleanup → setup pada instance yang sama:
    // handle harus dikembalikan ke 0 agar replay effect dapat menjadwalkan
    // ulang redraw (coalescing memakai 0 sebagai "tidak ada frame pending").
    // Callback yang dibatalkan tidak akan menggambar setelah unmount karena
    // cancelAnimationFrame menghapusnya dari antrean scheduler.
    rafRef.current = 0;
    baseKeyRef.current = null;
    baseOffRef.current = null;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-seat-canvas={label}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
});

export default SeatCanvas;

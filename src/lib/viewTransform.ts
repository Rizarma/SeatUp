import type { ViewBox } from './camera';

/**
 * Fondasi kamera + koordinat layar/world yang dipakai bersama oleh editor
 * dan preview (SVG maupun Canvas). Satu sumber kebenaran agar posisi
 * hover/klik setelah pan, zoom, dan resize selalu konsisten.
 */

export interface ScreenSize {
  w: number;
  h: number;
}

/**
 * Skala world->layar (px CSS per unit world).
 * Definisi tunggal untuk SVG, Canvas 2D, dan hit-test: selalu memakai LEBAR.
 * Pemanggil WAJIB menjaga aspek viewBox == aspek viewport (lihat
 * resizePreserveScale); bila aspek dijaga, skala tinggi identik dan semua
 * layer sejajar. Jangan memakai skala X/Y terpisah.
 */
export function worldScale(vb: ViewBox, cssW: number): number {
  return cssW / Math.max(1, vb.w);
}

export function worldToScreen(wx: number, wy: number, vb: ViewBox, css: ScreenSize): [number, number] {
  const k = worldScale(vb, css.w);
  return [(wx - vb.x) * k, (wy - vb.y) * k];
}

export function screenToWorld(sx: number, sy: number, vb: ViewBox, css: ScreenSize): [number, number] {
  const k = worldScale(vb, css.w);
  return [vb.x + sx / k, vb.y + sy / k];
}

/**
 * Resize yang mempertahankan pusat + zoom (skala) pengguna.
 * Dipakai editor & preview agar landscape<->portrait, perubahan tinggi saja,
 * panel samping, dan rotasi layar tidak menggeser/mismatch layer.
 * Bila ukuran lama tak valid, kembalikan null agar pemanggil memakai fit.
 */
export function resizePreserveScale(
  vb: ViewBox,
  oldCssW: number,
  oldCssH: number,
  newCssW: number,
  newCssH: number,
): ViewBox | null {
  const ow = Math.max(1, oldCssW);
  const oh = Math.max(1, oldCssH);
  const nw = Math.max(1, newCssW);
  const nh = Math.max(1, newCssH);
  if (!Number.isFinite(vb.x) || !Number.isFinite(vb.y) || !Number.isFinite(vb.w) || vb.w <= 0) return null;
  if (!Number.isFinite(ow) || !Number.isFinite(oh) || !Number.isFinite(nw) || !Number.isFinite(nh)) return null;
  // Skala lama dari lebar (definisi tunggal). Tinggi mengikuti agar aspek terjaga.
  const k = ow / Math.max(1, vb.w);
  if (!Number.isFinite(k) || k <= 0) return null;
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + (vb.h / 2);
  const nextW = nw / k;
  const nextH = nh / k;
  if (!Number.isFinite(nextW) || !Number.isFinite(nextH) || nextW <= 0 || nextH <= 0) return null;
  return { x: cx - nextW / 2, y: cy - nextH / 2, w: nextW, h: nextH };
}

/** Aspek viewBox vs viewport cocok (toleransi 0,5%) — prasyarat tanpa-letterbox. */
export function aspectMatches(vb: ViewBox, cssW: number, cssH: number, tol = 0.005): boolean {
  if (vb.w <= 0 || vb.h <= 0 || cssW <= 0 || cssH <= 0) return false;
  const a = vb.w / vb.h;
  const b = cssW / cssH;
  return Math.abs(a - b) / Math.max(1e-9, b) <= tol;
}

export type LodLevel = 'dot' | 'simple' | 'full';

export interface Lod {
  /** radius seat dalam px layar */
  screenR: number;
  level: LodLevel;
  /** tampilkan teks/label/dekorasi kecil */
  showText: boolean;
  /** tampilkan stroke lingkaran (di bawah ini cukup fill) */
  showStroke: boolean;
}

/**
 * Level-of-detail berdasarkan zoom: jauh = representasi sederhana/agregat,
 * dekat = detail penuh. Ambang dalam px layar agar konsisten di semua DPR.
 */
export function lodFor(vb: ViewBox, cssW: number, seatRadiusWorld: number): Lod {
  const cssW2 = Math.max(1, cssW);
  const screenR = seatRadiusWorld * (cssW2 / Math.max(1, vb.w));
  if (screenR < 2.2) return { screenR, level: 'dot', showText: false, showStroke: false };
  if (screenR < 5) return { screenR, level: 'simple', showText: false, showStroke: false };
  return { screenR, level: 'full', showText: true, showStroke: true };
}

/** Margin culling dalam unit world agar seat tak berkedip di tepi viewport. */
export function cullMargin(vb: ViewBox, seatRadiusWorld: number): number {
  return Math.max(8, seatRadiusWorld * 2, vb.w * 0.01);
}

/** Batas aman devicePixelRatio (hindari kanvas raksasa di layar 3x). */
export function clampDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(2, dpr);
}

/**
 * World -> client CSS px untuk benchmark/harness (temuan P2 #3).
 * Definisi TUNGGAL yang sama dengan renderer: skala seragam dari LEBAR
 * (worldScale), bukan skala X/Y terpisah. x/y dihitung dengan k yang sama
 * agar sejajar dengan Canvas/SVG/hit-test setelah pan/zoom/resize.
 * Koordinat input tetap CSS px (DPR tidak mengubah logika).
 */
export function worldToClientPx(
  wx: number,
  wy: number,
  vb: ViewBox,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const k = rect.width / Math.max(1, vb.w);
  return { x: rect.left + (wx - vb.x) * k, y: rect.top + (wy - vb.y) * k };
}

import type { Pt, VenueObject } from './venue';
import { uid } from './venue';

/** Jenis draf bentuk yang memakai pola klik–gerak–klik. */
export type ShapeKind = 'stage' | 'aisle' | 'rect' | 'circle';

/** Ambang gerak layar (px) untuk membedakan klik dari seret. Sama dengan gesture baris. */
export const SHAPE_CLICK_DRAG_THRESHOLD_PX = 5;

/** Ukuran minimum dunia agar bentuk jadi dibuat (aturan geometri yang sudah ada). */
export const SHAPE_MIN_RECT = 10;
export const SHAPE_MIN_DIAMETER = 10;
export const SHAPE_MIN_AISLE = 10;

export function isShapeTool(tool: string): tool is 'stage' | 'aisle' | 'rectangle' | 'circle' {
  return tool === 'stage' || tool === 'aisle' || tool === 'rectangle' || tool === 'circle';
}

export function ghostKindForTool(tool: 'stage' | 'aisle' | 'rectangle' | 'circle'): ShapeKind {
  if (tool === 'stage') return 'stage';
  if (tool === 'aisle') return 'aisle';
  if (tool === 'rectangle') return 'rect';
  return 'circle';
}

export function toolForGhostKind(kind: ShapeKind): 'stage' | 'aisle' | 'rectangle' | 'circle' {
  if (kind === 'stage') return 'stage';
  if (kind === 'aisle') return 'aisle';
  if (kind === 'rect') return 'rectangle';
  return 'circle';
}

export interface ShapeBuildOpts {
  aisleWidth: number;
  /** Jumlah objek saat ini, untuk label berurutan. */
  objectCount: number;
}

/**
 * Logika pembuatan objek yang sama untuk gesture klik–klik dan seret–lepas.
 * Mengembalikan null bila di bawah ukuran minimum — pemanggil wajib
 * mempertahankan titik awal agar pengguna bisa memilih posisi akhir lain.
 */
export function buildShapeObject(
  kind: ShapeKind,
  a: Pt,
  b: Pt,
  opts: ShapeBuildOpts,
): VenueObject | null {
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  if (kind === 'rect') {
    if (!(w > SHAPE_MIN_RECT && h > SHAPE_MIN_RECT)) return null;
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    const d = `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    return {
      id: uid('obj'), kind: 'vector', shape: 'rect',
      label: `Kotak ${opts.objectCount + 1}`,
      points: [], d, closed: true, width: 28, price: 0, rowParams: null, seats: [],
      vTransform: { tx: 0, ty: 0, scale: 1 }, svgFill: '#93c5fd',
      svgStroke: { color: '#3b82f6', width: 2 },
      source: { origin: 'canvas', confidence: 1 }, guess: null,
    };
  }
  if (kind === 'circle') {
    if (!(Math.hypot(w, h) > SHAPE_MIN_DIAMETER)) return null;
    const rr = Math.hypot(w, h) / 2;
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const d = `M ${cx - rr} ${cy} A ${rr} ${rr} 0 1 0 ${cx + rr} ${cy} A ${rr} ${rr} 0 1 0 ${cx - rr} ${cy} Z`;
    return {
      id: uid('obj'), kind: 'vector', shape: 'circle',
      label: `Lingkaran ${opts.objectCount + 1}`,
      points: [], d, closed: true, width: 28, price: 0, rowParams: null, seats: [],
      vTransform: { tx: 0, ty: 0, scale: 1 }, svgFill: '#93c5fd',
      svgStroke: { color: '#3b82f6', width: 2 },
      source: { origin: 'canvas', confidence: 1 }, guess: null,
    };
  }
  if (kind === 'stage') {
    if (!(w > SHAPE_MIN_RECT && h > SHAPE_MIN_RECT)) return null;
    const x0 = Math.min(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    return {
      id: uid('obj'), kind: 'stage', label: 'Panggung',
      points: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]],
      closed: true, width: 28, price: 0, rowParams: null, seats: [],
      source: { origin: 'canvas', confidence: 1 }, guess: null,
    };
  }
  // aisle: dua titik ujung jalur, lebar dari panel.
  if (!(Math.hypot(w, h) > SHAPE_MIN_AISLE)) return null;
  return {
    id: uid('obj'), kind: 'aisle', label: 'Lorong',
    points: [a, b], closed: false, width: opts.aisleWidth, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null,
  };
}

/** True bila gerak piksel layar dianggap seret (bukan klik). */
export function isDragGesture(dxPx: number, dyPx: number, thresholdPx = SHAPE_CLICK_DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dxPx, dyPx) >= thresholdPx;
}

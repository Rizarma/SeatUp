import type { Pt } from './venue';

export interface BBox { x: number; y: number; w: number; h: number; cx: number; cy: number; }

/** Bbox dari points (min 1 titik). w/h minimal 1 agar garis/hasil drag tipis tetap valid. */
export function bboxOf(points: Pt[]): BBox | null {
  if (points.length === 0) return null;
  let minX = points[0][0];
  let maxX = points[0][0];
  let minY = points[0][1];
  let maxY = points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return { x: minX, y: minY, w, h, cx: minX + w / 2, cy: minY + h / 2 };
}

export function centerOf(points: Pt[]): Pt | null {
  const b = bboxOf(points);
  return b ? [b.cx, b.cy] : null;
}

/** Serialisasi points untuk atribut SVG points. Satu sumber agar format konsisten. */
export function toPointsString(points: Pt[]): string {
  return points.map((p) => `${p[0]},${p[1]}`).join(' ');
}

export function translatePoints(points: Pt[], dx: number, dy: number): Pt[] {
  if (dx === 0 && dy === 0) return points;
  return points.map(([x, y]) => [x + dx, y + dy] as Pt);
}

/** Skala uniform terhadap pusat (cx,cy). k dibatasi agar tidak invert/hilang. */
export function scalePoints(points: Pt[], cx: number, cy: number, k: number): Pt[] {
  const kk = Math.max(0.05, Math.min(20, k));
  return points.map(([x, y]) => [cx + (x - cx) * kk, cy + (y - cy) * kk] as Pt);
}

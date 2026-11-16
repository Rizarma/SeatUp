import type { Pt, VenueObject } from './venue';

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

/**
 * Rotasi points sebesar angleDeg (derajat, searah jarum jam di koordinat SVG
 * y-bawah — sama seperti transformSeats) terhadap pusat (cx,cy).
 * Pusat default = pusat bbox (pola yang sama dengan transformSeats yang
 * memutar dari pusat susunan). Satu-satunya mutasi adalah koordinat baru;
 * id/label/metadata lain dipertahankan pemanggil (immutable).
 */
export function rotatePoints(points: Pt[], angleDeg: number, cx?: number, cy?: number): Pt[] {
  if (!Number.isFinite(angleDeg)) throw new Error('Sudut rotasi tak valid.');
  if (points.length === 0) return points;
  // Kelipatan penuh = identitas (tanpa error floating-point).
  if (angleDeg % 360 === 0) return points.slice();
  let px = cx;
  let py = cy;
  if (px === undefined || py === undefined || !Number.isFinite(px) || !Number.isFinite(py)) {
    const b = bboxOf(points);
    if (!b) return points.slice();
    px = b.cx;
    py = b.cy;
  }
  // Sudut siku-siku pakai cos/sin eksak agar bake 90°/180°/270° presisi
  // (Math.cos(90°) ≈ 6e-17 membuat snapshot ber-noise).
  const quarter = ((angleDeg % 360) + 360) % 360;
  let cos: number;
  let sin: number;
  if (quarter === 90) { cos = 0; sin = 1; }
  else if (quarter === 180) { cos = -1; sin = 0; }
  else if (quarter === 270) { cos = 0; sin = -1; }
  else {
    const rad = (angleDeg * Math.PI) / 180;
    cos = Math.cos(rad);
    sin = Math.sin(rad);
  }
  return points.map(([x, y]) => {
    const dx = x - (px as number);
    const dy = y - (py as number);
    return [px as number + dx * cos - dy * sin, py as number + dx * sin + dy * cos] as Pt;
  });
}

/** Normalisasi sudut ke (-180, 180] agar akumulasi putaran tak membesar. */
export function normalizeAngle(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) throw new Error('Sudut rotasi tak valid.');
  let a = angleDeg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  // Hindari -0 untuk konsistensi snapshot.
  return a === 0 ? 0 : a;
}

/**
 * Sudut rotasi efektif objek (derajat): vector dari vTransform.rotation,
 * shape points dari top-level rotation. Tak valid/null → 0.
 */
export function rotationOf(o: VenueObject): number {
  const r = o.kind === 'vector' ? o.vTransform?.rotation ?? 0 : o.rotation ?? 0;
  return Number.isFinite(r) ? r : 0;
}

/**
 * Tambah delta putaran ke objek (pola yang sama dengan transformSeats:
 * hitung dari posisi saat ini, commit 1 langkah undo oleh pemanggil).
 * Points TAK di-bake — sudut disimpan persisten agar panel/kanvas/containment
 * selalu membaca status yang sama. ID/label/points lain tetap.
 */
export function rotateShapeBy<T extends VenueObject>(o: T, deltaDeg: number): T {
  if (!Number.isFinite(deltaDeg)) throw new Error('Sudut rotasi tak valid.');
  const next = normalizeAngle(rotationOf(o) + deltaDeg);
  if (o.kind === 'vector') {
    const t = o.vTransform ?? { tx: 0, ty: 0, scale: 1 };
    return { ...o, vTransform: { ...t, rotation: next } };
  }
  return { ...o, rotation: next };
}

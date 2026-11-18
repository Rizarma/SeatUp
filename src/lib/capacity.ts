import type { Pt, VenueObject } from './venue';
import { discInside, resolvedPoints, type SectionGeom } from './contain';

export interface CapacityEstimate {
  /** Total slot grid yang muat secara geometri (di luar lorong). */
  total: number;
  /** Perkiraan sisa setelah dikurangi kursi valid yang sudah ada. */
  remaining: number;
  /** True bila memakai rumus luas kasar (grid eksak terlalu besar). */
  coarse: boolean;
}

function clearOfAisles(x: number, y: number, radius: number, aisles: VenueObject[]): boolean {
  return aisles.every((aisle) => {
    const pts = resolvedPoints(aisle);
    const half = (aisle.width ?? 28) / 2;
    return pts.slice(1).every((end, i) => {
      const start = pts[i];
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const len2 = dx * dx + dy * dy;
      const t = len2
        ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / len2))
        : 0;
      return Math.hypot(x - start[0] - t * dx, y - start[1] - t * dy) >= radius + half;
    });
  });
}

/**
 * Cache total geometri (tak tergantung jumlah kursi existing).
 * Kunci = signature geometri + langkah + lorong, sehingga:
 * - label/category saja (geometri sama) => hit, tanpa hitung ulang,
 * - geser lorong/titik/width/rotation => miss, hitung fresh,
 * - undo/redo kembali ke kunci lama => hit yang benar.
 * Map dibatasi (LRU sederhana) agar banyak edit tak tumbuh tanpa batas.
 */
const totalCache = new Map<string, number>();
const TOTAL_CACHE_LIMIT = 128;

/** Tes: bersihkan cache antar pengujian. */
export function __clearCapacityCacheForTest(): void {
  totalCache.clear();
}

/** Tes: ukuran cache (memastikan tak tumbuh tanpa batas). */
export function __capacityCacheSizeForTest(): number {
  return totalCache.size;
}

function geomSignature(geom: SectionGeom): string {
  // Ringkas namun eksak untuk invalidasi: jumlah ring/titik + bbox + checksum koordinat.
  let n = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let acc = 0;
  for (const ring of geom.rings) {
    for (const p of ring) {
      n++;
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      // checksum murah, dibulatkan 3 desimal agar stabil
      acc = (acc * 31 + Math.round(p[0] * 1000) + Math.round(p[1] * 1000) * 7) | 0;
    }
  }
  return `${geom.rings.length}:${n}:${geom.rule}:${minX.toFixed(3)},${minY.toFixed(3)},${maxX.toFixed(3)},${maxY.toFixed(3)}:${acc}`;
}

function aisleKey(aisles: VenueObject[]): string {
  if (aisles.length === 0) return '-';
  // Sertakan geometri lorong (points) agar geser/tambah titik menginvalidasi cache.
  // Points dibulatkan 3 desimal: murah (lorong sedikit) dan stabil terhadap noise float.
  return aisles.map((a) => {
    const pts = (a.points ?? []).map((p) => `${Number(p[0]).toFixed(3)},${Number(p[1]).toFixed(3)}`).join(';');
    return `${a.id}:${a.width ?? 28}:${a.rotation ?? 0}:${pts}`;
  }).join('|');
}

/**
 * Estimasi slot kursi baris lurus yang muat di section.
 * Grid: kolom selebar stepX, baris setinggi stepY, footprint cakram radius.
 * Sama asumsi dengan tool row: footprint penuh harus di dalam section,
 * di luar lorong. Kursi existing hanya mengurangi sisa (tak menggeser grid).
 */
export function estimateCapacity(
  geom: SectionGeom,
  stepX: number,
  stepY: number,
  radius: number,
  aisles: VenueObject[] = [],
  existingCount = 0,
): CapacityEstimate {
  const sx = Number.isFinite(stepX) && stepX > 0 ? stepX : 26;
  const sy = Number.isFinite(stepY) && stepY > 0 ? stepY : 34;
  const r = Number.isFinite(radius) && radius > 0 ? radius : 8;
  const points = geom.rings.flat();
  if (points.length === 0) return { total: 0, remaining: 0, coarse: false };
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));

  const cols = Math.max(0, Math.floor((maxX - minX - 2 * r) / sx) + 1);
  const rows = Math.max(0, Math.floor((maxY - minY - 2 * r) / sy) + 1);
  // Guard: skala super-kecil (mis. 0.1%) bisa meledak jadi miliaran sel.
  if (!Number.isFinite(cols * rows) || cols <= 0 || rows <= 0) {
    return { total: 0, remaining: 0, coarse: false };
  }
  // Total geometri murni fungsi (geometri, langkah, lorong): cache global berbatas.
  const key = `${geomSignature(geom)}|${sx}|${sy}|${r}|${aisleKey(aisles)}`;
  const hit = totalCache.get(key);
  if (hit !== undefined) {
    return { total: hit, remaining: Math.max(0, hit - existingCount), coarse: false };
  }
  if (cols * rows > 120000) {
    // Estimasi kasar: ukur fill-ratio lewat sampling 8px, lalu ekstrapolasi.
    const probe = 8;
    let hit = 0;
    let tried = 0;
    for (let y = minY + probe / 2; y <= maxY - probe / 2; y += probe) {
      for (let x = minX + probe / 2; x <= maxX - probe / 2; x += probe) {
        tried++;
        if (discInside(x, y, probe / 2, geom) && clearOfAisles(x, y, probe / 2, aisles)) hit++;
      }
      // Batasi sampling agar section raksasa tak freeze UI.
      if (tried > 60000) break;
    }
    const bboxArea = Math.max(0, (maxX - minX) * (maxY - minY));
    const total = tried > 0 ? Math.round((hit / tried) * (bboxArea / (sx * sy))) : 0;
    return { total, remaining: Math.max(0, total - existingCount), coarse: true };
  }

  let total = 0;
  for (let row = 0; row < rows; row++) {
    const y = minY + r + row * sy;
    for (let col = 0; col < cols; col++) {
      const x: Pt[0] = minX + r + col * sx;
      if (!discInside(x, y, r, geom)) continue;
      if (!clearOfAisles(x, y, r, aisles)) continue;
      total++;
    }
  }
  if (totalCache.size >= TOTAL_CACHE_LIMIT) {
    const oldest = totalCache.keys().next();
    if (!oldest.done) totalCache.delete(oldest.value);
  }
  totalCache.set(key, total);
  return { total, remaining: Math.max(0, total - existingCount), coarse: false };
}

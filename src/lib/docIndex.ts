import type { Seat, VenueDoc, VenueObject } from './venue';
import { categoryColorForSection, categoryPriceForSection } from './categories';

/**
 * Indeks dokumen turunan — dibangun ulang HANYA saat referensi doc/objects
 * berubah, TIDAK PERNAH saat kamera/hover/seleksi berubah.
 *
 * Menyediakan:
 * - lookup O(1): objectById, seatById, warna/harga section
 * - daftar seat per section / per objek baris (tanpa flatMap per render)
 * - uniform grid spasial untuk query viewport / hover-point / marquee-box
 */

export interface SeatRef {
  seat: Seat;
  objId: string;
}

export interface GridCell {
  /** index ke allSeats */
  idx: number[];
}

export class SeatGrid {
  readonly cell: number;
  readonly minX: number;
  readonly minY: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: GridCell[];

  constructor(cell: number, minX: number, minY: number, cols: number, rows: number) {
    this.cell = cell;
    this.minX = minX;
    this.minY = minY;
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: cols * rows }, () => ({ idx: [] }));
  }

  private cellOf(x: number, y: number): number {
    const c = Math.floor((x - this.minX) / this.cell);
    const r = Math.floor((y - this.minY) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  insert(i: number, x: number, y: number): void {
    const at = this.cellOf(x, y);
    if (at >= 0) this.cells[at].idx.push(i);
  }

  /** Index sel yang bersinggungan dengan bbox (sudah termasuk margin). */
  cellsInBox(x0: number, y0: number, x1: number, y1: number, out: number[]): number[] {
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x0 - this.minX) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.minX) / this.cell));
    const r0 = Math.max(0, Math.floor((y0 - this.minY) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - this.minY) / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) out.push(r * this.cols + c);
    }
    return out;
  }
}

export interface DocIndex {
  doc: VenueDoc;
  objectById: Map<string, VenueObject>;
  seatById: Map<string, { seat: Seat; objId: string }>;
  /** sectionId -> SeatRef[] (stabil selama doc tak berubah) */
  seatsBySection: Map<string, SeatRef[]>;
  /** row objectId -> Seat[] (referensi array asli bila tak berubah) */
  seatsByObject: Map<string, Seat[]>;
  /** semua seat datar beserta pemiliknya */
  allSeats: SeatRef[];
  sectionColor: Map<string, string>;
  sectionPrice: Map<string, number>;
  grid: SeatGrid;
  /** jumlah seat total */
  seatCount: number;
  /** radius seat terbesar (world) — untuk query titik & culling viewport. */
  maxRadius: number;
}

const indexStore = new WeakMap<VenueDoc, DocIndex>();
/**
 * Batas retensi indeks turunan (temuan P2 #4): history menyimpan hingga 60
 * revisi dokumen, tetapi indeks turunan (Maps + grid + array per revisi)
 * HANYA dipertahankan untuk revisi terbaru sebanyak batas ini. Revisi lama
 * yang keluar dari cache dibangun ulang secara deterministik saat undo
 * mengunjunginya kembali (tradeoff terukur: rebuild ~ms vs retensi MB).
 * Entri kuat (strong ref) dibatasi eksplisit; `clearDocIndexCache()` dipanggil
 * saat dokumen diganti (load) agar revisi lama tak tertahan di luar history.
 * Kamera/hover/seleksi tak mengubah referensi doc sehingga selalu hit.
 */
export const DOC_INDEX_CACHE_LIMIT = 4;
const indexLru: VenueDoc[] = [];

function touchIndexDoc(doc: VenueDoc): void {
  const at = indexLru.indexOf(doc);
  if (at >= 0) indexLru.splice(at, 1);
  indexLru.push(doc);
  while (indexLru.length > DOC_INDEX_CACHE_LIMIT) {
    const evicted = indexLru.shift()!;
    if (evicted !== doc) indexStore.delete(evicted);
  }
}

/** Kosongkan seluruh indeks turunan yang tertahan (dipakai saat ganti dokumen). */
export function clearDocIndexCache(): void {
  for (const d of indexLru) indexStore.delete(d);
  indexLru.length = 0;
}

/** Introspeksi batas retensi (dipakai tes regresi + bench). */
export function docIndexCacheSize(): number {
  return indexLru.length;
}

export function getDocIndex(doc: VenueDoc): DocIndex {
  const hit = indexStore.get(doc);
  if (hit) {
    touchIndexDoc(doc);
    return hit;
  }
  const idx = buildIndex(doc);
  indexStore.set(doc, idx);
  touchIndexDoc(doc);
  return idx;
}

function buildIndex(doc: VenueDoc): DocIndex {
  const objectById = new Map<string, VenueObject>();
  for (const o of doc.objects) objectById.set(o.id, o);

  const seatById = new Map<string, { seat: Seat; objId: string }>();
  const seatsBySection = new Map<string, SeatRef[]>();
  const seatsByObject = new Map<string, Seat[]>();
  const allSeats: SeatRef[] = [];

  // Warna/harga per section dihitung sekali per perubahan doc (bukan per seat render).
  const sectionColor = new Map<string, string>();
  const sectionPrice = new Map<string, number>();
  for (const o of doc.objects) {
    if (o.isSection) {
      sectionColor.set(o.id, categoryColorForSection(doc.objects, doc.categories, o.id));
      sectionPrice.set(o.id, categoryPriceForSection(doc.objects, doc.categories, o.id));
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxRadius = 8;
  for (const o of doc.objects) {
    if (o.seats.length === 0) continue;
    seatsByObject.set(o.id, o.seats);
    for (const s of o.seats) {
      const ref: SeatRef = { seat: s, objId: o.id };
      allSeats.push(ref);
      seatById.set(s.id, { seat: s, objId: o.id });
      if (s.sectionId) {
        let arr = seatsBySection.get(s.sectionId);
        if (!arr) {
          arr = [];
          seatsBySection.set(s.sectionId, arr);
        }
        arr.push(ref);
      }
      const rr = s.radius ?? 8;
      if (Number.isFinite(rr) && rr > maxRadius) maxRadius = rr;
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
    }
  }

  // Grid adaptif: target ~9 seat/sel agar query titik/box murah.
  // Seluruh seat harus tercakup: sel dibesarkan bila bentang butuh >512 kolom/baris.
  const n = Math.max(1, allSeats.length);
  const spanX = Number.isFinite(minX) ? Math.max(1, maxX - minX) : doc.width;
  const spanY = Number.isFinite(minY) ? Math.max(1, maxY - minY) : doc.height;
  const area = spanX * spanY;
  const want = Math.sqrt(area / n / 9);
  let cell = Math.max(24, Number.isFinite(want) && want > 0 ? want : 64);
  // Pastikan (span + margin 1 sel tiap sisi) muat dalam 512 sel:
  // (span + 2*cell)/cell <= 512  ->  cell >= span/510.
  if (Number.isFinite(spanX)) cell = Math.max(cell, spanX / 510);
  if (Number.isFinite(spanY)) cell = Math.max(cell, spanY / 510);
  // Batas atas longgar agar layout memanjang/sparse tetap tercakup.
  cell = Math.min(100000, cell);
  let gx0 = Number.isFinite(minX) ? minX - cell : 0;
  let gy0 = Number.isFinite(minY) ? minY - cell : 0;
  let gx1 = Number.isFinite(maxX) ? maxX + cell : doc.width;
  let gy1 = Number.isFinite(maxY) ? maxY + cell : doc.height;
  // Jaminan liputan: bila pembulatan masih butuh >512 sel, besarkan sel lagi.
  if ((gx1 - gx0) / cell > 512) cell = (gx1 - gx0) / 512;
  if ((gy1 - gy0) / cell > 512) cell = (gy1 - gy0) / 512;
  gx0 = Number.isFinite(minX) ? minX - cell : 0;
  gy0 = Number.isFinite(minY) ? minY - cell : 0;
  gx1 = Number.isFinite(maxX) ? maxX + cell : doc.width;
  gy1 = Number.isFinite(maxY) ? maxY + cell : doc.height;
  const cols = Math.max(1, Math.min(512, Math.ceil((gx1 - gx0) / cell)));
  const rows = Math.max(1, Math.min(512, Math.ceil((gy1 - gy0) / cell)));
  const grid = new SeatGrid(cell, gx0, gy0, cols, rows);
  for (let i = 0; i < allSeats.length; i++) {
    const s = allSeats[i].seat;
    grid.insert(i, s.x, s.y);
  }

  return {
    doc,
    objectById,
    seatById,
    seatsBySection,
    seatsByObject,
    allSeats,
    sectionColor,
    sectionPrice,
    grid,
    seatCount: allSeats.length,
    maxRadius,
  };
}

const scratchCells: number[] = [];

/**
 * Kandidat seat yang pusatnya dalam bbox world.
 * @param expand perluasan opsional (world) untuk culling viewport shape besar:
 *   pusat dalam bbox yang diperluas — pemanggil lalu memfilter overlap akurat.
 *   Marquee seleksi memakai expand=0 (pusat-dalam-kotak, tanpa perluasan).
 */
export function queryBox(
  idx: DocIndex,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: SeatRef[],
  expand = 0,
): SeatRef[] {
  out.length = 0;
  if (idx.allSeats.length === 0) return out;
  const ex = Number.isFinite(expand) && expand > 0 ? expand : 0;
  const qx0 = x0 - ex;
  const qy0 = y0 - ex;
  const qx1 = x1 + ex;
  const qy1 = y1 + ex;
  // Viewport raksasa (fit-all 50k) tak perlu lewat sel: kembalikan semua langsung.
  const bi = idx.grid;
  const boxW = qx1 - qx0;
  const boxH = qy1 - qy0;
  const gridW = bi.cols * bi.cell;
  const gridH = bi.rows * bi.cell;
  if (boxW >= gridW * 0.9 && boxH >= gridH * 0.9) {
    for (const ref of idx.allSeats) {
      const s = ref.seat;
      if (s.x >= qx0 && s.x <= qx1 && s.y >= qy0 && s.y <= qy1) out.push(ref);
    }
    return out;
  }
  idx.grid.cellsInBox(qx0, qy0, qx1, qy1, scratchCells);
  for (const c of scratchCells) {
    const cellRefs = bi.cells[c].idx;
    for (let k = 0; k < cellRefs.length; k++) {
      const ref = idx.allSeats[cellRefs[k]];
      const s = ref.seat;
      if (s.x >= qx0 && s.x <= qx1 && s.y >= qy0 && s.y <= qy1) out.push(ref);
    }
  }
  return out;
}

/**
 * Kandidat viewport dengan overlap bentuk (pusat boleh di luar viewport
 * selama lingkaran seat masih terlihat). Dipakai culling Canvas agar seat
 * berradius besar tak hilang di tepi.
 */
export function queryBoxVisible(
  idx: DocIndex,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: SeatRef[],
): SeatRef[] {
  queryBox(idx, x0, y0, x1, y1, out, idx.maxRadius);
  // Saring akurat: lingkaran seat menyentuh bbox (bukan sekadar pusat dekat).
  let w = 0;
  for (let i = 0; i < out.length; i++) {
    const s = out[i].seat;
    const r = s.radius ?? 8;
    if (s.x + r >= x0 && s.x - r <= x1 && s.y + r >= y0 && s.y - r <= y1) {
      out[w++] = out[i];
    }
  }
  out.length = w;
  return out;
}

/** Seat terdekat dalam radius r dari titik world; null bila tak ada. */
export function queryPoint(idx: DocIndex, x: number, y: number, r: number): SeatRef | null {
  if (idx.allSeats.length === 0) return null;
  // Cari seat yang titiknya berada dalam (radius seat + toleransi) dari pointer;
  // bila beberapa kandidat, pilih pusat terdekat.
  // Cakupan sel HARUS mencakup radius seat terbesar: seat besar dapat berada
  // di luar sel pointer meskipun lingkarannya memuat pointer.
  const pad = Math.max(r, 2);
  const search = pad + (Number.isFinite(idx.maxRadius) ? idx.maxRadius : 8);
  idx.grid.cellsInBox(x - search, y - search, x + search, y + search, scratchCells);
  let best: SeatRef | null = null;
  let bestD = Infinity;
  for (const c of scratchCells) {
    const cellRefs = idx.grid.cells[c].idx;
    for (let k = 0; k < cellRefs.length; k++) {
      const ref = idx.allSeats[cellRefs[k]];
      const s = ref.seat;
      const tol = (s.radius ?? 8) + pad;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= tol && d < bestD) {
        best = ref;
        bestD = d;
      }
    }
  }
  return best;
}

/** Jumlah seat milik section (O(1)). */
export function countSeatsInSection(idx: DocIndex, sectionId: string): number {
  return idx.seatsBySection.get(sectionId)?.length ?? 0;
}

/** Warna section (O(1), tanpa find per seat). */
export function colorForSection(idx: DocIndex, sectionId: string, fallback = '#94a3b3'): string {
  return idx.sectionColor.get(sectionId) ?? fallback;
}

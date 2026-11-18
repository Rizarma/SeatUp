import type { VenueDoc } from './venue';

/**
 * Transform + verifikasi edit massal label kursi (temuan P2 #2).
 * Seam produksi bersama: dipakai SidePanel (jalur klik pengguna), runner
 * bench S6 (lewat panel yang sama), dan tes regresi — satu implementasi,
 * bukan duplikat logika.
 */

export interface BulkLabelEdit {
  row?: string;
  number?: string;
}

/**
 * Ubah label baris/nomor HANYA untuk seat terpilih (immutable).
 * Melempar bila seleksi kosong/tak cocok — setup seleksi wajib, bukan SKIP.
 * Aturan aplikasi dipertahankan: id/koordinat/section/status/harga/radius
 * tak tersentuh; tepat satu pemanggilan = satu commit di level store.
 */
export function applyBulkSeatLabel(
  doc: VenueDoc,
  seatIds: Set<string> | string[],
  edit: BulkLabelEdit,
): VenueDoc {
  const ids = seatIds instanceof Set ? seatIds : new Set(seatIds);
  if (ids.size === 0) throw new Error('bulk edit tanpa seleksi: setup seleksi wajib sebelum timer (bukan SKIP)');
  if (edit.row === undefined && edit.number === undefined) {
    throw new Error('bulk edit tanpa perubahan label');
  }
  let touchedObjects = 0;
  const objects = doc.objects.map((o) => {
    if (!o.seats.some((s) => ids.has(s.id))) return o;
    touchedObjects++;
    return {
      ...o,
      seats: o.seats.map((s) => (ids.has(s.id)
        ? { ...s, row: edit.row !== undefined ? edit.row : s.row, number: edit.number !== undefined ? edit.number : s.number }
        : s)),
    };
  });
  if (touchedObjects === 0) throw new Error('bulk edit: seleksi tak cocok dengan objek baris mana pun');
  return { ...doc, objects };
}

/** Peta objek pemilik tiap seat terpilih (untuk verifikasi lintas-baris). */
export function ownerObjectsOf(doc: VenueDoc, seatIds: Set<string> | string[]): Map<string, string[]> {
  const ids = seatIds instanceof Set ? seatIds : new Set(seatIds);
  const out = new Map<string, string[]>();
  for (const o of doc.objects) {
    if (o.seats.length === 0) continue;
    const mine = o.seats.filter((s) => ids.has(s.id)).map((s) => s.id);
    if (mine.length > 0) out.set(o.id, mine);
  }
  return out;
}

export interface BulkVerifyArgs {
  before: VenueDoc;
  after: VenueDoc;
  seatIds: Set<string> | string[];
  edit: BulkLabelEdit;
}

/**
 * Verifikasi ISI dokumen sesudah edit massal; melempar bila:
 * - seat target tak berubah sesuai edit / berubah di luar edit,
 * - seat non-target berubah apa pun,
 * - id/koordinat/sectionId/status/harga/radius/number(row bila tak diedit) berubah.
 */
export function verifyBulkEditResult({ before, after, seatIds, edit }: BulkVerifyArgs): void {
  const ids = seatIds instanceof Set ? seatIds : new Set(seatIds);
  const beforeById = new Map(before.objects.flatMap((o) => o.seats).map((s) => [s.id, s]));
  const afterById = new Map(after.objects.flatMap((o) => o.seats).map((s) => [s.id, s]));
  if (beforeById.size !== afterById.size) {
    throw new Error(`bulk edit mengubah jumlah seat: ${beforeById.size} -> ${afterById.size}`);
  }
  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a) throw new Error(`bulk edit menghilangkan seat ${id}`);
    if (ids.has(id)) {
      if (edit.row !== undefined && a.row !== edit.row) {
        throw new Error(`bulk edit: seat ${id} row=${a.row}, harap ${edit.row}`);
      }
      if (edit.number !== undefined && a.number !== edit.number) {
        throw new Error(`bulk edit: seat ${id} number=${a.number}, harap ${edit.number}`);
      }
      if (edit.row === undefined && a.row !== b.row) throw new Error(`bulk edit: seat ${id} row ikut berubah`);
      if (edit.number === undefined && a.number !== b.number) throw new Error(`bulk edit: seat ${id} number ikut berubah`);
    } else if (a.row !== b.row || a.number !== b.number) {
      throw new Error(`bulk edit menyentuh seat non-target ${id}: row ${b.row}->${a.row}`);
    }
    if (a.x !== b.x || a.y !== b.y) throw new Error(`bulk edit menggeser koordinat seat ${id}`);
    if (a.sectionId !== b.sectionId) throw new Error(`bulk edit memindah section seat ${id}`);
    if (a.status !== b.status) throw new Error(`bulk edit mengubah status seat ${id}`);
    if (a.price !== b.price) throw new Error(`bulk edit mengubah harga seat ${id}`);
    if ((a.radius ?? 8) !== (b.radius ?? 8)) throw new Error(`bulk edit mengubah radius seat ${id}`);
  }
}

/** Verifikasi undo/redo: isi dokumen harus sama persis (per seat) dengan referensi. */
export function verifyBulkRestored(actual: VenueDoc, expected: VenueDoc, context: string): void {
  const aById = new Map(actual.objects.flatMap((o) => o.seats).map((s) => [s.id, s]));
  const eById = new Map(expected.objects.flatMap((o) => o.seats).map((s) => [s.id, s]));
  if (aById.size !== eById.size) throw new Error(`${context}: jumlah seat ${aById.size} != ${eById.size}`);
  for (const [id, e] of eById) {
    const a = aById.get(id);
    if (!a) throw new Error(`${context}: seat ${id} hilang`);
    if (a.row !== e.row || a.number !== e.number || a.x !== e.x || a.y !== e.y ||
      a.sectionId !== e.sectionId || a.status !== e.status || a.price !== e.price ||
      (a.radius ?? 8) !== (e.radius ?? 8)) {
      throw new Error(`${context}: seat ${id} berbeda (row ${e.row}->${a.row})`);
    }
  }
}

export interface MarqueeBandPlan {
  seatIds: string[];
  rowIds: string[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Rencana pita marquee deterministik: R objek baris pertama (urut y) pada
 * section fokus, dikecualikan objek raksasa (> maxSeatsPerObject) agar pita
 * 100/1.000/5.000 seat lintas banyak objek kecil, bukan menelan blok 12k.
 * Box = bbox seat ±1px; melempar bila ada seat section lain di dalam box
 * (stray) agar ekspektasi vs hasil marquee selalu eksak.
 */
export function planMarqueeBand(
  doc: VenueDoc,
  focusSectionId: string,
  rowCount: number,
  maxSeatsPerObject = 2000,
): MarqueeBandPlan {
  const rows = doc.objects
    .filter((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') &&
      o.seats.length > 0 && o.seats.length <= maxSeatsPerObject &&
      o.seats.some((s) => s.sectionId === focusSectionId))
    .sort((a, b) => Math.min(...a.seats.map((s) => s.y)) - Math.min(...b.seats.map((s) => s.y)));
  if (rows.length === 0) throw new Error('planMarqueeBand: tak ada baris kandidat (setup seleksi gagal)');
  const picked = rows.slice(0, Math.max(1, rowCount));
  const seatIds = picked.flatMap((o) => o.seats.map((s) => s.id));
  const xs = picked.flatMap((o) => o.seats.map((s) => s.x));
  const ys = picked.flatMap((o) => o.seats.map((s) => s.y));
  const box = { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 };
  const planned = new Set(seatIds);
  const strays = doc.objects
    .flatMap((o) => o.seats)
    .filter((s) => s.sectionId === focusSectionId && !planned.has(s.id) &&
      s.x >= box.x0 && s.x <= box.x1 && s.y >= box.y0 && s.y <= box.y1);
  if (strays.length > 0) {
    throw new Error(`planMarqueeBand: box menyentuh ${strays.length} seat di luar pita (${strays[0].id}) — pilih baris lain`);
  }
  return { seatIds, rowIds: picked.map((o) => o.id), box };
}

/**
 * Rencana kotak dalam SATU objek raksasa (blok multirow satu objek):
 * `count` seat pertama (urut y,x) + box eksaknya. Ekspektasi = seat objek
 * tersebut di dalam box (dihitung eksak, bukan asumsi).
 */
export function planBlockBox(doc: VenueDoc, objId: string, count: number): MarqueeBandPlan {
  const obj = doc.objects.find((o) => o.id === objId);
  if (!obj || obj.seats.length === 0) throw new Error(`planBlockBox: objek ${objId} tak ada/otomatis kosong`);
  const sorted = [...obj.seats].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const take = sorted.slice(0, Math.max(1, Math.min(count, sorted.length)));
  const box = {
    x0: Math.min(...take.map((s) => s.x)) - 1, y0: Math.min(...take.map((s) => s.y)) - 1,
    x1: Math.max(...take.map((s) => s.x)) + 1, y1: Math.max(...take.map((s) => s.y)) + 1,
  };
  const seatIds = obj.seats
    .filter((s) => s.x >= box.x0 && s.x <= box.x1 && s.y >= box.y0 && s.y <= box.y1)
    .map((s) => s.id);
  return { seatIds, rowIds: [obj.id], box };
}

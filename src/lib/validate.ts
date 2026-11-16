import type { VenueDoc, VenueObject, Seat, ObjKind, SeatStatus } from './venue';
import { normalizeSectionFlags } from './venue';

const KINDS: ObjKind[] = ['stage', 'aisle', 'section', 'row-straight', 'row-arc', 'import-draft', 'vector'];
const STATUSES: SeatStatus[] = ['available', 'pick', 'book', 'taken'];

function isPt(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function checkSeat(s: unknown, path: string, errors: string[]): void {
  const o = s as Record<string, unknown>;
  if (typeof o !== 'object' || o === null) {
    errors.push(`${path}: seat bukan objek`);
    return;
  }
  if (typeof o['id'] !== 'string') errors.push(`${path}: seat.id hilang`);
  if (typeof o['row'] !== 'string') errors.push(`${path}: seat.row hilang`);
  if (typeof o['number'] !== 'string') errors.push(`${path}: seat.number hilang`);
  if (typeof o['x'] !== 'number' || typeof o['y'] !== 'number') errors.push(`${path}: koordinat tak valid`);
  if (!STATUSES.includes(o['status'] as SeatStatus)) errors.push(`${path}: status tak dikenal`);
  if (typeof o['price'] !== 'number') errors.push(`${path}: price tak valid`);
  if (o['sectionId'] !== null && o['sectionId'] !== undefined && typeof o['sectionId'] !== 'string') {
    errors.push(`${path}: sectionId tak valid`);
  }
  if (o['radius'] !== undefined && (typeof o['radius'] !== 'number' || !Number.isFinite(o['radius']) || o['radius'] <= 0)) errors.push(`${path}: radius tak valid`);
  if (o['invalid'] !== undefined && typeof o['invalid'] !== 'boolean') errors.push(`${path}: invalid tak valid`);
}

function checkObject(o: unknown, path: string, errors: string[]): void {
  const v = o as Record<string, unknown>;
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: bukan objek`);
    return;
  }
  if (typeof v['id'] !== 'string') errors.push(`${path}: id hilang`);
  if (!KINDS.includes(v['kind'] as ObjKind)) errors.push(`${path}: kind tak dikenal`);
  if (typeof v['label'] !== 'string') errors.push(`${path}: label hilang`);
  if (!Array.isArray(v['points']) || !(v['points'] as unknown[]).every(isPt)) {
    errors.push(`${path}: points tak valid`);
  } else {
    const pts = v['points'] as [number, number][];
    // vektor: bentuk ada di `d`, points boleh kosong (seleksi via overlay path)
    const isClosed = v['closed'] === true;
    const need = v['kind'] === 'vector' ? 0 : v['kind'] === 'aisle' ? 2 : isClosed ? 3 : 1;
    if (pts.length < need) errors.push(`${path}: points kurang (${pts.length} < ${need})`);
  }
  if (typeof v['width'] !== 'number') errors.push(`${path}: width tak valid`);
  if (typeof v['price'] !== 'number') errors.push(`${path}: price tak valid`);
  if (typeof v['color'] !== 'undefined' && v['color'] !== null) {
    if (typeof v['color'] !== 'string' || !/^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))$/.test(v['color'])) {
      errors.push(`${path}: color tak valid`);
    }
  }
  if (v['isSection'] === true) {
    const kind = v['kind'] as string;
    const pts = v['points'];
    const n = Array.isArray(pts) ? pts.length : 0;
    const seats = (v['seats'] as unknown[]) ?? [];
    const closedOk = kind === 'section' ? v['closed'] === true && n >= 3 : kind === 'vector' ? typeof v['d'] === 'string' && /[Zz]/.test(v['d'] as string) : false;
    if ((kind !== 'section' && kind !== 'vector') || !closedOk || (Array.isArray(seats) && seats.length > 0)) {
      errors.push(`${path}: isSection tak valid untuk kind ${kind} (hanya polygon/vector tertutup tanpa kursi)`);
    }
  }
  if (v['rowParams'] !== null && v['rowParams'] !== undefined) {
    const r = v['rowParams'] as Record<string, unknown>;
    if (typeof r['rows'] !== 'number' || (r['rows'] as number) < 1 || (r['rows'] as number) > 200) {
      errors.push(`${path}: rowParams.rows di luar 1..200`);
    }
    if (typeof r['seatsPerRow'] !== 'number' || (r['seatsPerRow'] as number) < 1 || (r['seatsPerRow'] as number) > 500) {
      errors.push(`${path}: rowParams.seatsPerRow di luar 1..500`);
    }
  }
  if (v['shape'] !== undefined && v['shape'] !== null
    && v['shape'] !== 'polygon' && v['shape'] !== 'rect' && v['shape'] !== 'circle') {
    errors.push(`${path}: shape tak dikenal`);
  }
  if (v['kind'] === 'vector') {    const d = v['d'];
    if (typeof d !== 'string' || d.length === 0 || d.length > 200000) {
      errors.push(`${path}: vector.d tak valid`);
    } else if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(d)) {
      errors.push(`${path}: vector.d berisi karakter tak diizinkan`);
    }
    if (typeof d === 'string' && /<|>|script|javascript:/i.test(d)) errors.push(`${path}: vector.d mencurigakan`);
    const t = v['vTransform'] as Record<string, unknown> | null | undefined;
    if (t !== null && t !== undefined) {
      if (typeof t !== 'object' || typeof t['tx'] !== 'number' || typeof t['ty'] !== 'number' || typeof t['scale'] !== 'number') {
        errors.push(`${path}: vTransform tak valid`);
      }
    }
    const st = v['svgStroke'] as Record<string, unknown> | null | undefined;
    if (st !== null && st !== undefined) {
      const badColor = typeof st['color'] !== 'string' || !/^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|black|white)$/.test(st['color']);
      const badWidth = typeof st['width'] !== 'number' || !(st['width'] as number > 0) || (st['width'] as number) > 100;
      const badCap = st['linecap'] !== undefined && (typeof st['linecap'] !== 'string' || !/^(butt|round|square)$/.test(st['linecap']));
      const badJoin = st['linejoin'] !== undefined && (typeof st['linejoin'] !== 'string' || !/^(miter|round|bevel)$/.test(st['linejoin']));
      const badDash = st['dash'] !== undefined && (typeof st['dash'] !== 'string' || !/^[0-9eE.,\s]+$/.test(st['dash']));
      const badOp = st['opacity'] !== undefined && (typeof st['opacity'] !== 'number' || (st['opacity'] as number) < 0 || (st['opacity'] as number) > 1);
      if (badColor || badWidth || badCap || badJoin || badDash || badOp) errors.push(`${path}: svgStroke tak valid`);
    }
    const fo = v['svgFillOpacity'] as unknown;
    if (fo !== null && fo !== undefined && (typeof fo !== 'number' || (fo as number) < 0 || (fo as number) > 1)) {
      errors.push(`${path}: svgFillOpacity tak valid`);
    }
  }
  if (!Array.isArray(v['seats'])) {
    errors.push(`${path}: seats bukan array`);
  } else {
    (v['seats'] as unknown[]).forEach((s, i) => checkSeat(s, `${path}.seats[${i}]`, errors));
  }
}

export function validateVenueDoc(doc: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const v = doc as Record<string, unknown>;
  if (typeof v !== 'object' || v === null) return { ok: false, errors: ['dokumen bukan objek'] };
  if (typeof v['id'] !== 'string') errors.push('id hilang');
  if (typeof v['name'] !== 'string') errors.push('name hilang');
  if (typeof v['width'] !== 'number' || typeof v['height'] !== 'number') errors.push('width/height tak valid');
  if (v['backgroundImage'] !== null && typeof v['backgroundImage'] !== 'string') {
    errors.push('backgroundImage harus string|null');
  }
  if (!Array.isArray(v['objects'])) {
    errors.push('objects bukan array');
  } else {
    (v['objects'] as unknown[]).forEach((o, i) => checkObject(o, `objects[${i}]`, errors));
  }
  return { ok: errors.length === 0, errors };
}

export function parseVenueJson(text: string): { doc: VenueDoc | null; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { doc: null, errors: ['JSON tidak bisa diparse'] };
  }
  // Dokumen lama dengan flag section tak valid tetap dibuka: lucuti dulu.
  const r = raw as { objects?: VenueObject[] };
  if (r && typeof r === 'object' && Array.isArray(r.objects)) {
    const norm = normalizeSectionFlags(r.objects);
    if (norm.objects !== r.objects) raw = { ...(r as object), objects: norm.objects };
  }
  const v = validateVenueDoc(raw);
  if (!v.ok) return { doc: null, errors: v.errors };
  return { doc: raw as VenueDoc, errors: [] };
}

export type { Seat, VenueObject };

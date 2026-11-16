export type Pt = [number, number];
export type ObjKind = 'stage' | 'aisle' | 'section' | 'row-straight' | 'row-arc' | 'import-draft' | 'vector';
export type ImportGuess = 'stage' | 'catwalk' | 'tribune-band' | 'side-block' | 'floor' | 'unknown';
export type SeatStatus = 'available' | 'pick' | 'book' | 'taken';

export interface Seat {
  id: string;
  row: string;
  number: string;
  x: number;
  y: number;
  status: SeatStatus;
  price: number;
  /** Section pemilik (persisten). null = kursi lama tanpa section. */
  sectionId: string | null;
  /** True bila footprint keluar section (hasil revalidasi). */
  invalid?: boolean;
  /** Radius footprint dalam koordinat venue; default 8 untuk data lama. */
  radius?: number;
}

export interface RowParams {
  mode: 'straight' | 'arc';
  rows: number;
  seatsPerRow: number;
  seatGap: number;
  rowGap: number;
  angleDeg: number;
  radius: number;
  spanDeg: number;
  startDeg: number;
  rowLabelOffset: number;
}

export interface VenueObject {
  id: string;
  kind: ObjKind;
  label: string;
  /** Jenis bentuk geometri (display saja; kind internal tetap untuk kompatibilitas). */
  shape?: 'polygon' | 'rect' | 'circle' | null;
  points: Pt[];
  closed: boolean;
  width: number;
  price: number;
  rowParams: RowParams | null;
  seats: Seat[];
  source: { origin: 'canvas' | 'import-draft' | 'svg-import'; confidence: number };
  guess: ImportGuess | null;
  /** Tandai sebagai section: kursi hanya boleh dibuat/di dalamnya. */
  isSection?: boolean;
  /** Warna identitas section (tipe tiket). Opsional; fallback palet bila kosong. */
  color?: string | null;
  /** Section pemilik baris ini (diisi saat baris dibuat). */
  sectionId?: string | null;
  /** Path mentah untuk kind 'vector' — dipertahankan verbatim, tidak diubah editor. */
  d?: string | null;
  /** Transform tampil vektor: canvas = scale*path + (tx,ty). */
  vTransform?: { tx: number; ty: number; scale: number } | null;
  /** Warna + fill-rule asli path vektor (holes via evenodd tetap utuh). */
  svgFill?: string | null;
  svgFillRule?: 'evenodd' | 'nonzero' | null;
  /** Opasitas isi gabungan (opacity × fill-opacity), bila ada. */
  svgFillOpacity?: number | null;
  /** Stroke asli path vektor (diwarisi bila ada). Null = tanpa stroke (default SVG). */
  svgStroke?: {
    color: string;
    width: number;
    linecap?: string;
    linejoin?: string;
    dash?: string;
    dashOffset?: number;
    opacity?: number;
  } | null;
}

export interface VenueDoc {
  id: string;
  name: string;
  units: 'px';
  width: number;
  height: number;
  backgroundImage: string | null;
  objects: VenueObject[];
}

let fallbackCounter = 0;
/** ID unik: crypto.randomUUID bila tersedia, fallback acak + waktu + counter. */
export function uid(prefix: string): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return `${prefix}-${c.randomUUID()}`;
    } catch {
      // jatuh ke fallback di bawah
    }
  }
  fallbackCounter += 1;
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${rand}`;
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function labelAt(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export interface GenSeat {
  row: string;
  number: string;
  x: number;
  y: number;
}

export function straightSeats(
  origin: Pt,
  angleDeg: number,
  rows: number,
  seatsPerRow: number,
  seatGap: number,
  rowGap: number,
  rowLabelOffset: number,
): GenSeat[] {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const nx = -dy;
  const ny = dx;
  const out: GenSeat[] = [];
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < seatsPerRow; s++) {
      out.push({
        row: labelAt(rowLabelOffset + r),
        number: String(s + 1),
        x: origin[0] + dx * s * seatGap + nx * r * rowGap,
        y: origin[1] + dy * s * seatGap + ny * r * rowGap,
      });
    }
  }
  return out;
}

export function arcSeats(
  center: Pt,
  radius: number,
  rowGap: number,
  startDeg: number,
  spanDeg: number,
  rows: number,
  seatsPerRow: number,
  rowLabelOffset: number,
): GenSeat[] {
  const out: GenSeat[] = [];
  for (let r = 0; r < rows; r++) {
    const rad = radius + r * rowGap;
    for (let s = 0; s < seatsPerRow; s++) {
      const t = seatsPerRow === 1 ? 0.5 : s / (seatsPerRow - 1);
      const deg = startDeg + spanDeg * t;
      const a = (deg * Math.PI) / 180;
      out.push({
        row: labelAt(rowLabelOffset + r),
        number: String(s + 1),
        x: center[0] + rad * Math.cos(a),
        y: center[1] + rad * Math.sin(a),
      });
    }
  }
  return out;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

export function douglasPeucker(points: Pt[], eps: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = douglasPeucker(points.slice(0, idx + 1), eps);
    const right = douglasPeucker(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

export function polygonArea(points: Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

export function makeObject(partial: Partial<VenueObject> & { kind: ObjKind; label: string }): VenueObject {
  return {
    id: uid('obj'),
    points: [],
    closed: true,
    width: 28,
    price: 0,
    rowParams: null,
    seats: [],
    source: { origin: 'canvas', confidence: 1 },
    guess: null,
    isSection: false,
    sectionId: null,
    color: null,
    d: null,
    vTransform: null,
    svgFill: null,
    svgFillRule: null,
    svgFillOpacity: null,
    svgStroke: null,
    ...partial,
    kind: partial.kind,
    label: partial.label,
  };
}

export function emptyVenue(): VenueDoc {
  return {
    id: uid('venue'),
    name: 'Venue tanpa judul',
    units: 'px',
    width: 1200,
    height: 800,
    backgroundImage: null,
    objects: [],
  };
}

/** Contoh venue-U agar reviewer langsung melihat row melengkung. */
export function sampleVenue(): VenueDoc {
  const doc = emptyVenue();
  doc.name = 'Contoh Venue-U (sintetis)';
  const stage = makeObject({
    kind: 'stage',
    label: 'Panggung',
    points: [[480, 60], [720, 60], [720, 150], [480, 150]],
    closed: true,
  });
  const arcParams: RowParams = {
    mode: 'arc', rows: 3, seatsPerRow: 14, seatGap: 26, rowGap: 34,
    angleDeg: 0, radius: 230, spanDeg: 140, startDeg: 20, rowLabelOffset: 0,
  };
  const arcSeatsList = arcSeats([600, 400], 230, 34, 20, 140, 3, 14, 0);
  const arc = makeObject({
    kind: 'row-arc',
    label: 'Tribun U',
    points: [[600, 400]],
    closed: false,
    price: 150000,
    rowParams: arcParams,
    seats: arcSeatsList.map((s, i) => ({
      id: `seat-arc-${i}`, row: s.row, number: s.number,
      x: s.x, y: s.y, status: 'available' as SeatStatus, price: 150000, sectionId: null,
    })),
  });
  const sideParams: RowParams = {
    mode: 'straight', rows: 4, seatsPerRow: 6, seatGap: 26, rowGap: 30,
    angleDeg: 90, radius: 0, spanDeg: 0, startDeg: 20, rowLabelOffset: 3,
  };
  const stSeats = straightSeats([120, 300], 90, 4, 6, 26, 30, 3);
  const side = makeObject({
    kind: 'row-straight',
    label: 'Blok Kiri',
    points: [[120, 300]],
    closed: false,
    price: 100000,
    rowParams: sideParams,
    seats: stSeats.map((s, i) => ({
      id: `seat-side-${i}`, row: s.row, number: s.number,
      x: s.x, y: s.y, status: 'available' as SeatStatus, price: 100000, sectionId: null,
    })),
  });
  doc.objects = [stage, arc, side];
  return doc;
}

/**
 * Normalisasi flag section: hanya kind 'section' (polygon tertutup) dan
 * 'vector' (path tertutup) tanpa kursi yang boleh isSection. Flag tak valid
 * dari dokumen lama dilucuti (false) agar impor/penyimpanan lama tetap
 * terbuka; keputusan dilapor ke pemanggil via `stripped`.
 */
export function normalizeSectionFlags<T extends VenueObject>(objects: T[]): { objects: T[]; stripped: string[] } {
  const stripped: string[] = [];
  let changed = false;
  const next = objects.map((o) => {
    if (!o.isSection) return o;
    const eligible =
      (o.kind === 'section' && o.closed && o.points.length >= 3 && o.seats.length === 0) ||
      (o.kind === 'vector' && !!o.d && /[Zz]/.test(o.d));
    if (!eligible) {
      changed = true;
      stripped.push(o.id);
      return { ...o, isSection: false };
    }
    return o;
  });
  return { objects: changed ? next : objects, stripped };
}

import type { Pt, VenueObject } from './venue';

/**
 * Containment kursi-di-dalam-section berbasis footprint (cakram), BUKAN
 * pusat-saja dan BUKAN bbox. Toleransi eksplisit:
 * - SEAT_R = 8 (satuan kanvas px): radius footprint kursi.
 * - FLAT_TOL = 0.5 (satuan path): deviasi maksimum flattening kurva.
 * Kurva (C/S/Q/T/A) di-flatten jadi polyline; uji jarak memakai segmen hasil
 * flatten, jadi akurat dalam ±FLAT_TOL untuk sisi lengkung.
 */

export const SEAT_R = 8;
export const FLAT_TOL = 0.5;

export type FillRule = 'evenodd' | 'nonzero';

export interface SectionGeom {
  rings: Pt[][];
  rule: FillRule;
}

function distPtSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ray-casting: kembalikan {crossings, winding} untuk satu titik. */
function rayStats(x: number, y: number, rings: Pt[][]): { crossings: number; winding: number } {
  let crossings = 0;
  let winding = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if ((a[1] > y) !== (b[1] > y)) {
        const xi = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        if (xi > x) {
          crossings++;
          winding += b[1] > a[1] ? 1 : -1;
        }
      }
    }
  }
  return { crossings, winding };
}

export function pointInside(x: number, y: number, sec: SectionGeom): boolean {
  const s = rayStats(x, y, sec.rings);
  return sec.rule === 'evenodd' ? s.crossings % 2 === 1 : s.winding !== 0;
}

export function distToSection(x: number, y: number, sec: SectionGeom): number {
  let m = Infinity;
  for (const ring of sec.rings) {
    for (let i = 0; i < ring.length; i++) {
      const d = distPtSeg([x, y], ring[i], ring[(i + 1) % ring.length]);
      if (d < m) m = d;
    }
  }
  return m;
}

/** Seluruh cakram (pusat + radius r) harus di dalam section. */
export function discInside(x: number, y: number, r: number, sec: SectionGeom): boolean {
  if (!pointInside(x, y, sec)) return false;
  return distToSection(x, y, sec) >= r - 1e-9;
}

/* ---------- flattening path SVG ---------- */

interface Tok { cmd: string; rel: boolean; nums: number[]; }

function tokenize(d: string): Tok[] {
  const out: Tok[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  let cur: Tok | null = null;
  for (;;) {
    m = re.exec(d);
    if (!m) break;
    if (m[1]) {
      cur = { cmd: m[1].toUpperCase(), rel: m[1] !== m[1].toUpperCase(), nums: [] };
      out.push(cur);
      if (cur.cmd === 'Z') cur = null;
    } else if (cur) {
      cur.nums.push(Number(m[2]));
    }
  }
  return out;
}

function cubicFlat(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, out: Pt[]): void {
  const ux = 3 * p1[0] - 2 * p0[0] - p3[0];
  const uy = 3 * p1[1] - 2 * p0[1] - p3[1];
  const vx = 3 * p2[0] - 2 * p3[0] - p0[0];
  const vy = 3 * p2[1] - 2 * p3[1] - p0[1];
  const u = Math.max(Math.abs(ux), Math.abs(uy));
  const v = Math.max(Math.abs(vx), Math.abs(vy));
  if ((u + v) / 16 <= tol) {
    out.push(p3);
    return;
  }
  const m01: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m23: Pt = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const m012: Pt = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  const m123: Pt = [(m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2];
  const mid: Pt = [(m012[0] + m123[0]) / 2, (m012[1] + m123[1]) / 2];
  cubicFlat(p0, m01, m012, mid, tol, out);
  cubicFlat(mid, m123, m23, p3, tol, out);
}

function quadFlat(p0: Pt, p1: Pt, p2: Pt, tol: number, out: Pt[]): void {
  const mx = (p0[0] + p2[0]) / 2;
  const my = (p0[1] + p2[1]) / 2;
  if (Math.hypot(p1[0] - mx, p1[1] - my) / 2 <= tol) {
    out.push(p2);
    return;
  }
  const a: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const b: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  quadFlat(p0, a, mid, tol, out);
  quadFlat(mid, b, p2, tol, out);
}

/** Konversi busur elips endpoint -> segmen kubik (subdivisi <=90°). */
function arcToCubics(x0: Pt, rx: number, ry: number, rot: number, large: number, sweep: number, x1: Pt): Pt[][] {
  const phi = (rot * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0[0] - x1[0]) / 2;
  const dy = (x0[1] - x1[1]) / 2;
  const X = cos * dx + sin * dy;
  const Y = -sin * dx + cos * dy;
  let rx2 = Math.abs(rx);
  let ry2 = Math.abs(ry);
  const lam = (X * X) / (rx2 * rx2) + (Y * Y) / (ry2 * ry2);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx2 *= s;
    ry2 *= s;
  }
  const num = rx2 * rx2 * ry2 * ry2 - rx2 * rx2 * Y * Y - ry2 * ry2 * X * X;
  const den = rx2 * rx2 * Y * Y + ry2 * ry2 * X * X;
  let f = den <= 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) f = -f;
  const cxp = (f * rx2 * Y) / ry2;
  const cyp = (-f * ry2 * X) / rx2;
  const cx = cos * cxp - sin * cyp + (x0[0] + x1[0]) / 2;
  const cy = sin * cxp + cos * cyp + (x0[1] + x1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const dd = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = dd === 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / dd)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const t1 = ang(1, 0, (X - cxp) / rx2, (Y - cyp) / ry2);
  let dt = ang((X - cxp) / rx2, (Y - cyp) / ry2, (-X - cxp) / rx2, (-Y - cyp) / ry2);
  if (sweep === 0 && dt > 0) dt -= 2 * Math.PI;
  if (sweep === 1 && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const segs: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const a0 = t1 + (dt * i) / n;
    const a1 = t1 + (dt * (i + 1)) / n;
    const k = (4 / 3) * Math.tan((a1 - a0) / 4);
    const p = (a: number): Pt => [
      cx + rx2 * Math.cos(a) * cos - ry2 * Math.sin(a) * sin,
      cy + rx2 * Math.cos(a) * sin + ry2 * Math.sin(a) * cos,
    ];
    const dv = (a: number): Pt => [
      cx + rx2 * -Math.sin(a) * cos - ry2 * Math.cos(a) * sin,
      cy + rx2 * -Math.sin(a) * sin + ry2 * Math.cos(a) * cos,
    ];
    const P0 = p(a0);
    const P1 = p(a1);
    const d0 = dv(a0);
    const d1 = dv(a1);
    const C0: Pt = [P0[0] + k * d0[0], P0[1] + k * d0[1]];
    const C1: Pt = [P1[0] - k * d1[0], P1[1] - k * d1[1]];
    segs.push([P0, C0, C1, P1]);
  }
  return segs;
}

/** Flatten path `d` menjadi ring-ring polyline. Dukung M L H V C S Q T A Z. */
export function flattenPath(d: string, tol = FLAT_TOL): Pt[][] {
  const toks = tokenize(d);
  const rings: Pt[][] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let ring: Pt[] = [];
  let prevCubic: Pt | null = null;
  let prevQuad: Pt | null = null;
  const lineTo = (p: Pt) => {
    cur = p;
    ring.push([p[0], p[1]]);
    prevCubic = null;
    prevQuad = null;
  };
  const need = (t: Tok, n: number): boolean => t.nums.length >= n;
  for (const t of toks) {
    const P = (x: number, y: number): Pt => (t.rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    switch (t.cmd) {
      case 'M': {
        if (ring.length > 0) rings.push(ring);
        ring = [];
        for (let i = 0; i + 1 < t.nums.length; i += 2) {
          const p = P(t.nums[i], t.nums[i + 1]);
          cur = p;
          if (i === 0) start = [p[0], p[1]];
          ring.push([p[0], p[1]]);
        }
        prevCubic = prevQuad = null;
        break;
      }
      case 'L':
        if (need(t, 2)) for (let i = 0; i + 1 < t.nums.length; i += 2) lineTo(P(t.nums[i], t.nums[i + 1]));
        break;
      case 'H':
        if (need(t, 1)) for (const v of t.nums) lineTo(t.rel ? [cur[0] + v, cur[1]] : [v, cur[1]]);
        break;
      case 'V':
        if (need(t, 1)) for (const v of t.nums) lineTo(t.rel ? [cur[0], cur[1] + v] : [cur[0], v]);
        break;
      case 'C':
        if (need(t, 6)) {
          for (let i = 0; i + 5 < t.nums.length; i += 6) {
            const p1 = P(t.nums[i], t.nums[i + 1]);
            const p2 = P(t.nums[i + 2], t.nums[i + 3]);
            const p3 = P(t.nums[i + 4], t.nums[i + 5]);
            const out: Pt[] = [];
            cubicFlat(cur, p1, p2, p3, tol, out);
            for (const q of out) lineTo(q);
            prevCubic = p2;
          }
        }
        break;
      case 'S': {
        if (need(t, 4)) {
          for (let i = 0; i + 3 < t.nums.length; i += 4) {
            const r1: Pt = prevCubic ? [2 * cur[0] - prevCubic[0], 2 * cur[1] - prevCubic[1]] : [cur[0], cur[1]];
            const p2 = P(t.nums[i], t.nums[i + 1]);
            const p3 = P(t.nums[i + 2], t.nums[i + 3]);
            const out: Pt[] = [];
            cubicFlat(cur, r1, p2, p3, tol, out);
            for (const q of out) lineTo(q);
            prevCubic = p2;
          }
        }
        break;
      }
      case 'Q': {
        if (need(t, 4)) {
          for (let i = 0; i + 3 < t.nums.length; i += 4) {
            const p1 = P(t.nums[i], t.nums[i + 1]);
            const p2 = P(t.nums[i + 2], t.nums[i + 3]);
            const out: Pt[] = [];
            quadFlat(cur, p1, p2, tol, out);
            for (const q of out) lineTo(q);
            prevQuad = p1;
          }
        }
        break;
      }
      case 'T': {
        if (need(t, 2)) {
          for (let i = 0; i + 1 < t.nums.length; i += 2) {
            const r1: Pt = prevQuad ? [2 * cur[0] - prevQuad[0], 2 * cur[1] - prevQuad[1]] : [cur[0], cur[1]];
            const p2 = P(t.nums[i], t.nums[i + 1]);
            const out: Pt[] = [];
            quadFlat(cur, r1, p2, tol, out);
            for (const q of out) lineTo(q);
            prevQuad = r1;
          }
        }
        break;
      }
      case 'A': {
        if (need(t, 7)) {
          for (let i = 0; i + 6 < t.nums.length; i += 7) {
            const rx = t.nums[i];
            const ry = t.nums[i + 1];
            const rot = t.nums[i + 2];
            const large = t.nums[i + 3];
            const sweep = t.nums[i + 4];
            const p1 = P(t.nums[i + 5], t.nums[i + 6]);
            if (rx <= 0 || ry <= 0) {
              lineTo(p1);
              continue;
            }
            for (const seg of arcToCubics(cur, rx, ry, rot, large, sweep, p1)) {
              const out: Pt[] = [];
              cubicFlat(seg[0], seg[1], seg[2], seg[3], tol, out);
              for (const q of out) lineTo(q);
            }
            prevCubic = prevQuad = null;
          }
        }
        break;
      }
      case 'Z':
        if (ring.length > 0) {
          ring.push([start[0], start[1]]);
          rings.push(ring);
          ring = [];
        }
        cur = [start[0], start[1]];
        prevCubic = prevQuad = null;
        break;
      default:
        break;
    }
  }
  if (ring.length > 0) rings.push(ring);
  return rings.filter((r) => r.length >= 3);
}

/** True bila setiap subpath diakhiri Z (layak jadi section tertutup). */
export function isClosedPath(d: string): boolean {
  const toks = tokenize(d);
  let hasM = false;
  let open = false;
  for (const t of toks) {
    if (t.cmd === 'M') {
      if (open) return false;
      hasM = true;
      open = true;
    } else if (t.cmd === 'Z') {
      open = false;
    }
  }
  return hasM && !open;
}

/** Geometri section siap uji (koordinat kanvas) atau null bila tak layak. */
export function sectionGeomFor(obj: VenueObject): SectionGeom | null {
  if (!obj.isSection) return null;
  if (obj.kind === 'vector') {
    if (!obj.d) return null;
    const rings = flattenPath(obj.d);
    if (rings.length === 0) return null;
    const t = obj.vTransform ?? { tx: 0, ty: 0, scale: 1 };
    const mapped = rings.map((r) => r.map(([x, y]) => [t.tx + x * t.scale, t.ty + y * t.scale] as Pt));
    return { rings: mapped, rule: obj.svgFillRule ?? 'nonzero' };
  }
  if (obj.kind === 'stage' || obj.kind === 'section' || obj.kind === 'import-draft') {
    if (!obj.closed || obj.points.length < 3) return null;
    return { rings: [obj.points.map((p) => [p[0], p[1]] as Pt)], rule: 'evenodd' };
  }
  return null;
}

/** Klasifikasikan kandidat kursi terhadap section (footprint penuh). */
export function classifySeats(cands: Array<{ x: number; y: number }>, sec: SectionGeom, r = SEAT_R): boolean[] {
  return cands.map((c) => discInside(c.x, c.y, r, sec));
}

/**
 * Hitung ulang flag invalid untuk seluruh kursi ber-sectionId.
 * Dipakai otomatis setiap commit agar edit section/row langsung konsisten.
 */
export function revalidateSeats<T extends VenueObject>(objects: T[]): { objects: T[]; invalidCount: number } {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const geomCache = new Map<string, SectionGeom | null>();
  const geomOf = (id: string): SectionGeom | null => {
    if (!geomCache.has(id)) {
      const s = byId.get(id);
      geomCache.set(id, s ? sectionGeomFor(s) : null);
    }
    return geomCache.get(id) ?? null;
  };
  let invalidCount = 0;
  const next = objects.map((o) => {
    if (!o.seats || o.seats.length === 0) return o;
    let changed = false;
    const seats = o.seats.map((s) => {
      if (!s.sectionId) {
        if (s.invalid) {
          changed = true;
          return { ...s, invalid: false as boolean | undefined };
        }
        return s;
      }
      const g = geomOf(s.sectionId);
      const bad = !g || !discInside(s.x, s.y, s.radius ?? SEAT_R, g);
      if (bad) invalidCount++;
      if (s.invalid === undefined || (s.invalid ?? false) !== bad) {
        changed = true;
        return { ...s, invalid: bad };
      }
      return s;
    });
    return changed ? { ...o, seats } : o;
  });
  return { objects: next, invalidCount };
}

import type { Pt, VenueObject } from './venue';
import { uid } from './venue';

/**
 * Impor layout SVG sebagai objek vektor terpisah (bentuk path dipertahankan
 * verbatim — curves, subpaths, holes via fill-rule tetap utuh).
 *
 * Keamanan: tidak ada raw SVG injection. Hanya elemen shape yang di-allowlist
 * (path/rect/circle/ellipse/line/polyline/polygon); script, style,
 * foreignObject, image, use, text, dan semua atribut event/eksternal dibuang.
 * Path `d` hanya boleh berisi karakter perintah path + angka.
 */

export interface SvgImportResult {
  objects: VenueObject[];
  viewBox: [number, number];
  found: number;
  skipped: string[];
}

const DROP = new Set(['script', 'style', 'foreignobject', 'image', 'use', 'text', 'tspan', 'defs', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient']);

const D_OK = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
const FILL_OK = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|black|white|none)$/;
const LABEL_OK = /^[A-Za-z0-9 _\-.]{1,80}$/;
const NUM_OK = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function num(v: string | null, fallback = 0): number {
  if (v === null || v === null || v === undefined) return fallback;
  const t = v.trim();
  if (!NUM_OK.test(t)) return fallback;
  const n = Number(t);
  return Number.isFinite(n) ? n : fallback;
}

function pointsAttr(v: string | null): Pt[] {
  if (!v) return [];
  const nums = v.trim().split(/[\s,]+/).filter(Boolean);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (!NUM_OK.test(nums[i]) || !NUM_OK.test(nums[i + 1])) return [];
    pts.push([Number(nums[i]), Number(nums[i + 1])]);
  }
  return pts;
}

function shapeToD(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'path') {
    const d = (el.getAttribute('d') || '').trim();
    if (!d || d.length > 200000) return null;
    if (!D_OK.test(d)) return null;
    return d;
  }
  if (tag === 'rect') {
    const x = num(el.getAttribute('x'));
    const y = num(el.getAttribute('y'));
    const w = num(el.getAttribute('width'));
    const h = num(el.getAttribute('height'));
    if (!(w > 0 && h > 0)) return null;
    return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  }
  if (tag === 'circle') {
    const cx = num(el.getAttribute('cx'));
    const cy = num(el.getAttribute('cy'));
    const r = num(el.getAttribute('r'));
    if (!(r > 0)) return null;
    return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
  }
  if (tag === 'ellipse') {
    const cx = num(el.getAttribute('cx'));
    const cy = num(el.getAttribute('cy'));
    const rx = num(el.getAttribute('rx'));
    const ry = num(el.getAttribute('ry'));
    if (!(rx > 0 && ry > 0)) return null;
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
  }
  if (tag === 'line') {
    const x1 = num(el.getAttribute('x1'));
    const y1 = num(el.getAttribute('y1'));
    const x2 = num(el.getAttribute('x2'));
    const y2 = num(el.getAttribute('y2'));
    return `M${x1} ${y1}L${x2} ${y2}`;
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const pts = pointsAttr(el.getAttribute('points'));
    if (pts.length < 2) return null;
    const d = 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L') + (tag === 'polygon' ? 'Z' : '');
    return D_OK.test(d) ? d : null;
  }
  return null;
}

function cleanFill(v: string | null): string {
  if (v === null || v === undefined || v.trim() === '') return 'black'; // default SVG
  const t = v.trim();
  if (FILL_OK.test(t)) return t;
  return '#64748b';
}

const LINECAP_OK = /^(butt|round|square)$/;
const LINEJOIN_OK = /^(miter|round|bevel)$/;
const DASH_OK = /^[0-9eE.,\s]+$/;

function cleanOpacity(v: string | null): number | null {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v.trim());
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function cleanWidth(v: string | null): number | null {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v.trim());
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return n;
}

function cleanDash(v: string | null): string | undefined {
  if (v === null || v === undefined) return undefined;
  const t = v.trim();
  if (t === '' || t === 'none') return undefined;
  if (!DASH_OK.test(t)) return undefined;
  const parts = t.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => NUM_OK.test(p) && Number(p) >= 0)) return undefined;
  return parts.join(' ');
}

/** Ambil atribut presentasi dengan inheritance (self menang atas ancestor). */
function inherited(chain: Element[], name: string): string | null {
  let v: string | null = null;
  for (const node of chain) {
    const a = node.getAttribute(name);
    if (a !== null) v = a;
  }
  return v;
}

function shapeForTag(tag: string): 'polygon' | 'rect' | 'circle' | null {
  if (tag === 'rect') return 'rect';
  if (tag === 'circle' || tag === 'ellipse') return 'circle';
  if (tag === 'polygon') return 'polygon';
  return null;
}

function cleanLabel(el: Element, fallback: string): string {
  for (const a of ['data-name', 'aria-label', 'id']) {
    const v = (el.getAttribute(a) || '').trim();
    if (v && LABEL_OK.test(v)) return v;
  }
  return fallback;
}

type Mat = [number, number, number, number, number, number];

function parseTransformList(v: string | null): Mat | { unsupported: true } | null {
  if (!v || !v.trim()) return null;
  let m: Mat = [1, 0, 0, 1, 0, 0];
  const re = /(translate|scale|matrix)\s*\(([^)]*)\)/g;
  let mm: RegExpExecArray | null;
  let seen = false;
  for (;;) {
    mm = re.exec(v);
    if (!mm) break;
    seen = true;
    const args = mm[2].split(/[\s,]+/).filter(Boolean);
    if (!args.every((a) => NUM_OK.test(a))) return { unsupported: true };
    const ns = args.map(Number);
    const [a, b, c, d, e, f] = m;
    if (mm[1] === 'translate') {
      const tx = ns[0] ?? 0;
      const ty = ns[1] ?? 0;
      m = [a, b, c, d, e + a * tx + c * ty, f + b * tx + d * ty];
    } else if (mm[1] === 'scale') {
      const sx = ns[0] ?? 1;
      const sy = ns[1] ?? sx;
      m = [a * sx, b * sx, c * sy, d * sy, e, f];
    } else {
      if (ns.length < 6) return { unsupported: true };
      const [a2, b2, c2, d2, e2, f2] = ns;
      m = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
    }
  }
  if (!seen) return { unsupported: true };
  return m;
}

function applyMat(m: Mat, x: number, y: number): Pt {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Apakah matriks hanya translate + skala seragam (bisa diwakili vTransform). */
function toTranslateScale(m: Mat): { tx: number; ty: number; scale: number } | null {
  const [a, b, c, d, e, f] = m;
  if (b === 0 && c === 0 && a === d && a !== 0) return { tx: e, ty: f, scale: a };
  if (b === 0 && c === 0 && a === 0 && d === 0) return null;
  return null;
}

export function parseSvgLayout(text: string, fitW: number, fitH: number): SvgImportResult {
  const skipped: string[] = [];
  const empty = (reason: string): SvgImportResult => ({ objects: [], viewBox: [fitW, fitH], found: 0, skipped: [reason] });
  if (text.length > 5_000_000) return empty('file >5MB ditolak');
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    return empty('gagal parse XML');
  }
  if (doc.querySelector('parsererror')) return empty('XML tidak valid');
  const svg = doc.querySelector('svg');
  if (!svg) return empty('elemen <svg> tak ditemukan');

  let vbW = num(svg.getAttribute('width'), 0);
  let vbH = num(svg.getAttribute('height'), 0);
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).filter(Boolean);
  if (vb.length === 4 && vb.every((v) => NUM_OK.test(v))) {
    vbW = Number(vb[2]);
    vbH = Number(vb[3]);
  }
  if (!(vbW > 0 && vbH > 0)) return empty('viewBox/width tak valid');

  const s = Math.min(fitW / vbW, fitH / vbH);
  const ox = (fitW - vbW * s) / 2;
  const oy = (fitH - vbH * s) / 2;

  const shapes = Array.from(svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')).filter(
    (el) => {
      let p: Element | null = el.parentElement;
      while (p && p !== svg) {
        if (DROP.has(p.tagName.toLowerCase())) return false;
        p = p.parentElement;
      }
      return true;
    },
  );

  const objects: VenueObject[] = [];
  let n = 0;
  for (const el of shapes) {
    n++;
    const tag = el.tagName.toLowerCase();
    // komposisi transform ancestor + self (hanya translate/skala/matrix)
    let acc: Mat = [1, 0, 0, 1, 0, 0];
    let unsupported = false;
    const chain: Element[] = [];
    let p: Element | null = el;
    while (p && p !== svg) {
      chain.unshift(p);
      p = p.parentElement;
    }
    for (const node of chain) {
      const t = parseTransformList(node.getAttribute('transform'));
      if (t && 'unsupported' in t) {
        unsupported = true;
        break;
      }
      if (t) {
        const [a, b, c, d, e, f] = acc;
        const [a2, b2, c2, d2, e2, f2] = t;
        acc = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
      }
    }
    if (unsupported) {
      skipped.push(`${tag} #${n}: transform tak didukung (rotate/skew) — dilewati`);
      continue;
    }
    const d = shapeToD(el);
    if (!d) {
      skipped.push(`${tag} #${n}: geometri tak valid/ditolak — dilewati`);
      continue;
    }
    const fr = (inherited(chain, 'fill-rule') || '').trim();
    const fill = cleanFill(inherited(chain, 'fill'));
    const op = cleanOpacity(inherited(chain, 'opacity'));
    const fop = cleanOpacity(inherited(chain, 'fill-opacity'));
    const sop = cleanOpacity(inherited(chain, 'stroke-opacity'));
    const effFillOp = (op ?? 1) * (fop ?? 1);
    const rawStroke = inherited(chain, 'stroke');
    const strokeColor = rawStroke === null || rawStroke.trim() === '' || rawStroke.trim().toLowerCase() === 'none'
      ? null
      : FILL_OK.test(rawStroke.trim()) ? rawStroke.trim() : null;
    const sw = cleanWidth(inherited(chain, 'stroke-width')) ?? 1;
    const lc = inherited(chain, 'stroke-linecap');
    const lj = inherited(chain, 'stroke-linejoin');
    const dash = cleanDash(inherited(chain, 'stroke-dasharray'));
    const sdoRaw = inherited(chain, 'stroke-dashoffset');
    const sdo = sdoRaw !== null && NUM_OK.test(sdoRaw.trim()) ? sdoRaw.trim() : undefined;
    const effStrokeOp = (op ?? 1) * (sop ?? 1);
    const ts = toTranslateScale(acc);
    if (!ts) {
      skipped.push(`${tag} #${n}: butuh bake matriks umum — dilewati (fitur berikut)`);
      continue;
    }
    // gabung: canvas = fit * base. base(u) = ts.scale*u + ts.t
    const scale = s * ts.scale;
    const tx = ox + s * ts.tx;
    const ty = oy + s * ts.ty;
    // bbox pendekatan untuk seleksi: pakai rect bila ada, else null
    let seedPts: Pt[] = [];
    if (tag === 'rect') {
      const x = num(el.getAttribute('x'));
      const y = num(el.getAttribute('y'));
      const w = num(el.getAttribute('width'));
      const h = num(el.getAttribute('height'));
      const c1 = applyMat(acc, x, y);
      const c2 = applyMat(acc, x + w, y + h);
      seedPts = [
        [ox + s * c1[0], oy + s * c1[1]],
        [ox + s * c2[0], oy + s * c1[1]],
        [ox + s * c2[0], oy + s * c2[1]],
        [ox + s * c1[0], oy + s * c2[1]],
      ];
    }
    objects.push({
      id: uid('vec'),
      kind: 'vector',
      label: cleanLabel(el, `Bentuk ${objects.length + 1}`),
      shape: shapeForTag(tag),
      points: seedPts,
      closed: true,
      width: 28,
      price: 0,
      rowParams: null,
      seats: [],
      source: { origin: 'svg-import', confidence: 0.9 },
      guess: null,
      d,
      vTransform: { tx: Math.round(tx * 100) / 100, ty: Math.round(ty * 100) / 100, scale: Math.round(scale * 100000) / 100000 },
      svgFill: fill,
      svgFillRule: fr === 'evenodd' ? 'evenodd' : 'nonzero',
      svgFillOpacity: effFillOp < 1 ? Math.round(effFillOp * 1000) / 1000 : null,
      svgStroke: strokeColor
        ? {
            color: strokeColor,
            width: sw,
            ...(lc && LINECAP_OK.test(lc.trim()) ? { linecap: lc.trim() } : {}),
            ...(lj && LINEJOIN_OK.test(lj.trim()) ? { linejoin: lj.trim() } : {}),
            ...(dash ? { dash } : {}),
            ...(sdo ? { dashOffset: Number(sdo) } : {}),
            ...(effStrokeOp < 1 ? { opacity: Math.round(effStrokeOp * 1000) / 1000 } : {}),
          }
        : null,
    });
  }
  return { objects, viewBox: [vbW, vbH], found: n, skipped };
}

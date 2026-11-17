/**
 * Infinite grid ala Miro / Figma: dua level garis yang bertukar peran saat zoom.
 *
 * - Level grid dunia berkelipatan FACTOR (default 5): ... 8, 40, 200, 1000 ...
 * - Dalam satu waktu hanya 2 level digambar: major (tegas) + minor (berbayang).
 * - Saat zoom-in, minor yang samar (alpha 0) menegas (alpha 1) lalu "naik pangkat"
 *   jadi major baru, dan muncul minor baru yang lebih rapat di dalamnya.
 * - Ukuran major di layar dijaga pada rentang TARGET/5..TARGET dari lebar viewport
 *   (default 1.6%..8% ~ 16..80px pada kontainer 1000px), jadi kerapatan
 *   layar selalu nyaman walau zoom 0.1x..50x.
 *
 * Rumus: Lc = log(vbW * TARGET / BASE) / log(FACTOR), p = floor(Lc),
 * major = BASE * FACTOR^p, minor = major / FACTOR, minorAlpha = 1 - (Lc - p).
 */

export interface GridLevels {
  /** langkah garis tegas (unit world) */
  major: number;
  /** langkah garis samar di dalamnya (unit world) */
  minor: number;
  /** 0..1: 0 = minor tak terlihat (baru promosi), 1 = minor setegas major */
  minorAlpha: number;
  /** pangkat level major, berguna untuk debug */
  power: number;
}

export interface GridOptions {
  /** salah satu level dunia, default 40 (grid lama project ini) */
  base?: number;
  /** kelipatan antar level, default 5 seperti Miro */
  factor?: number;
  /** fraksi lebar viewport untuk major terbesar, default 0.08 */
  targetFraction?: number;
  /** batas pangkat agar tak overflow pada zoom ekstrem */
  minPower?: number;
  maxPower?: number;
}

export function getGridLevels(vbW: number, opts: GridOptions = {}): GridLevels {
  const base = opts.base ?? 40;
  const factor = opts.factor ?? 5;
  const target = opts.targetFraction ?? 0.08;
  const minPower = opts.minPower ?? -8;
  const maxPower = opts.maxPower ?? 8;

  const safeW = Number.isFinite(vbW) && vbW > 0 ? vbW : 1200;
  const safeBase = base > 0 ? base : 40;
  const safeFactor = factor > 1 ? factor : 5;

  const lc = Math.log((safeW * target) / safeBase) / Math.log(safeFactor);
  let p = Math.floor(lc);
  if (!Number.isFinite(p)) p = 0;
  p = Math.max(minPower, Math.min(maxPower, p));

  const major = safeBase * Math.pow(safeFactor, p);
  const minor = major / safeFactor;
  const frac = Math.max(0, Math.min(1, lc - Math.floor(lc)));
  const minorAlpha = Number.isFinite(frac) ? 1 - frac : 0;

  return { major, minor, minorAlpha, power: p };
}

/** Petakan minorAlpha 0..1 ke opacity stroke minor yang enak dilihat. */
export function minorOpacity(alpha: number, max = 0.85): number {
  const a = Math.max(0, Math.min(1, alpha));
  // easing ringan: muncul cepat di awal, menegas pelan di akhir
  return Math.pow(a, 0.8) * max;
}

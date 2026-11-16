import type { Pt } from './venue';
import { douglasPeucker } from './venue';

export interface DraftShape {
  bbox: [number, number, number, number];
  polygon: Pt[];
  areaPct: number;
  pixelArea: number;
}

export interface RasterResult {
  shapes: DraftShape[];
  width: number;
  height: number;
  elapsedMs: number;
  componentsRaw: number;
  kept: number;
}

function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thresh = t;
    }
  }
  return thresh;
}

const DIRS: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function dirOf(dx: number, dy: number): number {
  for (let i = 0; i < 8; i++) {
    if (DIRS[i][0] === dx && DIRS[i][1] === dy) return i;
  }
  return 0;
}

/**
 * Moore-neighbor boundary tracing (8-connectivity), ordered contour.
 * (sx,sy) must be a foreground pixel, ideally topmost-leftmost of the component.
 */
export function traceContour(mask: Uint8Array, w: number, h: number, sx: number, sy: number): Pt[] {
  const at = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return mask[y * w + x] === 1;
  };
  const contour: Pt[] = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let bx = sx - 1;
  let by = sy;
  const initBx = bx;
  const initBy = by;
  const guard = w * h * 4;
  let steps = 0;
  for (;;) {
    const b = dirOf(bx - cx, by - cy);
    let found = -1;
    let prevD = b;
    for (let k = 0; k < 8; k++) {
      const d = (b + k) % 8;
      const nx = cx + DIRS[d][0];
      const ny = cy + DIRS[d][1];
      if (at(nx, ny)) {
        found = d;
        break;
      }
      prevD = d;
    }
    if (found === -1) return contour.length > 0 ? contour : [[sx, sy]];
    const nx = cx + DIRS[found][0];
    const ny = cy + DIRS[found][1];
    bx = cx + DIRS[prevD][0];
    by = cy + DIRS[prevD][1];
    cx = nx;
    cy = ny;
    steps++;
    if (cx === sx && cy === sy && bx === initBx && by === initBy) break;
    contour.push([cx, cy]);
    if (steps > guard) break;
    if (contour.length > w * h) break;
  }
  return contour;
}

/**
 * Otsu + connected components + boundary trace + simplify.
 * gray: grayscale bytes (0=dark). Dark pixels become foreground.
 */
export function grayscaleToDrafts(
  gray: Uint8Array,
  w: number,
  h: number,
  minAreaPct = 0.2,
): RasterResult {
  const t0 = performance.now();
  const thresh = otsu(gray);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] <= thresh ? 1 : 0;

  const labels = new Int32Array(w * h).fill(-1);
  let components = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== 1 || labels[i] !== -1) continue;
    const id = components++;
    stack.push(i);
    labels[i] = id;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      const x = cur % w;
      const y = Math.floor(cur / w);
      for (let d = 0; d < 8; d++) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] === 1 && labels[ni] === -1) {
          labels[ni] = id;
          stack.push(ni);
        }
      }
    }
  }

  const minArea = ((w * h * minAreaPct) / 100);
  const shapes: DraftShape[] = [];
  for (let id = 0; id < components; id++) {
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let area = 0;
    let topX = 0;
    let topY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (labels[y * w + x] !== id) continue;
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) {
          minY = y;
          topX = x;
          topY = y;
        }
        if (y > maxY) maxY = y;
      }
    }
    if (area < minArea || maxX < 0) continue;
    const raw = traceContour(mask, w, h, topX, topY);
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const eps = Math.hypot(bw, bh) * 0.02;
    const simplified = douglasPeucker(raw, eps);
    shapes.push({
      bbox: [minX, minY, maxX - minX, maxY - minY],
      polygon: simplified,
      areaPct: (area / (w * h)) * 100,
      pixelArea: area,
    });
  }
  shapes.sort((a, b) => b.pixelArea - a.pixelArea);
  return {
    shapes, width: w, height: h,
    elapsedMs: Math.round((performance.now() - t0) * 10) / 10,
    componentsRaw: components, kept: shapes.length,
  };
}

/** Heuristik tebakan jenis dari bbox — kasar, wajib dikoreksi manual. */
export function guessKind(
  bbox: [number, number, number, number],
  imgW: number,
  imgH: number,
): 'stage' | 'catwalk' | 'tribune-band' | 'side-block' | 'floor' | 'unknown' {
  const [x, y, w, h] = bbox;
  const aspect = w / Math.max(h, 1);
  if (y < imgH * 0.25 && aspect > 1.5 && aspect < 4.0) return 'stage';
  if (w > imgW * 0.25 && h > imgH * 0.2) return 'tribune-band';
  if (w < imgW * 0.18 && h > imgH * 0.15) return 'side-block';
  if (h > w * 1.2) return 'catwalk';
  void x;
  return 'unknown';
}

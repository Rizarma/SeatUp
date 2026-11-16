/**
 * Kamera "fit + perluas": viewBox selalu ber-aspek sama dengan kontainer
 * (tak ada letterbox), melingkupi seluruh doc 1200x800 dan diperluas
 * mengikuti ruang kosong. Koordinat world = koordinat doc (objek lama utuh).
 */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fitViewBox(
  contW: number,
  contH: number,
  docW: number,
  docH: number,
  cx = docW / 2,
  cy = docH / 2,
): ViewBox {
  const cw = Math.max(1, contW);
  const ch = Math.max(1, contH);
  const k = Math.min(cw / docW, ch / docH);
  const w = cw / k;
  const h = ch / k;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Petakan piksel klien ke world memakai viewBox aktif (linear, tanpa letterbox). */
export function toWorld(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  vb: ViewBox,
): [number, number] {
  const x = vb.x + ((clientX - rect.left) / Math.max(1, rect.width)) * vb.w;
  const y = vb.y + ((clientY - rect.top) / Math.max(1, rect.height)) * vb.h;
  return [Number(x.toFixed(6)), Number(y.toFixed(6))];
}

export function viewBoxStr(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}

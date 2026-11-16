import { isClosedPath } from './contain';

export type PanelContext =
  | 'tool-row'
  | 'tool-polygon'
  | 'tool-stage'
  | 'tool-shape'
  | 'tool-aisle'
  | 'props'
  | 'overview';

export interface MarkCheck {
  ok: boolean;
  reason: string;
}

interface SelLike {
  kind: string;
  closed?: boolean;
  points?: { length: number } | unknown[];
  d?: string | null;
}

/** Konteks panel: tool kreasi menang atas seleksi agar opsi tool selalu terlihat. */
export function resolveContext(tool: string, hasSelection: boolean): PanelContext {
  if (tool === 'row') return 'tool-row';
  if (tool === 'polygon') return 'tool-polygon';
  if (tool === 'rectangle' || tool === 'circle') return 'tool-shape';
  if (tool === 'stage') return 'tool-stage';
  if (tool === 'aisle') return 'tool-aisle';
  return hasSelection ? 'props' : 'overview';
}

/** Apakah objek layak ditandai section (eksplisit oleh pengguna). */
export function markEligibility(o: SelLike | null | undefined): MarkCheck {
  if (!o) return { ok: false, reason: 'pilih objek dulu' };
  if (o.kind === 'aisle' || o.kind === 'row-straight' || o.kind === 'row-arc') {
    return { ok: false, reason: 'lorong/baris tidak bisa jadi section' };
  }
  if (o.kind === 'vector') {
    if (!o.d) return { ok: false, reason: 'bentuk kosong (path hilang)' };
    if (!isClosedPath(o.d)) {
      return { ok: false, reason: 'path terbuka — open path/teks outline tidak otomatis jadi section' };
    }
    return { ok: true, reason: '' };
  }
  const n = Array.isArray(o.points) ? o.points.length : 0;
  if (!o.closed || n < 3) return { ok: false, reason: 'polygon belum tertutup (Enter/klik-ganda)' };
  return { ok: true, reason: '' };
}

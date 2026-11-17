import type { VenueObject } from './venue';

export type ShapeName = 'Polygon' | 'Kotak' | 'Lingkaran' | 'Bentuk';

/**
 * Nama jenis bentuk untuk UI. Terpisah dari `kind` internal (tetap
 * 'section'/'vector' agar dokumen lama kompatibel) dan dari status
 * section (`isSection`, ditampilkan via badge terpisah).
 */
export function shapeName(o: Pick<VenueObject, 'kind' | 'label'> & { shape?: string | null }): ShapeName {
  if (o.kind === 'section') return 'Polygon';
  if (o.kind === 'vector') {
    if (o.shape === 'rect') return 'Kotak';
    if (o.shape === 'circle') return 'Lingkaran';
    if (o.shape === 'polygon') return 'Polygon';
    const l = o.label.trim().toLowerCase();
    if (l === 'kotak' || l.startsWith('kotak ')) return 'Kotak';
    if (l === 'lingkaran' || l.startsWith('lingkaran ')) return 'Lingkaran';
    if (l === 'polygon' || l.startsWith('polygon ')) return 'Polygon';
    return 'Bentuk';
  }
  return 'Bentuk';
}

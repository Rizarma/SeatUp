/** Warna identitas section (tipe tiket). Satu sumber untuk editor, preview, legenda. */

export const SECTION_PALETTE = ['#A78BFA', '#38BDF8', '#FBBF24', '#FB7185', '#34D399'];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidSectionColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

/** Warna efektif section: warna tersimpan bila valid, else fallback deterministik dari palet. */
export function sectionColorFor(obj: { color?: string | null } | null | undefined, index: number): string {
  if (obj && isValidSectionColor(obj.color)) return obj.color as string;
  const n = SECTION_PALETTE.length;
  const i = ((index % n) + n) % n;
  return SECTION_PALETTE[i];
}

/** Urutan section untuk fallback deterministik (dokumen lama tanpa warna). */
export function sectionOrderIndex<T extends { id: string; isSection?: boolean }>(objects: T[], id: string): number {
  const ids = objects.filter((o) => o.isSection).map((o) => o.id);
  const i = ids.indexOf(id);
  return i >= 0 ? i : 0;
}

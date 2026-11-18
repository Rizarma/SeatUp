import type { TicketCategory, VenueDoc, VenueObject } from './venue';
import { uid } from './venue';
import { SECTION_PALETTE, isValidSectionColor, sectionColorById } from './sectionColor';

export const CATEGORY_FALLBACK_COLOR = '#94a3b3';

export function isValidCategoryName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 60;
}

export function isValidCategoryPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000_000;
}

export function isValidCategoryColor(v: unknown): v is string {
  return isValidSectionColor(v);
}

export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Kategori dari id; null bila tak ditemukan. */
export function categoryById(doc: Pick<VenueDoc, 'categories'>, id: string | null | undefined): TicketCategory | null {
  if (!id) return null;
  return doc.categories.find((c) => c.id === id) ?? null;
}

/** Warna efektif sebuah section: warna kategorinya bila valid, else warna section lama, else fallback palet. */
export function categoryColorForSection(objects: VenueObject[], categories: TicketCategory[], sectionId: string): string {
  const section = objects.find((o) => o.id === sectionId) ?? null;
  const cat = section?.categoryId ? categories.find((c) => c.id === section.categoryId) : null;
  if (cat && isValidCategoryColor(cat.color)) return cat.color;
  // Kompatibel dokumen lama: warna tersimpan di section.
  if (section && isValidSectionColor(section.color)) return section.color as string;
  return sectionColorById(objects, sectionId);
}

/** Harga efektif sebuah section: harga kategorinya bila ada, else harga baris/kursi pertama, else 0. */
export function categoryPriceForSection(objects: VenueObject[], categories: TicketCategory[], sectionId: string): number {
  const section = objects.find((o) => o.id === sectionId) ?? null;
  const cat = section?.categoryId ? categories.find((c) => c.id === section.categoryId) : null;
  if (cat && isValidCategoryPrice(cat.price)) return cat.price;
  const row = objects.find((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') && (o.sectionId === sectionId));
  if (row && typeof row.price === 'number' && Number.isFinite(row.price)) return row.price;
  const seat = objects.flatMap((o) => o.seats).find((s) => s.sectionId === sectionId);
  if (seat && typeof seat.price === 'number' && Number.isFinite(seat.price)) return seat.price;
  return 0;
}

/** Sinkron harga + warna turunan dari kategori ke section/row/seat. Dipakai tiap commit/load agar 1 sumber kebenaran. */
export function syncCategoryPrices(doc: VenueDoc): VenueDoc {
  if (!Array.isArray(doc.categories) || doc.categories.length === 0) return doc;
  const byId = new Map(doc.categories.map((c) => [c.id, c]));
  // Kategori pemilik per section (O(objects), bukan O(seats × objects)).
  const ownerCat = new Map<string, { price: number; color: string }>();
  for (const o of doc.objects) {
    if (o.isSection && o.categoryId) {
      const cat = byId.get(o.categoryId);
      if (cat) ownerCat.set(o.id, cat);
    }
  }
  if (ownerCat.size === 0) {
    // Tetap selaraskan warna section lama bila kategorinya tak dikenal? tidak.
    return doc;
  }
  let changed = false;
  const objects = doc.objects.map((o) => {
    // Section: selaraskan warna simpanan lama dengan warna kategori (agar canvas lama tetap benar).
    if (o.isSection && o.categoryId && byId.has(o.categoryId)) {
      const cat = byId.get(o.categoryId)!;
      if ((o.color ?? null) !== cat.color) {
        changed = true;
        return { ...o, color: cat.color };
      }
      return o;
    }
    // Baris: harga ngikut kategori section pemiliknya.
    if ((o.kind === 'row-straight' || o.kind === 'row-arc') && o.sectionId) {
      const cat = ownerCat.get(o.sectionId);
      if (cat) {
        const needRow = o.price !== cat.price;
        let seatsChanged = false;
        const seats = o.seats.map((s) => {
          if (s.price !== cat.price) {
            seatsChanged = true;
            return { ...s, price: cat.price };
          }
          return s;
        });
        if (needRow || seatsChanged) {
          changed = true;
          return { ...o, price: cat.price, seats: seatsChanged ? seats : o.seats };
        }
      }
    }
    return o;
  });
  // Seat yatim yang sectionId-nya menunjuk section berkategori (walau row-nya yatim): selaraskan juga.
  const finalObjects = objects.map((o) => {
    if (o.seats.length === 0) return o;
    // Baris berkategori sudah disinkron di pass atas; lewati agar tak pindai ulang.
    if ((o.kind === 'row-straight' || o.kind === 'row-arc') && o.sectionId && ownerCat.has(o.sectionId)) return o;
    let localChanged = false;
    const seats = o.seats.map((s) => {
      if (!s.sectionId) return s;
      const cat = ownerCat.get(s.sectionId);
      if (cat && s.price !== cat.price) {
        localChanged = true;
        return { ...s, price: cat.price };
      }
      return s;
    });
    if (localChanged) {
      changed = true;
      return { ...o, seats };
    }
    return o;
  });
  return changed ? { ...doc, objects: finalObjects } : doc;
}

/** Pastikan doc punya categories + tiap section punya categoryId. Untuk migrasi dokumen lama. */
export function ensureCategories(input: VenueDoc): VenueDoc {
  const doc = { ...input };
  let categories = Array.isArray(doc.categories) ? [...doc.categories] : [];
  // Bersihkan entri rusak bila ada.
  categories = categories.filter(
    (c) => c && typeof c.id === 'string' && isValidCategoryName(c.name) && isValidCategoryPrice(c.price) && isValidCategoryColor(c.color),
  );
  // Deduplikasi id: yang pertama menang.
  const seen = new Set<string>();
  categories = categories.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  const sections = doc.objects.filter((o) => o.isSection);
  if (categories.length === 0) {
    if (sections.length > 0) {
      // Buatkan 1 kategori per section dari warna + harga lama.
      categories = sections.map((s, i) => {
        const row = doc.objects.find(
          (o) => (o.kind === 'row-straight' || o.kind === 'row-arc') && o.sectionId === s.id,
        );
        const seat = doc.objects.flatMap((o) => o.seats).find((x) => x.sectionId === s.id);
        const price = typeof row?.price === 'number' && Number.isFinite(row.price)
          ? row.price
          : typeof seat?.price === 'number' && Number.isFinite(seat.price)
            ? seat.price
            : 0;
        const color = isValidSectionColor(s.color) ? (s.color as string) : sectionColorById(doc.objects, s.id) ?? SECTION_PALETTE[i % SECTION_PALETTE.length];
        return { id: uid('cat'), name: s.label || `Kategori ${i + 1}`, price, color };
      });
    } else {
      // Venue kosong / hanya baris yatim: kelompokkan harga baris yatim per nilai distinct.
      const orphanPrices = [...new Set(
        doc.objects
          .filter((o) => o.kind === 'row-straight' || o.kind === 'row-arc')
          .map((o) => o.price)
          .filter((p) => typeof p === 'number' && Number.isFinite(p)),
      )].slice(0, 8);
      if (orphanPrices.length > 0) {
        categories = orphanPrices.map((p, i) => ({
          id: uid('cat'),
          name: `Kategori ${i + 1}`,
          price: p,
          color: SECTION_PALETTE[i % SECTION_PALETTE.length],
        }));
      } else {
        categories = [
          { id: uid('cat'), name: 'VIP', price: 150000, color: SECTION_PALETTE[0] },
          { id: uid('cat'), name: 'Reguler', price: 100000, color: SECTION_PALETTE[1] },
        ];
      }
    }
  }

  // Tiap section wajib punya categoryId valid; yang kosong dipetakan ke kategori pertama
  // (atau ke kategori yang warnanya cocok dengan warna lama section).
  const byId = new Map(categories.map((c) => [c.id, c]));
  let objectsChanged = false;
  const objects = doc.objects.map((o) => {
    if (!o.isSection) return o;
    if (o.categoryId && byId.has(o.categoryId)) return o;
    const matchByColor = o.color
      ? categories.find((c) => c.color.toLowerCase() === (o.color as string).toLowerCase())
      : undefined;
    const fallback = matchByColor ?? categories[0] ?? null;
    if (!fallback) return o;
    objectsChanged = true;
    return { ...o, categoryId: fallback.id };
  });

  const withCats: VenueDoc = { ...doc, categories, objects: objectsChanged ? objects : doc.objects };
  return syncCategoryPrices(withCats);
}

/** Buat kategori baru (validasi di pemanggil). */
export function createCategory(name: string, price: number, color: string): TicketCategory {
  return { id: uid('cat'), name: normalizeCategoryName(name), price, color };
}

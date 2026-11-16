import type { VenueDoc, VenueObject } from './venue';

/** Update satu objek dalam doc (immutable). patch bisa parsial atau fungsi. */
export function withObject(
  doc: VenueDoc,
  id: string,
  patch: Partial<VenueObject> | ((o: VenueObject) => VenueObject),
): VenueDoc {
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      if (o.id !== id) return o;
      return typeof patch === 'function' ? patch(o) : { ...o, ...patch };
    }),
  };
}

/** Hapus satu objek dari doc. */
export function withoutObject(doc: VenueDoc, id: string): VenueDoc {
  return { ...doc, objects: doc.objects.filter((o) => o.id !== id) };
}

/** Tambah objek ke doc. */
export function withAddedObject(doc: VenueDoc, obj: VenueObject): VenueDoc {
  return { ...doc, objects: [...doc.objects, obj] };
}

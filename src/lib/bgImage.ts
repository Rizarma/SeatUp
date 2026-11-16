/**
 * Latar venue disimpan sebagai Blob di IndexedDB — di luar kuota ~5MB
 * localStorage dan di luar dokumen JSON. `VenueDoc.backgroundImage` hanya
 * memegang URL sesi (object URL / dataURL lama) untuk render.
 */

const DB_NAME = 'seatup-bg-v1';
const STORE = 'images';
const KEY = 'active-background';

/** Penanda sync bahwa ada blob latar (agar load tanpa latar tak menyentuh IDB). */
export const BG_FLAG_KEY = 'seatup-bg-present-v1';

function factory(): IDBFactory | null {
  const g = globalThis as unknown as { indexedDB?: IDBFactory };
  return typeof g.indexedDB !== 'undefined' ? g.indexedDB : null;
}

function openDb(): Promise<IDBDatabase> {
  const f = factory();
  if (!f) return Promise.reject(new Error('indexeddb tak tersedia'));
  return new Promise((resolve, reject) => {
    const req = f.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('gagal buka indexeddb'));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => {
          const v = req.result;
          db.close();
          resolve(v);
        };
        req.onerror = () => {
          db.close();
          reject(req.error ?? new Error('gagal akses indexeddb'));
        };
      }),
  );
}

/** Simpan blob latar + tandai flag. Gagal bila IDB tak tersedia/penuh. */
export function saveBackground(blob: Blob): Promise<void> {
  return run('readwrite', (s) => s.put(blob, KEY)).then(() => {
    try {
      localStorage.setItem(BG_FLAG_KEY, '1');
    } catch {
      // flag hanya optimasi; blob sudah tersimpan
    }
  });
}

/** Muat blob latar, atau null bila tak ada. */
export function loadBackground(): Promise<Blob | null> {
  return run('readonly', (s) => s.get(KEY)).then((v: unknown) =>
    v instanceof Blob ? v : null,
  );
}

/** Hapus blob latar + flag. */
export function clearBackground(): Promise<void> {
  return run('readwrite', (s) => s.delete(KEY)).then(() => {
    try {
      localStorage.removeItem(BG_FLAG_KEY);
    } catch {
      // abaikan
    }
  });
}

/** Ada blob latar tersimpan? (sync, tanpa menyentuh IDB) */
export function hasBackgroundFlag(): boolean {
  try {
    return localStorage.getItem(BG_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Konversi dataURL (dokumen lama) menjadi Blob untuk migrasi ke IDB. */
export function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((r) => {
    if (!r.ok) throw new Error('gagal konversi latar lama');
    return r.blob();
  });
}

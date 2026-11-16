import type { VenueDoc } from './venue';

export const STORAGE_KEY = 'seat-poc-venue-v1';

export interface SaveResult {
  /** True bila latar ikut tersimpan; false bila latar dilepas karena kuota. */
  withBackground: boolean;
}

function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException) return e.name === 'QuotaExceededError';
  const err = e as { name?: string; code?: number };
  return err?.name === 'QuotaExceededError' || err?.code === 22;
}

/**
 * Simpan lokal anti-jebol kuota: dataURL latar bisa MB-an sementara
 * localStorage ~5MB. Coba penuh dulu, fallback tanpa latar, terakhir lempar
 * error agar UI bisa memberi pesan yang jujur (bukan klaim "tersimpan").
 */
export function saveLocal(doc: VenueDoc): SaveResult {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return { withBackground: true };
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  const slim: VenueDoc = { ...doc, backgroundImage: null };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    return { withBackground: false };
  } catch (e2) {
    if (isQuotaError(e2)) throw new Error('penyimpanan lokal penuh — hapus data lama atau ekspor JSON');
    throw e2;
  }
}

export function loadLocal(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function downloadJson(doc: VenueDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'venue.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('gagal baca file'));
    r.readAsText(file);
  });
}

export function readImageFile(file: File): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('gagal baca gambar'));
    img.src = url;
  });
}

import type { VenueDoc } from './venue';

export const STORAGE_KEY = 'seat-poc-venue-v1';

export function saveLocal(doc: VenueDoc): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
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

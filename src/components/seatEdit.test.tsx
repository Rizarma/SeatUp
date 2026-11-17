// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueObject } from '../lib/venue';

const base = emptyVenue();
const catVIP = base.categories[0];
const section: VenueObject = { id: 'section-a', kind: 'section', label: 'Section A', points: [[0, 0], [500, 0], [500, 400], [0, 400]], closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [], source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: catVIP.id, color: catVIP.color };
const seats = [
  { id: 's1', row: 'A', number: '1', x: 100, y: 100, status: 'available' as const, price: catVIP.price, sectionId: 'section-a', radius: 8 },
  { id: 's2', row: 'A', number: '2', x: 140, y: 100, status: 'available' as const, price: catVIP.price, sectionId: 'section-a', radius: 8 },
  { id: 's3', row: 'A', number: '3', x: 180, y: 100, status: 'available' as const, price: catVIP.price, sectionId: 'section-a', radius: 8 },
  { id: 's4', row: 'B', number: '1', x: 100, y: 150, status: 'available' as const, price: catVIP.price, sectionId: 'section-a', radius: 8 },
  { id: 's5', row: 'B', number: '2', x: 140, y: 150, status: 'available' as const, price: catVIP.price, sectionId: 'section-a', radius: 8 },
  { id: 's6', row: 'B', number: '3', x: 180, y: 150, status: 'available' as const, price: catVIP.price, sectionId: 'section-a', radius: 8 },
];
const row: VenueObject = { id: 'row-1', kind: 'row-straight', label: 'Baris 1', points: [[100, 100]], closed: false, width: 28, price: catVIP.price, rowParams: null, seats: [...seats], source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'section-a' };

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify({ ...base, objects: [section, row] }));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  const svg = () => host.querySelector('svg.canvas')!;
  await act(async () => { svg().querySelector('polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(svg().getAttribute('aria-label')).toBe('Editor isi section');
  const save = async () => { await click('[aria-label="Simpan lokal"]'); return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!); };
  const titled = () => [...svg().querySelectorAll('title')].map((t) => t.parentElement!);
  return { host, svg, click, save, titled };
}

function ptr(type: string, init: PointerEventInit & { clientX?: number; clientY?: number }) {
  return new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...init });
}

it('memilih 1 kursi, edit baris 1 undo, ID/koordinat/section/harga kategori tetap', async () => {
  const { host, svg, click, save, titled } = await mount();
  expect(titled()).toHaveLength(6);
  await act(async () => { titled()[0].dispatchEvent(ptr('pointerdown', { clientX: 10, clientY: 10 })); });
  expect(host.textContent).toContain('1 kursi terpilih');
  // Harga ngikut kategori: tidak ada input harga, hanya info kategori.
  expect(host.querySelector('[aria-label="Harga kursi terpilih"]')).toBeNull();
  expect(host.textContent).toContain(catVIP.name);
  const rowInput = host.querySelector('[aria-label="Baris kursi terpilih"]') as HTMLInputElement;
  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    nativeSet.call(rowInput, 'Z');
    rowInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(rowInput.value).toBe('Z');
  const apply = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Terapkan ke'))!;
  await act(async () => apply.click());
  let saved = await save();
  const r1 = saved.objects.find((o: VenueObject) => o.id === 'row-1');
  const s1 = r1.seats.find((s: { id: string }) => s.id === 's1');
  expect(s1.row).toBe('Z');
  expect(s1.price).toBe(catVIP.price);
  expect(s1.x).toBe(100); expect(s1.y).toBe(100);
  expect(s1.sectionId).toBe('section-a'); expect(s1.radius).toBe(8);
  // kursi lain tak tersentuh
  expect(r1.seats.find((s: { id: string }) => s.id === 's2').row).toBe('A');
  // 1 undo mengembalikan batch
  await click('[aria-label^="Urungkan"]');
  saved = await save();
  expect(saved.objects.find((o: VenueObject) => o.id === 'row-1').seats.find((s: { id: string }) => s.id === 's1').row).toBe('A');
  await click('[aria-label^="Ulangi"]');
  saved = await save();
  expect(saved.objects.find((o: VenueObject) => o.id === 'row-1').seats.find((s: { id: string }) => s.id === 's1').row).toBe('Z');
  void svg;
});

it('shift multi-select + Delete hanya hapus kursi, objek utuh, undo pulihkan', async () => {
  const { host, click, save, titled } = await mount();
  await act(async () => { titled()[0].dispatchEvent(ptr('pointerdown', { clientX: 10, clientY: 10 })); });
  await act(async () => { titled()[1].dispatchEvent(ptr('pointerdown', { clientX: 12, clientY: 10, shiftKey: true })); });
  expect(host.textContent).toContain('2 kursi terpilih');
  expect(host.textContent).toContain('(campuran)');
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); });
  let saved = await save();
  expect(saved.objects).toHaveLength(2);
  expect(saved.objects.find((o: VenueObject) => o.id === 'row-1').seats).toHaveLength(4);
  expect(host.querySelector('[aria-label="Kursi terpilih"]')).toBeNull();
  await click('[aria-label^="Urungkan"]');
  saved = await save();
  expect(saved.objects.find((o: VenueObject) => o.id === 'row-1').seats).toHaveLength(6);
});

it('marquee memilih blok baris A saja', async () => {  const { host, svg, save } = await mount();
  const vb = svg().getAttribute('viewBox')!.split(' ').map(Number);
  const [vx, , vw] = [vb[0], vb[1], vb[2], vb[3]];
  const vh = vb[3];
  const toClient = (wx: number, wy: number) => ({
    clientX: ((wx - vx) / vw) * 1000,
    clientY: ((wy - vb[1]) / vh) * 700,
  });
  const a = toClient(90, 90);
  const b = toClient(190, 120);
  await act(async () => { svg().dispatchEvent(ptr('pointerdown', { ...a })); });
  await act(async () => { svg().dispatchEvent(ptr('pointermove', { ...b })); });
  await act(async () => { svg().dispatchEvent(ptr('pointerup', { ...b })); });
  expect(host.textContent).toContain('3 kursi terpilih');
  const saved = await save();
  expect(saved.objects.find((o: VenueObject) => o.id === 'row-1').seats).toHaveLength(6);
});

it('mixed multi-select beda baris: hanya baris diedit, harga kategori tetap, 1 undo pulihkan', async () => {
  const { host, click, save, titled } = await mount();
  // s1 (A) + s4 (B), harga sama-sama ngikut kategori
  await act(async () => { titled()[0].dispatchEvent(ptr('pointerdown', { clientX: 10, clientY: 10 })); });
  await act(async () => { titled()[3].dispatchEvent(ptr('pointerdown', { clientX: 12, clientY: 12, shiftKey: true })); });
  expect(host.textContent).toContain('2 kursi terpilih');
  expect(host.textContent).toContain('(campuran)');
  expect(host.querySelector('[aria-label="Harga kursi terpilih"]')).toBeNull();
  // hanya isi baris
  const rowInput = host.querySelector('[aria-label="Baris kursi terpilih"]') as HTMLInputElement;
  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    nativeSet.call(rowInput, 'C');
    rowInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const apply = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Terapkan ke'))!;
  await act(async () => apply.click());
  let saved = await save();
  const seatsAfter = saved.objects.find((o: VenueObject) => o.id === 'row-1').seats as Array<{ id: string; row: string; number: string; price: number; x: number; y: number; sectionId: string; radius: number }>;
  const s1 = seatsAfter.find((s) => s.id === 's1')!;
  const s4 = seatsAfter.find((s) => s.id === 's4')!;
  expect(s1.row).toBe('C'); expect(s4.row).toBe('C');
  expect(s1.price).toBe(catVIP.price); expect(s4.price).toBe(catVIP.price);
  expect(s1.number).toBe('1'); expect(s4.number).toBe('1');
  expect(s1.x).toBe(100); expect(s1.y).toBe(100);
  expect(s4.x).toBe(100); expect(s4.y).toBe(150);
  expect(s1.sectionId).toBe('section-a'); expect(s1.radius).toBe(8);
  await click('[aria-label^="Urungkan"]');
  saved = await save();
  const seatsUndone = saved.objects.find((o: VenueObject) => o.id === 'row-1').seats as Array<{ id: string; row: string; price: number }>;
  expect(seatsUndone.find((s) => s.id === 's1')!.row).toBe('A');
  expect(seatsUndone.find((s) => s.id === 's4')!.row).toBe('B');
  expect(seatsUndone.find((s) => s.id === 's1')!.price).toBe(catVIP.price);
});

it('tool seat disembunyikan di luar fokus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify({ ...base, objects: [section, row] }));
  await act(async () => root.render(<App />));
  await act(async () => (host.querySelector('[aria-label="Muat simpanan lokal"]') as HTMLButtonElement).click());
  const labels = [...host.querySelectorAll('.dock [aria-label]')].map((b) => b.getAttribute('aria-label'));
  expect(labels.some((l) => l?.startsWith('Pilih kursi'))).toBe(false);
});

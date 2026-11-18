// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueObject } from '../lib/venue';

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

function stubEnv() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1 as unknown as number);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
}

function ptr(type: string, init: PointerEventInit & { clientX?: number; clientY?: number }) {
  return new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...init });
}

function docDiagonal(): ReturnType<typeof emptyVenue> {
  const base = emptyVenue();
  const cat = base.categories[0];
  const section: VenueObject = {
    id: 'sec', kind: 'section', label: 'Sec',
    points: [[0, 0], [600, 0], [600, 400], [0, 400]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: cat.id,
  };
  // Baris diagonal + celah lorong di tengah (jarak 100 >> spasi 26).
  const seats = [
    { id: 's-0', row: 'A', number: '1', x: 100, y: 100, status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8 },
    { id: 's-1', row: 'A', number: '2', x: 126, y: 126, status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8 },
    { id: 's-2', row: 'A', number: '3', x: 152, y: 152, status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8 },
    { id: 's-3', row: 'A', number: '4', x: 252, y: 252, status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8 },
    { id: 's-4', row: 'A', number: '5', x: 278, y: 278, status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8 },
  ];
  const row: VenueObject = {
    id: 'row-0', kind: 'row-straight', label: 'Baris 0',
    points: [[100, 100]], closed: false, width: 28, price: cat.price,
    rowParams: null, seats, source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec',
  };
  return { ...base, objects: [section, row] };
}

async function mountDoc(doc: ReturnType<typeof emptyVenue>) {
  stubEnv();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify(doc));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  const svg = () => host.querySelector('svg.canvas')!;
  const summaryPaths = () => [...svg().querySelectorAll('path')].filter((p) => p.getAttribute('stroke-linecap') === 'round');
  const toClient = (wx: number, wy: number) => {
    const vb = svg().getAttribute('viewBox')!.split(' ').map(Number);
    return { clientX: ((wx - vb[0]) / vb[2]) * 1000, clientY: ((wy - vb[1]) / vb[3]) * 700 };
  };
  return { host, svg, click, summaryPaths, toClient };
}

it('venue: garis diagonal terputus di lorong, dekoratif, di dalam clip section', async () => {
  const { svg, summaryPaths } = await mountDoc(docDiagonal());
  expect(svg().getAttribute('aria-label')).toBe('Editor venue');
  const paths = summaryPaths();
  expect(paths).toHaveLength(1);
  const d = paths[0].getAttribute('d')!;
  // Dua segmen (putus di celah 100px): dua subpath M.
  expect(d.split('M').length - 1).toBe(2);
  expect(d).toContain('100 100');
  expect(d).toContain('278 278');
  // Dekoratif: pointerEvents none + aria-hidden, klik tetap ke section.
  const g = paths[0].parentElement!;
  expect(g.getAttribute('aria-hidden')).toBe('true');
  expect(g.getAttribute('pointer-events') ?? paths[0].getAttribute('pointer-events')).toBe('none');
  // Clip ke geometri section aktual.
  expect(paths[0].parentElement?.getAttribute('clip-path')).toContain('summary-clip-sec');
  expect(svg().querySelector('clipPath#summary-clip-sec')).not.toBeNull();
  // Di atas fill (fill opacity 0.18 ada) dan highlight seleksi dirender belakangan:
  // outline section tetap ada sebagai path tanpa linecap round.
  expect(svg().querySelector('[aria-label="Sec"]')).not.toBeNull();
});

it('double-click menampilkan kursi di posisi ringkasan; kembali pulihkan kamera + garis', async () => {
  const { host, svg, summaryPaths } = await mountDoc(docDiagonal());
  const beforeD = summaryPaths()[0].getAttribute('d')!;
  const beforeVb = svg().getAttribute('viewBox')!;
  await act(async () => { svg().querySelector('[aria-label="Sec"] polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(svg().getAttribute('aria-label')).toBe('Editor isi section');
  // Mode edit: ringkasan hilang, kursi individual muncul di posisi yang sama.
  expect(summaryPaths()).toHaveLength(0);
  const dots = [...svg().querySelectorAll('[data-seat-id]')];
  expect(dots.length).toBe(5);
  const xs = dots.map((el) => Number(el.getAttribute('cx')));
  expect(xs).toContain(100);
  expect(xs).toContain(278);
  expect(beforeD).toContain('100 100');
  const back = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Kembali ke venue'))!;
  await act(async () => back.click());
  expect(svg().getAttribute('aria-label')).toBe('Editor venue');
  expect(svg().getAttribute('viewBox')).toBe(beforeVb);
  expect(summaryPaths()[0].getAttribute('d')).toBe(beforeD);
});

it('rotasi polygon + vector lubang: garis tetap di dalam area terlihat', async () => {
  const base = emptyVenue();
  const cat = base.categories[0];
  const rotated: VenueObject = {
    id: 'sec-rot', kind: 'section', label: 'Rot',
    points: [[0, 0], [300, 0], [300, 200], [0, 200]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: cat.id, rotation: 30,
  };
  const rowR: VenueObject = {
    id: 'row-r', kind: 'row-straight', label: 'R', points: [[150, 100]], closed: false,
    width: 28, price: cat.price, rowParams: null,
    seats: [0, 1, 2].map((i) => ({
      id: `rr-${i}`, row: 'A', number: String(i + 1), x: 120 + i * 26, y: 100,
      status: 'available' as const, price: cat.price, sectionId: 'sec-rot', radius: 8,
    })),
    source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec-rot',
  };
  const vec: VenueObject = {
    id: 'sec-vec', kind: 'vector', label: 'Vec', points: [], d: 'M600 0H900V300H600Z M700 100H800V200H700Z',
    closed: true, width: 28, price: 0, rowParams: null, seats: [],
    vTransform: { tx: 0, ty: 0, scale: 1 }, svgFillRule: 'evenodd',
    source: { origin: 'canvas', confidence: 1 }, guess: null, isSection: true, categoryId: cat.id,
  };
  const rowV: VenueObject = {
    id: 'row-v', kind: 'row-straight', label: 'Rv', points: [[620, 50]], closed: false,
    width: 28, price: cat.price, rowParams: null,
    seats: [0, 1].map((i) => ({
      id: `rv-${i}`, row: 'A', number: String(i + 1), x: 620 + i * 26, y: 50,
      status: 'available' as const, price: cat.price, sectionId: 'sec-vec', radius: 8,
    })),
    source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec-vec',
  };
  const { svg, summaryPaths } = await mountDoc({ ...base, objects: [rotated, rowR, vec, rowV] });
  expect(summaryPaths()).toHaveLength(2);
  // Clip polygon terotasi memakai path (bukan polygon kedua).
  expect(svg().querySelector('clipPath#summary-clip-sec-rot path')).not.toBeNull();
  // Lubang evenodd dipertahankan pada clip vector.
  const vecClip = svg().querySelector('clipPath#summary-clip-sec-vec path')!;
  expect(vecClip.getAttribute('clip-rule')).toBe('evenodd');
  // Regresi Chromium: <path> harus anak LANGSUNG <clipPath> (tanpa <g>
  // bersarang) agar clip benar-benar diterapkan browser. Struktur
  // <clipPath><g><g><path/></g></g></clipPath> lolos query descendant
  // tetapi garis tidak tergambar.
  const vecClipRoot = svg().querySelector('clipPath#summary-clip-sec-vec')!;
  expect(vecClipRoot.querySelector('g')).toBeNull();
  expect(vecClipRoot.firstElementChild?.tagName.toLowerCase()).toBe('path');
  expect(vecClip.getAttribute('transform')).toContain('translate(');
  expect(vecClip.getAttribute('transform')).toContain('scale(');
});

it('drag section menggeser garis; Esc membatalkan; hapus kursi terakhir + undo', async () => {
  const { svg, click, summaryPaths, toClient } = await mountDoc(docDiagonal());
  const d0 = summaryPaths()[0].getAttribute('d')!;
  // Drag section di venue (tool select bawaan).
  const fill = svg().querySelector('[aria-label="Sec"] polygon')!;
  const c = toClient(50, 50);
  await act(async () => { fill.dispatchEvent(ptr('pointerdown', c)); });
  await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: c.clientX + 40, clientY: c.clientY + 20 })); });
  const dDrag = summaryPaths()[0].getAttribute('d')!;
  expect(dDrag).not.toBe(d0);
  // Batal via Esc: garis kembali, commit nol.
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: c.clientX + 40, clientY: c.clientY + 20 })); });
  expect(summaryPaths()[0].getAttribute('d')).toBe(d0);
  // Masuk focus, hapus semua kursi via Delete, kembali: garis hilang; undo: muncul lagi.
  await act(async () => { svg().querySelector('[aria-label="Sec"] polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(svg().getAttribute('aria-label')).toBe('Editor isi section');
  // Pilih semua via marquee besar lalu Delete.
  const vb = svg().getAttribute('viewBox')!.split(' ').map(Number);
  const x0 = ((0 - vb[0]) / vb[2]) * 1000;
  const y0 = ((0 - vb[1]) / vb[3]) * 700;
  const x1 = ((600 - vb[0]) / vb[2]) * 1000;
  const y1 = ((400 - vb[1]) / vb[3]) * 700;
  await act(async () => { svg().dispatchEvent(ptr('pointerdown', { clientX: x0, clientY: y0 })); });
  await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: x1, clientY: y1 })); });
  await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: x1, clientY: y1 })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); });
  expect(svg().querySelectorAll('[data-seat-id]').length).toBe(0);
  const back = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Kembali ke venue'))!;
  await act(async () => (back as HTMLButtonElement).click());
  expect(summaryPaths()).toHaveLength(0);
  await click('[aria-label^="Urungkan"]');
  expect(summaryPaths()).toHaveLength(1);
  expect(summaryPaths()[0].getAttribute('d')).toBe(d0);
});

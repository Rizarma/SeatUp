// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueObject, VenueDoc } from '../lib/venue';
import { validateVenueDoc, parseVenueJson } from '../lib/validate';
import { SECTION_PALETTE, sectionColorFor } from '../lib/sectionColor';

const sectionA: VenueObject = {
  id: 'section-a', kind: 'section', label: 'Section A', points: [[0, 0], [500, 0], [500, 400], [0, 400]],
  closed: true, isSection: true, color: '#e11d48', width: 28, price: 0, rowParams: null, seats: [],
  source: { origin: 'canvas', confidence: 1 }, guess: null,
};
const sectionB: VenueObject = {
  id: 'section-b', kind: 'section', label: 'Section B', points: [[600, 0], [1100, 0], [1100, 400], [600, 400]],
  closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
  source: { origin: 'canvas', confidence: 1 }, guess: null,
};
const stage: VenueObject = {
  id: 'stage-1', kind: 'stage', label: 'Panggung', points: [[400, 450], [800, 450], [800, 520], [400, 520]],
  closed: true, width: 28, price: 0, rowParams: null, seats: [],
  source: { origin: 'canvas', confidence: 1 }, guess: null,
};

function bigSeats(n: number, sectionId: string, x0: number, y0: number, price: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `seat-${sectionId}-${i}`, row: 'A', number: String(i + 1),
    x: x0 + (i % 50) * 8, y: y0 + Math.floor(i / 50) * 10,
    status: 'available' as const, price, sectionId, radius: 3, invalid: false,
  }));
}

function fixtureDoc(): VenueDoc {
  const base = emptyVenue();
  const rowA: VenueObject = {
    id: 'row-a', kind: 'row-straight', label: 'Baris A', points: [[10, 10]], closed: false,
    width: 28, price: 150000, rowParams: null, seats: bigSeats(1000, 'section-a', 10, 10, 150000),
    source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'section-a',
  };
  const rowB: VenueObject = {
    id: 'row-b', kind: 'row-straight', label: 'Baris B', points: [[610, 10]], closed: false,
    width: 28, price: 100000, rowParams: null, seats: bigSeats(6, 'section-b', 610, 10, 100000),
    source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'section-b',
  };
  return { ...base, objects: [sectionA, sectionB, stage, rowA, rowB] };
}

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function mountEditor() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify(fixtureDoc()));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  const svg = () => host.querySelector('svg.canvas')!;
  const save = async () => { await click('[aria-label="Simpan lokal"]'); return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!); };
  const seatTitles = () => [...svg().querySelectorAll('title')]
    .map((t) => t.parentElement!)
    .filter((el) => el.tagName.toLowerCase() === 'circle');
  return { host, svg, click, save, seatTitles };
}

it('editor venue: nol node kursi dengan 1006 kursi; masuk hanya section aktif; kembali unmount', async () => {
  const { host, svg, seatTitles } = await mountEditor();
  // Venue: nol lingkaran kursi (title di dalam circle), section + panggung tetap ada.
  expect(seatTitles()).toHaveLength(0);
  expect(svg().querySelectorAll('polygon')).toHaveLength(3);
  expect(svg().getAttribute('aria-label')).toBe('Editor venue');
  // Masuk section A: hanya 1000 kursi A, tanpa B.
  await act(async () => { svg().querySelectorAll('polygon')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(svg().getAttribute('aria-label')).toBe('Editor isi section');
  expect(seatTitles()).toHaveLength(1000);
  expect(host.textContent).toContain('1000 kursi');
  // Warna section dipakai kursi: A = warna tersimpan, cek satu sampel.
  const fillsA = new Set(seatTitles().slice(0, 20).map((c) => c.getAttribute('fill')));
  expect(fillsA).toEqual(new Set(['#e11d48']));
  // Kembali: unmount semua kursi.
  const back = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Kembali ke venue'))!;
  await act(async () => back.click());
  expect(svg().getAttribute('aria-label')).toBe('Editor venue');
  expect(seatTitles()).toHaveLength(0);
});

it('preview venue: nol tombol kursi; masuk section aktif saja; pilihan buyer bertahan', async () => {
  const { host, click } = await mountEditor();
  await click('[aria-label="Mode preview pembeli"]');
  const map = () => host.querySelector('.orion-map svg.canvas')!;
  // Venue: nol seat button, tapi 2 section + panggung tampil.
  expect(map().querySelectorAll('circle[role="button"]')).toHaveLength(0);
  expect(map().querySelectorAll('polygon').length).toBeGreaterThanOrEqual(3);
  expect(map().getAttribute('aria-label')).toBe('Denah venue');
  // Masuk section A via klik.
  const gA = map().querySelector('g[aria-label="Masuk section Section A"]') as SVGGElement;
  expect(gA).not.toBeNull();
  await act(async () => { gA.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(map().getAttribute('aria-label')).toBe('Denah section Section A');
  const seatsA = map().querySelectorAll('circle[role="button"]');
  expect(seatsA).toHaveLength(1000);
  // Warna section A dipakai kursi preview.
  expect((seatsA[0] as SVGCircleElement).getAttribute('fill')).toBe('#e11d48');
  // Pilih 1 kursi, lalu kembali ke venue: tombol kursi unmount tapi summary bertahan.
  await act(async () => { seatsA[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(host.textContent).toContain('Subtotal (1 tiket)');
  expect(host.textContent).toContain('Rp150.000');
  await act(async () => (host.querySelector('[data-testid="back-to-venue"]') as HTMLButtonElement).click());
  expect(map().getAttribute('aria-label')).toBe('Denah venue');
  expect(map().querySelectorAll('circle[role="button"]')).toHaveLength(0);
  expect(host.textContent).toContain('Subtotal (1 tiket)');
  // Masuk section B: hanya 6 kursi B; pilihan A tetap di summary.
  const gB = map().querySelector('g[aria-label="Masuk section Section B"]') as SVGGElement;
  await act(async () => { gB.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(map().querySelectorAll('circle[role="button"]')).toHaveLength(6);
  expect(host.textContent).toContain('Subtotal (1 tiket)');
  expect(host.textContent).toContain('Section A');
});

it('warna section konsisten editor+preview+legenda; save/load/undo; fallback dokumen lama', async () => {
  const { host, svg, click, save } = await mountEditor();
  // Fallback deterministik: section B tanpa warna -> palet indeks 1.
  expect(sectionColorFor(null, 1)).toBe(SECTION_PALETTE[1]);
  await act(async () => { svg().querySelectorAll('polygon')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  const fillsB = new Set(
    [...svg().querySelectorAll('title')].map((t) => t.parentElement!)
      .filter((el) => el.tagName.toLowerCase() === 'circle')
      .slice(0, 6).map((c) => c.getAttribute('fill')),
  );
  expect(fillsB).toEqual(new Set([SECTION_PALETTE[1]]));
  // Ubah warna section B via color picker panel.
  const colorInput = host.querySelector('[aria-label="Warna section"]') as HTMLInputElement;
  expect(colorInput).not.toBeNull();
  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    nativeSet.call(colorInput, '#0000ff');
    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let saved = await save();
  expect(saved.objects.find((o: VenueObject) => o.id === 'section-b').color).toBe('#0000ff');
  // Undo kembalikan (tak berwarna -> fallback), lalu preview pakai fallback.
  await click('[aria-label^="Urungkan"]');
  saved = await save();
  expect(saved.objects.find((o: VenueObject) => o.id === 'section-b').color ?? null).toBeNull();
  // Redo terapkan lagi; save/load (parseVenueJson) tetap valid dan warna bertahan.
  await click('[aria-label^="Ulangi"]');
  saved = await save();
  expect(saved.objects.find((o: VenueObject) => o.id === 'section-b').color).toBe('#0000ff');
  const { doc, errors } = parseVenueJson(JSON.stringify(saved));
  expect(errors).toEqual([]);
  expect(doc!.objects.find((o) => o.id === 'section-b')!.color).toBe('#0000ff');
  // Ekspor valid.
  expect(validateVenueDoc(saved).ok).toBe(true);
  // Preview: legenda memuat kedua warna.
  await click('[aria-label="Mode preview pembeli"]');
  await act(async () => (host.querySelector('.orion-legends > button') as HTMLButtonElement).click());
  const legendHtml = host.querySelector('.orion-legend-content')!.innerHTML;
  expect(legendHtml).toContain('#e11d48');
  expect(legendHtml).toContain('#0000ff');
  // Dokumen lama tanpa field warna tetap valid (fallback, bukan error).
  const legacy = JSON.parse(JSON.stringify(saved));
  for (const o of legacy.objects) delete o.color;
  expect(validateVenueDoc(legacy).ok).toBe(true);
  expect(parseVenueJson(JSON.stringify(legacy)).errors).toEqual([]);
  // Warna invalid ditolak validasi.
  const bad = JSON.parse(JSON.stringify(saved));
  bad.objects[0].color = 'merah';
  expect(validateVenueDoc(bad).ok).toBe(false);
});

it('preview section interactions use the real polygon or transformed SVG path', async () => {
  const { host, click } = await mountEditor();
  const doc = fixtureDoc();
  const curved: VenueObject = { ...sectionB,kind:'vector',points:[],d:'M0 0 Q100 -40 200 0 L160 120 Q100 150 40 120 Z',vTransform:{tx:600,ty:100,scale:2},svgFillRule:'evenodd' };
  doc.objects = [sectionA,curved];
  localStorage.setItem('seat-poc-venue-v1',JSON.stringify(doc));
  await click('[aria-label="Muat simpanan lokal"]');
  await click('[aria-label="Mode preview pembeli"]');
  const polygon = host.querySelector('g[aria-label="Masuk section Section A"] > polygon.preview-section-shape');
  expect(polygon?.getAttribute('points')).toBe('0,0 500,0 500,400 0,400');
  const group = host.querySelector('g[aria-label="Masuk section Section B"]')!;
  expect(group.querySelector('rect')).toBeNull();
  const path = group.querySelector('path.preview-section-shape')!;
  expect(path.getAttribute('d')).toBe(curved.d);
  expect(path.getAttribute('transform')).toBe('translate(600 100) scale(2)');
  expect(path.getAttribute('fill-rule')).toBe('evenodd');
  await act(async () => group.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(host.querySelector('svg[aria-label="Denah section Section B"]')).not.toBeNull();
});

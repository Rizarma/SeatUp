// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueObject } from '../lib/venue';

const stage: VenueObject = {
  id: 'stage-1', kind: 'stage', label: 'Panggung',
  points: [[400, 300], [600, 300], [600, 460], [400, 460]],
  closed: true, width: 28, price: 0, rowParams: null, seats: [],
  source: { origin: 'canvas', confidence: 1 }, guess: null,
};
const vector: VenueObject = {
  id: 'vec-1', kind: 'vector', label: 'Kotak', shape: 'rect', points: [],
  d: 'M0 0H200V100H0Z', closed: true, width: 28, price: 0, rowParams: null, seats: [],
  vTransform: { tx: 700, ty: 100, scale: 1 }, svgFill: '#93c5fd', svgStroke: null,
  source: { origin: 'canvas', confidence: 1 }, guess: null,
};
const aisle: VenueObject = {
  id: 'aisle-1', kind: 'aisle', label: 'Lorong',
  points: [[100, 500], [400, 650]],
  closed: false, width: 28, price: 0, rowParams: null, seats: [],
  source: { origin: 'canvas', confidence: 1 }, guess: null,
};

let cleanup = () => {};
afterEach(() => {
  cleanup();
  delete (Element.prototype as unknown as Record<string, unknown>)['getBBox'];
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
  // getBBox tak ada di happy-dom; ukur path 200x100 agar kotak seleksi vector muncul.
  (Element.prototype as unknown as Record<string, unknown>)['getBBox'] = () => ({ x: 0, y: 0, width: 200, height: 100 });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify({ ...emptyVenue(), objects: [stage, vector, aisle] }));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  const svg = () => host.querySelector('svg.canvas')!;
  const save = async () => { await click('[aria-label="Simpan lokal"]'); return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!); };
  const vbOf = () => svg().getAttribute('viewBox')!.split(' ').map(Number);
  const toClient = (wx: number, wy: number) => {
    const [x, y, w, h] = vbOf();
    return { clientX: ((wx - x) / w) * 1000, clientY: ((wy - y) / h) * 700 };
  };
  const pickObject = async (label: string) => {
    const tab = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.startsWith('Objek')) as HTMLButtonElement;
    await act(async () => tab.click());
    const btn = [...host.querySelectorAll('.objlist button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    await act(async () => btn.click());
  };
  return { host, svg, click, save, toClient, pickObject };
}

function ptr(type: string, init: PointerEventInit & { clientX?: number; clientY?: number }) {
  return new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...init });
}

function setNumber(input: HTMLInputElement, v: string) {
  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  nativeSet.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('panel: putar stage 90° menyimpan sudut (points utuh), panel ikut tampil, 1 undo', async () => {
  const { host, save, pickObject } = await mount();
  await pickObject('Panggung');
  const sec = host.querySelector('[aria-label="Putar shape"]')!;
  expect(sec).not.toBeNull();
  const input = sec.querySelector('input[type="number"]') as HTMLInputElement;
  await act(async () => setNumber(input, '90'));
  const apply = sec.querySelector('button.apply') as HTMLButtonElement;
  await act(async () => apply.click());
  let saved = await save();
  const s = saved.objects.find((o: VenueObject) => o.id === 'stage-1');
  expect(s.rotation).toBe(90);
  expect(s.points).toEqual(stage.points);
  expect(s.label).toBe('Panggung');
  // Panel menampilkan sudut live, bukan reset ke 0.
  await pickObject('Panggung');
  expect(host.querySelector('[aria-label="Putar shape"]')!.textContent).toContain('saat ini 90°');
  await act(async () => (host.querySelector('[aria-label^="Urungkan"]') as HTMLButtonElement).click());
  saved = await save();
  const back = saved.objects.find((o: VenueObject) => o.id === 'stage-1');
  expect(back.rotation ?? 0).toBe(0);
  expect(back.points).toEqual(stage.points);
});

it('kanvas: drag gagang putar menyimpan sudut + gagang mengorbit; Esc membatalkan', async () => {
  const { host, svg, save, toClient, pickObject } = await mount();
  await pickObject('Panggung');
  // Gagang di atas pusat bbox (500, 300-108): di luar shape (atas tepi y=300).
  const handle = svg().querySelector('[data-rotate-handle="stage-1"]') as Element;
  expect(handle).not.toBeNull();
  expect(Number(handle.getAttribute('cy'))).toBeLessThan(300);
  // Sudut awal pointer -90° (tepat di atas pusat (500,380)); geser ke 0° = +90°.
  await act(async () => { handle.dispatchEvent(ptr('pointerdown', toClient(500, 272))); });
  await act(async () => { svg().dispatchEvent(ptr('pointermove', toClient(608, 380))); });
  // Angka live = total sudut (bukan sekadar delta diam).
  expect(host.textContent).toContain('90°');
  await act(async () => { svg().dispatchEvent(ptr('pointerup', toClient(608, 380))); });
  let saved = await save();
  let s = saved.objects.find((o: VenueObject) => o.id === 'stage-1');
  expect(s.rotation).toBeCloseTo(90, 3);
  expect(s.points).toEqual(stage.points);
  // Gagang ikut berputar: offset (0,-108) diputar 90° -> (108,0); pusat tetap (500,380).
  const handle2 = svg().querySelector('[data-rotate-handle="stage-1"]') as Element;
  expect(handle2.getAttribute('cx')).toBe('608');
  expect(handle2.getAttribute('cy')).toBe('380');
  // Mulai drag lagi dari posisi orbit lalu Esc: sudut tetap 90.
  await act(async () => { handle2.dispatchEvent(ptr('pointerdown', toClient(608, 380))); });
  await act(async () => { svg().dispatchEvent(ptr('pointermove', toClient(500, 272))); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await act(async () => { svg().dispatchEvent(ptr('pointerup', toClient(500, 272))); });
  saved = await save();
  s = saved.objects.find((o: VenueObject) => o.id === 'stage-1');
  expect(s.rotation).toBeCloseTo(90, 3);
});

it('lorong: tanpa panel putar dan tanpa gagang putar', async () => {
  const { host, svg, pickObject } = await mount();
  await pickObject('Lorong');
  expect(host.querySelector('[aria-label="Putar shape"]')).toBeNull();
  expect(svg().querySelector('[data-rotate-handle="aisle-1"]')).toBeNull();
  // Fungsi garis tetap: hint edit garis tampil, bukan hint putar.
  expect(host.textContent).toContain('geser titik ujung untuk edit garis');
});

it('panel + kanvas: vector menyimpan rotation, path verbatim, render rotate', async () => {
  const { host, svg, save, pickObject } = await mount();
  await pickObject('Kotak');
  const sec = host.querySelector('[aria-label="Putar shape"]')!;
  const input = sec.querySelector('input[type="number"]') as HTMLInputElement;
  await act(async () => setNumber(input, '90'));
  await act(async () => (sec.querySelector('button.apply') as HTMLButtonElement).click());
  const saved = await save();
  const v = saved.objects.find((o: VenueObject) => o.id === 'vec-1');
  expect(v.vTransform.rotation).toBe(90);
  expect(v.d).toBe('M0 0H200V100H0Z');
  expect(v.vTransform.tx).toBe(700);
  expect(v.vTransform.scale).toBe(1);
  // Render memakai pusat flatten: bbox path 200x100 di (700,100) -> pusat (800,150).
  expect(svg().innerHTML).toContain('rotate(90 800 150)');
  expect(svg().querySelector('[data-rotate-handle="vec-1"]')).not.toBeNull();
});

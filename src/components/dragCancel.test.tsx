// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueObject } from '../lib/venue';

// Seam produksi temuan #1: Event pointer/keyboard pada App/EditorCanvas asli.
// Bukan helper translation. Memverifikasi Escape membatalkan seluruh gesture
// drag (nol commit) dan pointerup berikutnya tidak melakukan commit.

const base = emptyVenue();

function docWithRow(total: number): ReturnType<typeof emptyVenue> {
  const cat = base.categories[0];
  const section: VenueObject = {
    id: 'sec', kind: 'section', label: 'Sec',
    points: [[0, 0], [60000, 0], [60000, 20000], [0, 20000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: cat.id,
  };
  const seats = Array.from({ length: total }, (_, i) => ({
    id: `s-${i}`, row: 'A', number: String(i + 1),
    x: 100 + (i % 200) * 26, y: 100 + Math.floor(i / 200) * 34,
    status: 'available' as const, price: cat.price, sectionId: 'sec', radius: 8,
  }));
  const row: VenueObject = {
    id: 'row-0', kind: 'row-straight', label: 'Baris 0',
    points: [[100, 100]], closed: false, width: 28, price: cat.price,
    rowParams: null, seats, source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec',
  };
  return { ...base, objects: [section, row] };
}

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

function ptr(type: string, init: PointerEventInit & { clientX?: number; clientY?: number }) {
  return new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...init });
}

async function mountWith(total: number) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1 as unknown as number);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify(docWithRow(total)));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  const svg = () => host.querySelector('svg.canvas')!;
  await act(async () => { svg().querySelector('polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(svg().getAttribute('aria-label')).toBe('Editor isi section');
  // Tool Select untuk drag objek baris (jalur Canvas hit-test).
  const selBtn = [...host.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Select')) as HTMLButtonElement;
  await act(async () => selBtn.click());
  const save = async () => { await click('[aria-label="Simpan lokal"]'); return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!); };
  const undoLabel = () => host.querySelector('[aria-label^="Urungkan"]')?.getAttribute('aria-label') ?? '';
  // World -> client via viewBox + rect 1000x700.
  const toClient = (wx: number, wy: number) => {
    const vb = svg().getAttribute('viewBox')!.split(' ').map(Number);
    return { clientX: ((wx - vb[0]) / vb[2]) * 1000, clientY: ((wy - vb[1]) / vb[3]) * 700 };
  };
  return { host, svg, click, save, undoLabel, toClient };
}

async function dragWithEscape(total: number) {
  const { host, svg, save, undoLabel, toClient } = await mountWith(total);
  const before = await save();
  const x0 = before.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x;
  expect(x0).toBe(100);
  const beforeUndo = undoLabel();
  const c = toClient(100, 100);
  // pointerdown pada baris (hit-test Canvas) -> drag -> Escape -> pointerup.
  await act(async () => { svg().dispatchEvent(ptr('pointerdown', c)); });
  await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: c.clientX + 40, clientY: c.clientY + 30 })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: c.clientX + 40, clientY: c.clientY + 30 })); });
  const after = await save();
  const x1 = after.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x;
  return { host, beforeUndo, afterUndo: undoLabel(), x0, x1 };
}

describe('ESC membatalkan drag baris (temuan #1, jalur produksi)', () => {
  it.each([1501, 10000, 20000])('Escape → pointerup nol commit (%i seat)', async (total) => {
    const { beforeUndo, afterUndo, x0, x1 } = await dragWithEscape(total);
    expect(x1).toBe(x0);
    expect(afterUndo).toBe(beforeUndo);
  }, 30000);

  it('pointercancel membatalkan drag (nol commit)', async () => {
    const { svg, save, undoLabel, toClient } = await mountWith(1501);
    const before = await save();
    const x0 = before.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x;
    const u0 = undoLabel();
    const c = toClient(100, 100);
    await act(async () => { svg().dispatchEvent(ptr('pointerdown', c)); });
    await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: c.clientX + 30, clientY: c.clientY + 20 })); });
    await act(async () => { svg().dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })); });
    await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: c.clientX + 30, clientY: c.clientY + 20 })); });
    const after = await save();
    expect(after.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x).toBe(x0);
    expect(undoLabel()).toBe(u0);
  });

  it('ganti tool/section membatalkan drag (nol commit)', async () => {
    const { host, svg, save, undoLabel, toClient, click } = await mountWith(1501);
    const before = await save();
    const x0 = before.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x;
    const u0 = undoLabel();
    const c = toClient(100, 100);
    await act(async () => { svg().dispatchEvent(ptr('pointerdown', c)); });
    await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: c.clientX + 30, clientY: c.clientY })); });
    // Ganti tool di tengah drag.
    const handBtn = [...host.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Hand')) as HTMLButtonElement;
    await act(async () => handBtn.click());
    await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: c.clientX + 30, clientY: c.clientY })); });
    const after = await save();
    expect(after.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x).toBe(x0);
    expect(undoLabel()).toBe(u0);
    void click;
  });

  it('setelah cancel, drag baru tetap berfungsi (tepat 1 commit)', async () => {
    const { svg, save, undoLabel, toClient } = await mountWith(1501);
    const c = toClient(100, 100);
    // Cancel dulu.
    await act(async () => { svg().dispatchEvent(ptr('pointerdown', c)); });
    await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: c.clientX + 20, clientY: c.clientY })); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: c.clientX + 20, clientY: c.clientY })); });
    const u0 = undoLabel();
    // Drag baru: harus commit tepat 1.
    await act(async () => { svg().dispatchEvent(ptr('pointerdown', c)); });
    await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: c.clientX + 40, clientY: c.clientY + 30 })); });
    await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: c.clientX + 40, clientY: c.clientY + 30 })); });
    const after = await save();
    const x1 = after.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x;
    expect(x1).not.toBe(100);
    expect(undoLabel()).not.toBe(u0);
  });

  it('drag normal tepat satu commit; undo/redo mengembalikan koordinat', async () => {
    const { svg, save, click, undoLabel, toClient } = await mountWith(1501);
    const c = toClient(100, 100);
    const u0 = undoLabel();
    await act(async () => { svg().dispatchEvent(ptr('pointerdown', c)); });
    await act(async () => { svg().dispatchEvent(ptr('pointermove', { clientX: c.clientX + 40, clientY: c.clientY + 30 })); });
    await act(async () => { svg().dispatchEvent(ptr('pointerup', { clientX: c.clientX + 40, clientY: c.clientY + 30 })); });
    const moved = await save();
    const xm = moved.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x;
    expect(xm).not.toBe(100);
    expect(undoLabel()).not.toBe(u0);
    await click('[aria-label^="Urungkan"]');
    const undone = await save();
    expect(undone.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x).toBe(100);
    await click('[aria-label^="Ulangi"]');
    const redone = await save();
    expect(redone.objects.find((o: VenueObject) => o.id === 'row-0').seats[0].x).toBe(xm);
  });
});

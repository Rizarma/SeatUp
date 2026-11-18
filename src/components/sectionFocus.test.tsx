// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueDoc, VenueObject } from '../lib/venue';
import { revalidateSeats } from '../lib/contain';
import { parseVenueJson } from '../lib/validate';

const section: VenueObject = { id:'section-a', kind:'section', label:'Section A', points:[[100,100],[400,100],[400,300],[100,300]], closed:true, isSection:true, width:28, price:0, rowParams:null, seats:[], source:{origin:'canvas',confidence:1}, guess:null };
let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
it('isolates section on double click, zooms, and restores venue camera on return', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, width:1000, height:700 } as DOMRect);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  const other = { ...section, id:'other', label:'Section B' };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify({ ...emptyVenue(), objects:[section, other] }));
  await act(async () => root.render(<App />));
  await act(async () => (host.querySelector('[aria-label="Muat simpanan lokal"]') as HTMLButtonElement).click());
  const svg = () => host.querySelector('svg.canvas')!;
  const initial = svg().getAttribute('viewBox');
  expect(svg().querySelectorAll('polygon')).toHaveLength(2);
  await act(async () => { svg().querySelector('polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles:true })); });
  expect(svg().getAttribute('aria-label')).toBe('Editor isi section');
  expect(svg().querySelectorAll('polygon')).toHaveLength(1);
  const focusedWidth = Number(svg().getAttribute('viewBox')!.split(' ')[2]);
  expect(focusedWidth).toBeLessThan(1200);
  await act(async () => (host.querySelector('[aria-label="Perbesar kanvas"]') as HTMLButtonElement).click());
  expect(Number(svg().getAttribute('viewBox')!.split(' ')[2])).toBeLessThan(focusedWidth);
  const back = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Kembali ke venue'))!;
  await act(async () => back.click());
  expect(svg().getAttribute('viewBox')).toBe(initial);
  expect(svg().querySelectorAll('polygon')).toHaveLength(2);
});
it('preserves 1000 compact seats and their footprint through validation and JSON reload', () => {
  const seats = Array.from({length:1000}, (_,i) => ({ id:`s${i}`,row:String(Math.floor(i/50)),number:String(i%50),x:102+(i%50)*5.5,y:102+Math.floor(i/50)*8,status:'available' as const,price:100,sectionId:section.id,radius:1 }));
  const row: VenueObject = { ...section,id:'row',kind:'row-straight',isSection:false,sectionId:section.id,points:[[102,102]],closed:false,seats };
  const result = revalidateSeats([section,row]);
  expect(result.invalidCount).toBe(0);
  const restored = parseVenueJson(JSON.stringify({ ...emptyVenue(),objects:result.objects }));
  expect(restored.errors).toEqual([]);
  expect(restored.doc!.objects[1].seats).toHaveLength(1000);
  expect(restored.doc!.objects[1].seats[0].radius).toBe(1);
  const moved = { ...row,seats:[{...seats[0],x:100.5}] };
  expect(revalidateSeats([section,moved]).invalidCount).toBe(1);
});

it.each(['polygon', 'vector'])('moves section seats with a venue drag (%s)', async (shape) => {
  const container: VenueObject = shape === 'polygon' ? section : {
    ...section, kind: 'vector', points: [], d: 'M0 0H150V100H0Z',
    vTransform: { tx: 100, ty: 100, scale: 2 },
  };
  const base = emptyVenue();
  const legacyRow: VenueObject = {
    ...section, id: 'legacy-row', kind: 'row-straight', isSection: false, closed: false,
    points: [[160, 190]],
    seats: [
      { id: 'legacy-seat', row: 'A', number: '1', x: 160, y: 190, sectionId: section.id, status: 'taken', price: 0 },
      { id: 'unassigned-seat', row: 'A', number: '2', x: 190, y: 190, sectionId: null, status: 'available', price: 0 },
    ],
  };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1200, height: 800 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify({ ...base, objects: [container, legacyRow] }));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  const save = async (): Promise<VenueDoc> => {
    await click('[aria-label="Simpan lokal"]');
    return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!);
  };
  const svg = () => host.querySelector('svg.canvas')!;
  const shapeTag = shape === 'polygon' ? 'polygon' : 'path';
  const sectionShape = () => svg().querySelector(`[aria-label="Section A"] ${shapeTag}`)!;
  const pointer = async (target: Element, type: string, x: number, y: number) => {
    await act(async () => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
    });
  };
  await click('[aria-label="Muat simpanan lokal"]');
  await act(async () => { sectionShape().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  await click('[aria-label^="Baris kursi"]');
  await pointer(svg(), 'pointerdown', 120, 120);
  await pointer(svg(), 'pointermove', 260, 120);
  await pointer(svg(), 'pointerup', 260, 120);
  const before = await save();
  const row = before.objects[2];
  expect(row.seats.length).toBeGreaterThan(1);

  const back = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Kembali ke venue'))!;
  await act(async () => back.click());
  await click('.dock [aria-label^="Select"]');
  const scaleX = Number(svg().getAttribute('viewBox')!.split(' ')[2]) / 1200;
  const scaleY = Number(svg().getAttribute('viewBox')!.split(' ')[3]) / 800;
  const dx = 400 * scaleX;
  const dy = 200 * scaleY;
  await pointer(sectionShape(), 'pointerdown', 180, 160);
  await pointer(svg(), 'pointermove', 380, 260);
  await pointer(svg(), 'pointerup', 580, 360);

  const after = await save();
  const expectMovedSeat = (seat: VenueObject['seats'][number], original: VenueObject['seats'][number]) => {
    expect(seat.x).toBeCloseTo(original.x + dx);
    expect(seat.y).toBeCloseTo(original.y + dy);
    expect(seat).toEqual({ ...original, x: seat.x, y: seat.y });
  };
  expect(after.objects[2].seats).toHaveLength(row.seats.length);
  after.objects[2].seats.forEach((seat, i) => expectMovedSeat(seat, row.seats[i]));
  expect(after.objects[2].points[0][0]).toBeCloseTo(row.points[0][0] + dx);
  expect(after.objects[2].points[0][1]).toBeCloseTo(row.points[0][1] + dy);
  expectMovedSeat(after.objects[1].seats[0], before.objects[1].seats[0]);
  expect(after.objects[1].seats[1]).toEqual(before.objects[1].seats[1]);
  if (shape === 'polygon') {
    expect(after.objects[0].points[0][0]).toBeCloseTo(100 + dx);
    expect(after.objects[0].points[0][1]).toBeCloseTo(100 + dy);
  } else {
    expect(after.objects[0].vTransform!.tx).toBeCloseTo(100 + dx);
    expect(after.objects[0].vTransform!.ty).toBeCloseTo(100 + dy);
  }
  await click('[aria-label^="Urungkan"]');
  expect((await save()).objects).toEqual(before.objects);
  await click('[aria-label^="Ulangi"]');
  expect((await save()).objects).toEqual(after.objects);
  await act(async () => { sectionShape().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  const movedSeat = after.objects[2].seats[0];
  const dot = svg().querySelector(`[data-seat-id="${movedSeat.id}"]`)!;
  expect(Number(dot.getAttribute('cx'))).toBeCloseTo(movedSeat.x);
  expect(Number(dot.getAttribute('cy'))).toBeCloseTo(movedSeat.y);
});

it('single row ala seats.io: klik pasang jangkar, hover preview, klik kedua commit, seret gambar-dan-selesai, Esc batal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, width:1200, height:800 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify({ ...emptyVenue(), objects:[section] }));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  // Baris hanya dibuat di dalam section fokus: masuk dulu via dblklik.
  const svg0 = host.querySelector('svg.canvas')!;
  await act(async () => { svg0.querySelector('polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles:true })); });
  expect(svg0.getAttribute('aria-label')).toBe('Editor isi section');
  await click('[aria-label^="Baris kursi"]');
  const svg = host.querySelector('svg.canvas')!;
  const pointer = async (type: string,x:number,y:number) => act(async () => { svg.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1})); });
  const hover = async (x: number,y:number) => act(async () => { svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1})); });
  const save = async () => { await click('[aria-label="Simpan lokal"]'); return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!); };
  // 1. Klik pertama = pasang jangkar + 1 bullet, belum commit.
  await pointer('pointerdown',120,120);
  await pointer('pointerup',120,120);
  expect((await save()).objects).toHaveLength(1);
  expect(host.textContent).toContain('Jangkar:');
  expect(host.querySelector('.seat-drag-summary')).toBeNull();
  // 2. Hover ke kanan = preview membesar, tetap belum commit.
  await hover(260,120);
  expect((await save()).objects).toHaveLength(1);
  // 3. Klik kedua = commit satu baris horizontal.
  await pointer('pointerdown',260,120);
  await pointer('pointerup',260,120);
  let saved = await save();
  expect(saved.objects).toHaveLength(2);
  expect(saved.objects[1].sectionId).toBe(section.id);
  expect(saved.objects[1].kind).toBe('row-straight');
  expect(saved.objects[1].seats.length).toBeGreaterThan(1);
  expect(new Set(saved.objects[1].seats.map((s: { y: number }) => s.y)).size).toBe(1);
  // 4. Undo menghapus baris yang baru dibuat.
  await click('[aria-label^="Urungkan"]');
  expect((await save()).objects).toHaveLength(1);
  // 5. Seret = gambar-dan-selesai saat dilepas (satu baris).
  await pointer('pointerdown',120,150);
  await pointer('pointermove',198,150);
  expect(host.querySelector('.seat-drag-summary')!.textContent).toContain('Lepaskan untuk membuat');
  await pointer('pointerup',198,150);
  saved = await save();
  expect(saved.objects).toHaveLength(2);
  expect(saved.objects[1].kind).toBe('row-straight');
  expect(saved.objects[1].seats.length).toBeGreaterThan(1);
  expect(new Set(saved.objects[1].seats.map((s: { y: number }) => s.y)).size).toBe(1);
  // 6. Esc membatalkan jangkar tanpa commit.
  await pointer('pointerdown',130,160);
  await pointer('pointerup',130,160);
  expect(host.textContent).toContain('Jangkar:');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  await pointer('pointerup',130,160);
  expect((await save()).objects).toHaveLength(2);
  expect(host.querySelector('.seat-drag-summary')).toBeNull();
  expect(host.textContent).not.toContain('Jangkar:');
});

it('multirow: gerak vertikal menambah baris, klik kedua commit blok', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, width:1200, height:800 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify({ ...emptyVenue(), objects:[section] }));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  const svg0 = host.querySelector('svg.canvas')!;
  await act(async () => { svg0.querySelector('polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles:true })); });
  expect(svg0.getAttribute('aria-label')).toBe('Editor isi section');
  await click('[aria-label^="Blok baris"]');
  const svg = host.querySelector('svg.canvas')!;
  const pointer = async (type: string,x:number,y:number) => act(async () => { svg.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1})); });
  const hover = async (x: number,y:number) => act(async () => { svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1})); });
  const save = async () => { await click('[aria-label="Simpan lokal"]'); return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!); };
  // Klik pertama = jangkar, hover diagonal = preview blok (belum commit).
  await pointer('pointerdown',120,120);
  await pointer('pointerup',120,120);
  expect(host.textContent).toContain('Jangkar:');
  await hover(300,220);
  expect((await save()).objects).toHaveLength(1);
  // Klik kedua = commit blok: banyak baris (y bervariasi), tiap baris banyak kursi.
  await pointer('pointerdown',300,220);
  await pointer('pointerup',300,220);
  const saved = await save();
  expect(saved.objects).toHaveLength(2);
  expect(saved.objects[1].kind).toBe('row-straight');
  expect(saved.objects[1].sectionId).toBe(section.id);
  const ys = new Set(saved.objects[1].seats.map((s: { y: number }) => s.y));
  expect(ys.size).toBeGreaterThan(1);
  expect(saved.objects[1].seats.length).toBeGreaterThan(ys.size);
  // Undo menghapus blok.
  await click('[aria-label^="Urungkan"]');
  expect((await save()).objects).toHaveLength(1);
});

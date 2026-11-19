// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueObject } from '../lib/venue';
import { toWorld } from '../lib/camera';

function ptr(type: string, init: PointerEventInit & { clientX?: number; clientY?: number }) {
  return new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...init });
}

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function mountApp(fixture?: ReturnType<typeof emptyVenue>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1 as unknown as number);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
  vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  if (fixture) localStorage.setItem('seat-poc-venue-v1', JSON.stringify(fixture));
  await act(async () => root.render(<App />));
  const click = async (selector: string) =>
    act(async () => { (host.querySelector(selector) as HTMLButtonElement).click(); });
  if (fixture) await click('[aria-label="Muat simpanan lokal"]');
  const svg = () => host.querySelector('svg.canvas') as unknown as SVGSVGElement;
  const vb = () => svg().getAttribute('viewBox')!.split(' ').map(Number);
  const toClient = (wx: number, wy: number) => {
    const v = vb();
    return { clientX: ((wx - v[0]) / v[2]) * 1000, clientY: ((wy - v[1]) / v[3]) * 700 };
  };
  const dockBtn = (prefix: string) =>
    [...host.querySelectorAll('.dock button[aria-label]')].find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith(prefix)) as HTMLButtonElement;
  const save = async () => {
    await click('[aria-label="Simpan lokal"]');
    return JSON.parse(localStorage.getItem('seat-poc-venue-v1')!) as ReturnType<typeof emptyVenue>;
  };
  const undoLabel = () => host.querySelector('[aria-label^="Urungkan"]')?.getAttribute('aria-label') ?? '';
  const shapeHint = () => host.querySelector('.shape-hint')?.textContent ?? null;
  return { host, svg, vb, toClient, dockBtn, click, save, undoLabel, shapeHint };
}

/** Klik-tahan titik world: down lalu up pada client yang sama (tanpa gerak). */
async function tapAt(svg: () => SVGSVGElement, c: { clientX: number; clientY: number }) {
  await act(async () => { svg().dispatchEvent(ptr('pointerdown', c)); });
  await act(async () => { svg().dispatchEvent(ptr('pointerup', c)); });
}

async function clickClick(svg: () => SVGSVGElement, a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  await tapAt(svg, a);
  await act(async () => { svg().dispatchEvent(ptr('pointermove', b)); });
  await tapAt(svg, b);
}

async function dragAt(svg: () => SVGSVGElement, a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  await act(async () => { svg().dispatchEvent(ptr('pointerdown', a)); });
  await act(async () => { svg().dispatchEvent(ptr('pointermove', { ...b, buttons: 1 })); });
  await act(async () => { svg().dispatchEvent(ptr('pointerup', b)); });
}

function stripId(o: VenueObject) {
  const { id: _id, ...rest } = o;
  void _id;
  return rest;
}

const WORLD_A: [number, number] = [200, 150];
const WORLD_B: [number, number] = [520, 430];

describe('gesture shape: klik–gerak–klik utama, seret cara cepat', () => {
  it.each([
    ['Stage', 'stage', 'Panggung'],
    ['Lorong', 'aisle', 'Lorong'],
    ['Rectangle', 'rect', 'Kotak 1'],
    ['Circle', 'circle', 'Lingkaran 1'],
  ])('%s: klik–klik membuat tepat satu objek lalu tool tetap aktif', async (label, kind, expectedLabel) => {
    const m = await mountApp();
    await act(async () => { m.dockBtn(label).click(); });
    expect(m.shapeHint()).toBe('Klik titik awal di kanvas');
    const before = await m.save();
    await clickClick(m.svg, m.toClient(...WORLD_A), m.toClient(...WORLD_B));
    const after = await m.save();
    expect(after.objects.length).toBe(before.objects.length + 1);
    const obj = after.objects[after.objects.length - 1];
    expect(obj.label).toBe(expectedLabel);
    // Tool tetap aktif untuk menggambar lagi (bukan pindah ke Select).
    expect(m.dockBtn(label).classList.contains('on')).toBe(true);
    // Petunjuk kembali ke awal karena draf sudah jadi objek.
    expect(m.shapeHint()).toBe('Klik titik awal di kanvas');
    // Objek kedua berturut-turut: hitungan bertambah, label berurutan.
    const c = m.toClient(600, 500);
    const d = m.toClient(800, 650);
    await clickClick(m.svg, c, d);
    const twice = await m.save();
    expect(twice.objects.length).toBe(before.objects.length + 2);
    expect(kind).toBeTruthy();
  });

  it.each([
    ['Stage', 'Panggung'],
    ['Lorong', 'Lorong'],
    ['Rectangle', 'Kotak 1'],
    ['Circle', 'Lingkaran 1'],
  ])('%s: seret–lepas memakai geometri yang sama dengan klik–klik', async (label, expectedLabel) => {
    const m = await mountApp();
    await act(async () => { m.dockBtn(label).click(); });
    const before = await m.save();
    const a = m.toClient(...WORLD_A);
    const b = m.toClient(...WORLD_B);
    await clickClick(m.svg, a, b);
    const viaClick = (await m.save()).objects.slice(-1)[0];
    expect(viaClick.label).toBe(expectedLabel);
    // Satu Undo menghapus tepat objek itu (satu aksi undo per objek).
    const undoBefore = m.undoLabel();
    await m.click('[aria-label^="Urungkan"]');
    const undone = await m.save();
    expect(undone.objects.length).toBe(before.objects.length);
    expect(m.undoLabel()).not.toBe(undoBefore);
    // Seret pada dua titik dunia yang sama → geometri identik (selain id).
    await dragAt(m.svg, a, b);
    const viaDrag = (await m.save()).objects.slice(-1)[0];
    expect(stripId(viaDrag)).toEqual(stripId(viaClick));
  });

  it('klik pertama hanya draf: belum ada objek sampai klik kedua / lepas-seret', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Rectangle').click(); });
    const before = await m.save();
    await tapAt(m.svg, m.toClient(...WORLD_A));
    expect((await m.save()).objects.length).toBe(before.objects.length);
    expect(m.shapeHint()).toBe('Klik lagi untuk membuat · Esc untuk batal');
    // Penanda titik awal tampil di kanvas.
    expect(m.host.querySelector('[data-shape-preview="rect"]')).not.toBeNull();
    await tapAt(m.svg, m.toClient(...WORLD_B));
    expect((await m.save()).objects.length).toBe(before.objects.length + 1);
  });

  it('petunjuk tiga status: awal, menunggu klik kedua, dan saat menyeret', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Stage').click(); });
    expect(m.shapeHint()).toBe('Klik titik awal di kanvas');
    const a = m.toClient(...WORLD_A);
    const b = m.toClient(...WORLD_B);
    await tapAt(m.svg, a);
    expect(m.shapeHint()).toBe('Klik lagi untuk membuat · Esc untuk batal');
    // Tombol ditahan + menyeret → petunjuk lepas.
    await act(async () => { m.svg().dispatchEvent(ptr('pointerdown', a)); });
    await act(async () => { m.svg().dispatchEvent(ptr('pointermove', { ...b, buttons: 1 })); });
    expect(m.shapeHint()).toBe('Lepas untuk membuat · Esc untuk batal');
    await act(async () => { m.svg().dispatchEvent(ptr('pointerup', b)); });
    expect((await m.save()).objects.length).toBe(1);
    expect(m.shapeHint()).toBe('Klik titik awal di kanvas');
  });

  it('satu petunjuk status aktif di kanvas; teks SVG ganda dihapus', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Circle').click(); });
    await tapAt(m.svg, m.toClient(...WORLD_A));
    const hints = m.host.querySelectorAll('.shape-hint');
    expect(hints.length).toBe(1);
    expect(hints[0].getAttribute('role')).toBe('status');
    const svgTexts = [...m.host.querySelectorAll('svg.canvas text')].map((t) => t.textContent ?? '');
    expect(svgTexts.some((t) => t.includes('Klik lagi untuk membuat'))).toBe(false);
  });

  it('klik kedua terlalu dekat mempertahankan titik awal (nol objek)', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Rectangle').click(); });
    const before = await m.save();
    const a = m.toClient(...WORLD_A);
    await tapAt(m.svg, a);
    await tapAt(m.svg, { clientX: a.clientX + 2, clientY: a.clientY + 1 });
    expect((await m.save()).objects.length).toBe(before.objects.length);
    // Draf dipertahankan: masih menunggu klik kedua.
    expect(m.shapeHint()).toBe('Klik lagi untuk membuat · Esc untuk batal');
    await tapAt(m.svg, m.toClient(...WORLD_B));
    expect((await m.save()).objects.length).toBe(before.objects.length + 1);
  });

  it('Esc membatalkan draf shape; ganti tool membersihkan draf', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Lorong').click(); });
    const before = await m.save();
    await tapAt(m.svg, m.toClient(...WORLD_A));
    expect(m.shapeHint()).toBe('Klik lagi untuk membuat · Esc untuk batal');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(m.shapeHint()).toBe('Klik titik awal di kanvas');
    expect((await m.save()).objects.length).toBe(before.objects.length);
    // Draf baru lalu ganti tool → dibersihkan.
    await tapAt(m.svg, m.toClient(...WORLD_A));
    expect(m.shapeHint()).toBe('Klik lagi untuk membuat · Esc untuk batal');
    await act(async () => { m.dockBtn('Select').click(); });
    expect(m.host.querySelector('.shape-hint')).toBeNull();
    await act(async () => { m.dockBtn('Lorong').click(); });
    expect(m.shapeHint()).toBe('Klik titik awal di kanvas');
  });
});

describe('pemisahan draf polygon vs shape', () => {
  const polyCount = (doc: ReturnType<typeof emptyVenue>) =>
    doc.objects.filter((o) => o.kind === 'section' && (o as VenueObject).shape === 'polygon').length;

  it('Esc pada tool shape mempertahankan draf polygon; Enter/klik-ganda terkunci di tool shape', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Polygon').click(); });
    const p1 = m.toClient(100, 100);
    const p2 = m.toClient(300, 100);
    const p3 = m.toClient(200, 260);
    await tapAt(m.svg, p1);
    await tapAt(m.svg, p2);
    await tapAt(m.svg, p3);
    // Pindah ke Rectangle + mulai draf shape.
    await act(async () => { m.dockBtn('Rectangle').click(); });
    expect(polyCount(await m.save())).toBe(0);
    await tapAt(m.svg, m.toClient(...WORLD_A));
    expect(m.shapeHint()).toBe('Klik lagi untuk membuat · Esc untuk batal');
    // Enter dan klik-ganda saat tool Rectangle: draf polygon tetap tersimpan, nol objek baru.
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await act(async () => { m.svg().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const mid = await m.save();
    expect(polyCount(mid)).toBe(0);
    expect(mid.objects.length).toBe(0);
    // Esc: draf shape batal, draf polygon dipertahankan.
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(m.shapeHint()).toBe('Klik titik awal di kanvas');
    expect((await m.save()).objects.length).toBe(0);
    // Kembali ke Polygon: lanjutkan dari titik yang sama + tutup via Enter.
    await act(async () => { m.dockBtn('Polygon').click(); });
    await tapAt(m.svg, m.toClient(150, 320));
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    const done = await m.save();
    expect(polyCount(done)).toBe(1);
    expect(done.objects[0].points).toHaveLength(4);
  });
});

describe('pratinjau mengikuti kamera saat kursor diam', () => {
  it('zoom masuk: pratinjau setelah zoom sama dengan titik akhir tersimpan', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Stage').click(); });
    const a = m.toClient(...WORLD_A);
    const b = m.toClient(...WORLD_B);
    await tapAt(m.svg, a);
    await act(async () => { m.svg().dispatchEvent(ptr('pointermove', b)); });
    const v0 = m.vb();
    const rect = () => m.host.querySelector('[data-shape-preview="stage"] rect');
    const beforeZoom = rect()?.getAttribute('width');
    expect(beforeZoom).not.toBeNull();
    // Zoom via tombol (kursor diam di B, tanpa pointermove baru).
    await m.click('[aria-label="Perbesar kanvas"]');
    const v1 = m.vb();
    const rectEl = rect()!;
    const px = {
      x: Number(rectEl.getAttribute('x')),
      y: Number(rectEl.getAttribute('y')),
      w: Number(rectEl.getAttribute('width')),
      h: Number(rectEl.getAttribute('height')),
    };
    // Pratinjau dihitung ulang dari posisi layar B pada kamera baru.
    const endPreview: [number, number] = [px.x + px.w, px.y + px.h];
    const expectedEnd = toWorld(b.clientX, b.clientY, { left: 0, top: 0, width: 1000, height: 700 }, { x: v1[0], y: v1[1], w: v1[2], h: v1[3] });
    expect(Math.abs(endPreview[0] - expectedEnd[0])).toBeLessThan(1e-6);
    expect(Math.abs(endPreview[1] - expectedEnd[1])).toBeLessThan(1e-6);
    // Klik di B tanpa menggeser kursor → objek tersimpan memakai titik akhir yang sama.
    await tapAt(m.svg, b);
    const saved = (await m.save()).objects[0];
    expect(saved.points[2][0]).toBeCloseTo(endPreview[0], 6);
    expect(saved.points[2][1]).toBeCloseTo(endPreview[1], 6);
    // Titik awal tetap dalam koordinat dokumen (kamera saat klik pertama).
    const expectedStart = toWorld(a.clientX, a.clientY, { left: 0, top: 0, width: 1000, height: 700 }, { x: v0[0], y: v0[1], w: v0[2], h: v0[3] });
    expect(saved.points[0][0]).toBeCloseTo(Math.min(expectedStart[0], endPreview[0]), 6);
    expect(saved.points[0][1]).toBeCloseTo(Math.min(expectedStart[1], endPreview[1]), 6);
  });

  it('zoom keluar: klik tanpa gerak menyimpan titik akhir kamera terbaru', async () => {
    const m = await mountApp();
    await act(async () => { m.dockBtn('Circle').click(); });
    const a = m.toClient(...WORLD_A);
    const b = m.toClient(...WORLD_B);
    await tapAt(m.svg, a);
    await act(async () => { m.svg().dispatchEvent(ptr('pointermove', b)); });
    const v0 = m.vb();
    await m.click('[aria-label="Perkecil kanvas"]');
    const v1 = m.vb();
    const anchorWorld = toWorld(a.clientX, a.clientY, { left: 0, top: 0, width: 1000, height: 700 }, { x: v0[0], y: v0[1], w: v0[2], h: v0[3] });
    const expectedEnd = toWorld(b.clientX, b.clientY, { left: 0, top: 0, width: 1000, height: 700 }, { x: v1[0], y: v1[1], w: v1[2], h: v1[3] });
    await tapAt(m.svg, b);
    const saved = (await m.save()).objects[0];
    // Bangun ulang ekspektasi lewat builder yang sama dipakai produksi:
    // titik awal dari kamera lama, titik akhir dari kamera terbaru.
    const { buildShapeObject } = await import('../lib/shapeDraft');
    const expected = buildShapeObject('circle', anchorWorld as [number, number], expectedEnd as [number, number], { aisleWidth: 28, objectCount: 0 })!;
    const { id: _i1, ...restSaved } = saved;
    const { id: _i2, ...restExpected } = expected;
    void _i1; void _i2;
    expect(restSaved).toEqual(restExpected);
  });
});

describe('alur baris kursi dan blok baris tidak rusak', () => {
  function sectionFixture(): ReturnType<typeof emptyVenue> {
    const base = emptyVenue();
    const cat = base.categories[0];
    const section: VenueObject = {
      id: 'sec', kind: 'section', label: 'Sec',
      points: [[0, 0], [60000, 0], [60000, 20000], [0, 20000]],
      closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
      source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: cat.id,
    };
    return { ...base, objects: [section] };
  }

  it('baris kursi: klik–gerak–klik membuat satu kelompok', async () => {
    const m = await mountApp(sectionFixture());
    await act(async () => { m.svg().querySelector('polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(m.svg().getAttribute('aria-label')).toBe('Editor isi section');
    await act(async () => { m.dockBtn('Baris kursi').click(); });
    const before = await m.save();
    const rowsBefore = before.objects.filter((o: VenueObject) => o.kind.startsWith('row')).length;
    await clickClick(m.svg, m.toClient(200, 200), m.toClient(600, 200));
    const after = await m.save();
    const rowsAfter = after.objects.filter((o: VenueObject) => o.kind.startsWith('row')).length;
    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  it('blok baris: gerak vertikal menambah baris', async () => {
    const m = await mountApp(sectionFixture());
    await act(async () => { m.svg().querySelector('polygon')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await act(async () => { m.dockBtn('Blok baris').click(); });
    const before = await m.save();
    const rowsBefore = before.objects.filter((o: VenueObject) => o.kind.startsWith('row')).length;
    await clickClick(m.svg, m.toClient(200, 200), m.toClient(600, 400));
    const after = await m.save();
    const rowsAfter = after.objects.filter((o: VenueObject) => o.kind.startsWith('row')).length;
    expect(rowsAfter).toBe(rowsBefore + 1);
    expect(after.objects.length).toBe(before.objects.length + 1);
  });
});

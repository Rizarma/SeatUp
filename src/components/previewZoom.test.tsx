// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyVenue } from '../lib/venue';
import type { VenueDoc } from '../lib/venue';

function fixtureDoc(): VenueDoc {
  const base = emptyVenue();
  const cat = base.categories[0];
  return {
    ...base,
    objects: [
      {
        id: 'section-a', kind: 'section', label: 'Section A',
        points: [[0, 0], [500, 0], [500, 400], [0, 400]],
        closed: true, isSection: true, color: cat.color,
        categoryId: cat.id, width: 28, price: 0, rowParams: null, seats: [],
        source: { origin: 'canvas', confidence: 1 }, guess: null,
      },
      {
        id: 'row-a', kind: 'row-straight', label: 'Baris A', points: [[10, 10]],
        closed: false, width: 28, price: cat.price, rowParams: null,
        seats: Array.from({ length: 4 }, (_, i) => ({
          id: `seat-a-${i}`, row: 'A', number: String(i + 1),
          x: 50 + i * 30, y: 50, status: 'available' as const,
          price: cat.price, sectionId: 'section-a', radius: 8, invalid: false,
        })),
        source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'section-a',
      },
    ],
  };
}

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function mountPreview() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); };
  localStorage.setItem('seat-poc-venue-v1', JSON.stringify(fixtureDoc()));
  await act(async () => root.render(<App />));
  const click = async (selector: string) => act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await click('[aria-label="Muat simpanan lokal"]');
  await click('[aria-label="Mode preview pembeli"]');
  const map = () => host.querySelector('.orion-map svg.canvas') as SVGSVGElement;
  const vb = () => map().getAttribute('viewBox')!.split(' ').map(Number);
  return { host, click, map, vb };
}

it('zoom tombol memperbesar/memperkecil viewBox venue', async () => {
  const { click, vb } = await mountPreview();
  const before = vb();
  await click('[aria-label="Perbesar denah"]');
  const zoomed = vb();
  expect(zoomed[2]).toBeLessThan(before[2]);
  expect(zoomed[3]).toBeLessThan(before[3]);
  await click('[aria-label="Perkecil denah"]');
  const out = vb();
  expect(out[2]).toBeGreaterThan(zoomed[2]);
});

it('scroll wheel zoom berjangkar kursor di venue', async () => {
  const { map, vb } = await mountPreview();
  const wheel = (deltaY: number) => {
    const evt = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
    Object.defineProperties(evt, {
      clientX: { value: 500 },
      clientY: { value: 350 },
    });
    return evt;
  };
  const before = vb();
  await act(async () => { map().dispatchEvent(wheel(-200)); });
  const zoomed = vb();
  expect(zoomed[2]).toBeLessThan(before[2]);
  // Titik dunia di bawah kursor (tengah) tetap di tengah setelah zoom.
  expect(zoomed[0] + zoomed[2] / 2).toBeCloseTo(before[0] + before[2] / 2, 4);
  await act(async () => { map().dispatchEvent(wheel(400)); });
  expect(vb()[2]).toBeGreaterThan(zoomed[2]);
});

it('zoom tombol bekerja di dalam section', async () => {
  const { host, click, vb } = await mountPreview();
  await act(async () => {
    (host.querySelector('g[aria-label="Masuk section Section A"]') as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const before = vb();
  await click('[aria-label="Perbesar denah"]');
  expect(vb()[2]).toBeLessThan(before[2]);
});

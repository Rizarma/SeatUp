// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Regresi P2 #2: mount EDITOR sebenarnya (bukan hanya helper ambang).
// Setiap seat existing hanya digambar SATU renderer; ghost-only Canvas
// tidak menggambar ulang base; transisi menginvalidasi cache.

const recordedBaseCalls: Array<{ n: number; fills: string[]; dimmed: number[] }> = vi.hoisted(
  () => [],
);

vi.mock('../lib/seatCanvas', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/seatCanvas')>();
  return {
    ...mod,
    drawSeatBase: (
      ctx: CanvasRenderingContext2D,
      dpr: number,
      seats: Array<{ fill: string; dimmed: boolean }>,
      vb: unknown,
      cssW: number,
      cssH: number,
      simple: boolean,
    ) => {
      recordedBaseCalls.push({
        n: seats.length,
        fills: seats.slice(0, 8).map((s) => s.fill),
        dimmed: seats.slice(0, 8).map((s) => (s.dimmed ? 1 : 0)),
      });
      return mod.drawSeatBase(ctx, dpr, seats as never, vb as never, cssW, cssH, simple);
    },
  };
});

import { StoreProvider, useStore } from '../store';
import EditorCanvas, {
  CANVAS_SEAT_THRESHOLD,
  ghostOwner,
  isBaseOnCanvas,
  isSelectionOnCanvas,
  seatBaseOwner,
} from './EditorCanvas';
import { makeBaseKey } from './SeatCanvas';
import { emptyVenue } from '../lib/venue';
import type { VenueDoc, VenueObject } from '../lib/venue';
import { useEffect, useRef } from 'react';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function docWithSeats(total: number, opts: { mixedStatus?: boolean } = {}): { doc: ReturnType<typeof emptyVenue>; sectionId: string } {
  const base = emptyVenue();
  const cat = base.categories[0];
  const section: VenueObject = {
    id: 'sec', kind: 'section', label: 'Sec',
    points: [[0, 0], [60000, 0], [60000, 20000], [0, 20000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: cat.id,
  };
  // Sebar status campuran deterministik: available/taken/book + invalid.
  // Invalid dihitung ulang oleh store saat load (containment footprint),
  // jadi kursi invalid dibuat BENAR-BENAR di luar section agar flag bertahan.
  const seats = Array.from({ length: total }, (_, i) => {
    const m = i % 10;
    const status = m < 7 ? 'available' : m < 8 ? 'taken' : m < 9 ? 'book' : 'available';
    const outside = m === 9;
    return {
      id: `s-${i}`, row: 'A', number: String(i + 1),
      x: outside ? -500 - i : 100 + (i % 200) * 26,
      y: outside ? -500 : 100 + Math.floor(i / 200) * 34,
      status: status as 'available' | 'taken' | 'book', price: cat.price,
      sectionId: 'sec', radius: 8,
    };
  });
  const row: VenueObject = {
    id: 'row-0', kind: 'row-straight', label: 'Baris 0',
    points: [[100, 100]], closed: false, width: 28, price: cat.price,
    rowParams: null, seats: seats as VenueObject['seats'],
    source: { origin: 'canvas', confidence: 1 }, guess: null, sectionId: 'sec',
  };
  void opts;
  return { doc: { ...base, objects: [section, row] }, sectionId: 'sec' };
}

function ghostsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: 500 + i * 2, y: 500, ok: i % 5 !== 0 }));
}

function DocLoader({ doc }: { doc: VenueDoc }) {
  const { loadDoc } = useStore();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    loadDoc(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

async function mountEditor(existing: number, ghostN: number | null, tool = 'row') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // rAF sinkron agar SeatCanvas langsung menggambar saat efek jalan.
  let rafId = 0;
  const cbs = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafId += 1; cbs.set(rafId, cb); return rafId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { cbs.delete(id); });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: () => {}, save: () => {}, restore: () => {}, setTransform: () => {},
    beginPath: () => {}, moveTo: () => {}, arc: () => {}, rect: () => {},
    fill: () => {}, stroke: () => {}, drawImage: () => {},
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 0,
    canvas: { width: 10, height: 10 },
  } as unknown as CanvasRenderingContext2D);
  recordedBaseCalls.length = 0;
  const { doc, sectionId } = docWithSeats(existing);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const anchor: [number, number] | null = ghostN == null ? null : [100, 100];
  const ghosts = ghostN == null ? null : ghostsOf(ghostN);
  const noop = () => {};
  const toolValue = tool as 'row' | 'select';
  function ToolSetter() {
    const { setTool } = useStore();
    const done = useRef(false);
    useEffect(() => {
      if (done.current) return;
      done.current = true;
      setTool(toolValue);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  await act(async () => {
    root.render(
      <StoreProvider>
        <DocLoader doc={doc} />
        <ToolSetter />
        <EditorCanvas hoveredObjectId={null} rowDrag={null} onRowDrag={noop} onRowRelease={noop}
          onRowHover={noop} onRowTapCommit={noop} onCancelRowDrag={noop}
          focusId={sectionId} onFocusSection={noop} seatRadius={8}
          anchor={anchor} onAnchor={noop} showBg={false} ghosts={ghosts} aisleWidth={28} />
      </StoreProvider>,
    );
  });
  const flush = () => { const list = [...cbs.values()]; cbs.clear(); act(() => { for (const cb of list) cb(16); }); };
  flush();
  await act(async () => {});
  flush();
  const canvasMounted = host.querySelector('canvas[data-seat-canvas="editor"]') != null;
  const svgSeats = host.querySelectorAll('[data-seat-id]').length;
  return { host, root, canvasMounted, svgSeats, flush, cleanup: () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); } };
}

describe('kepemilikan renderer editor (P2 #2, mount nyata)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); recordedBaseCalls.length = 0; });

  it('helper kepemilikan eksplisit: batas 1500/500', () => {
    expect(CANVAS_SEAT_THRESHOLD).toBe(1500);
    expect(seatBaseOwner(0)).toBe('svg');
    expect(seatBaseOwner(1500)).toBe('svg');
    expect(seatBaseOwner(1501)).toBe('canvas');
    expect(seatBaseOwner(10000)).toBe('canvas');
    expect(isBaseOnCanvas(1500)).toBe(false);
    expect(isBaseOnCanvas(1501)).toBe(true);
    expect(isSelectionOnCanvas(1000)).toBe(false);
    expect(isSelectionOnCanvas(10000)).toBe(true);
    const anchor: [number, number] = [0, 0];
    expect(ghostOwner('row', anchor, 500)).toBe('svg');
    expect(ghostOwner('row', anchor, 501)).toBe('canvas');
    expect(ghostOwner('row', null, 3000)).toBeNull();
    expect(ghostOwner('select', anchor, 3000)).toBeNull();
  });

  it('kunci base menginvalidasi saat kepemilikan berubah (svg-empty vs canvas)', () => {
    const vb = { x: 0, y: 0, w: 1000, h: 700 };
    const kSvg = makeBaseKey({ docRev: 1, previewKey: null, baseMode: 'svg-empty' }, vb, 1000, 700, 1, false);
    const kCanvas = makeBaseKey({ docRev: 1, previewKey: null, baseMode: 'canvas' }, vb, 1000, 700, 1, false);
    expect(kSvg).not.toBe(kCanvas);
  });

  it.each([
    [0, 500], [0, 501],
    [1000, 500], [1000, 501],
    [1500, 500], [1500, 501],
  ])('existing %i + ghost %i: base tetap SVG (satu renderer), canvas hanya bila ghost besar', async (existing, ghostN) => {
    const m = await mountEditor(existing, ghostN);
    try {
      // Base SVG selalu merender seat existing (tidak di-null-kan pada ambang ini).
      // Ghost-only canvas dipasang hanya bila ghost >500.
      expect(m.canvasMounted).toBe(ghostN > 500);
      // Setiap seat existing tepat satu renderer: SVG memuat semuanya, Canvas
      // base kosong (diverifikasi pada uji draw-base di bawah).
      expect(m.svgSeats).toBe(existing);
    } finally { m.cleanup(); }
  });

  it.each([[1501], [10000]])('existing %i: base pindah ke Canvas, SVG nol (tak ganda)', async (existing) => {
    const m = await mountEditor(existing, 10);
    try {
      expect(m.canvasMounted).toBe(true);
      expect(m.svgSeats).toBe(0);
      // Canvas base benar-benar menerima seat existing pada mode ini.
      const nonEmpty = recordedBaseCalls.filter((c) => c.n > 0);
      expect(nonEmpty.length).toBeGreaterThan(0);
    } finally { m.cleanup(); }
  });

  it('ghost-only canvas: draw base Canvas menerima NOL seat existing (tidak ganda)', async () => {
    // Verifikasi gating produksi: baseOnCanvas=false -> builder mengosongkan out
    // sebelum drawSeatBase, sehingga rekaman drawSeatBase (bila terpanggil)
    // tidak membawa seat existing. Direkam via mock modul pada seam produksi.
    const m = await mountEditor(1000, 600);
    try {
      expect(m.canvasMounted).toBe(true);
      // Bila base Canvas ikut menggambar, rekaman akan menunjukkan n>0.
      // Implementasi benar: tidak ada panggilan base dengan n>0 pada mode ini.
      const nonEmpty = recordedBaseCalls.filter((c) => c.n > 0);
      expect(nonEmpty).toEqual([]);
    } finally { m.cleanup(); }
  });

  it('transisi 500 → 501 → 500 mengubah mount canvas tanpa error', async () => {
    const first = await mountEditor(1000, 500);
    try {
      expect(first.canvasMounted).toBe(false);
    } finally { first.cleanup(); }
    const second = await mountEditor(1000, 501);
    try {
      expect(second.canvasMounted).toBe(true);
    } finally { second.cleanup(); }
    const third = await mountEditor(1000, 500);
    try {
      expect(third.canvasMounted).toBe(false);
    } finally { third.cleanup(); }
  });

  it('status campuran mempertahankan tampilan (fill invalid + redup taken/book)', async () => {
    // SVG: 100 seat campuran -> invalid merah (#dc2626), taken/book opacity 0.45.
    const m = await mountEditor(100, 10);
    try {
      const dots = [...m.host.querySelectorAll('[data-seat-id]')] as unknown as SVGCircleElement[];
      expect(dots.length).toBe(100);
      const fills = dots.map((d) => d.getAttribute('fill'));
      const opacities = dots.map((d) => d.getAttribute('opacity'));
      // 10% invalid (i%10==9) -> merah.
      expect(fills.filter((f) => f === '#dc2626').length).toBe(10);
      // taken (i%10==7) + book (i%10==8) = 20% redup, invalid tidak dihitung
      // redup walau statusnya available (cabang !invalid && (taken||book)).
      expect(opacities.filter((o) => o === '0.45').length).toBe(20);
      expect(opacities.filter((o) => o === '0.9').length).toBe(80);
    } finally { m.cleanup(); }
  });
});

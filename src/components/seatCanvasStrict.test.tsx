// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SeatCanvas, { type SeatCanvasHandle } from './SeatCanvas';
import { createRef } from 'react';

// Regresi P2 #1: CANVAS TIDAK MENGGAMBAR PADA DEVELOPMENT STRICTMODE.
// Cleanup harus mengembalikan rafRef ke 0 agar replay effect dapat menjadwalkan
// ulang redraw. Scheduler uji benar-benar menghapus callback saat cancel.

function mockCtx(calls: string[]): CanvasRenderingContext2D {
  return {
    clearRect: () => { calls.push('clear'); },
    save: () => {}, restore: () => {}, setTransform: () => {},
    fill: () => { calls.push('fill'); }, beginPath: () => {}, moveTo: () => {},
    arc: () => {}, rect: () => {}, drawImage: () => { calls.push('blit'); },
    fillStyle: '', globalAlpha: 1, lineWidth: 0,
    canvas: { width: 10, height: 10 },
  } as unknown as CanvasRenderingContext2D;
}

function setupDom() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Scheduler terkontrol yang BENAR-BENAR menghapus callback saat cancel
  // (meniru browser; bug lama memakai cancel no-op sehingga antrean basi).
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    nextId += 1;
    queue.set(nextId, cb);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  const calls: string[] = [];
  const ctx = mockCtx(calls);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 140 } as DOMRect);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: unknown[]) => {
    if (tag === 'canvas') {
      const c = origCreate(tag) as HTMLCanvasElement;
      vi.spyOn(c, 'getContext').mockReturnValue(mockCtx([]));
      return c;
    }
    return (origCreate as unknown as (...a: unknown[]) => HTMLElement)(tag, ...rest);
  }) as typeof document.createElement);
  const flush = (t = 16) => { const cbs = [...queue.values()]; queue.clear(); act(() => { for (const cb of cbs) cb(t); }); };
  return { queue, flush, calls };
}

describe('SeatCanvas StrictMode replay (P2 #1)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('mount StrictMode: setelah replay + flush, base digambar; imperative ref menjadwalkan ulang', async () => {
    const { queue, flush } = setupDom();
    const builtBase: unknown[] = [];
    const ref = createRef<SeatCanvasHandle>();
    const host = document.createElement('div'); document.body.append(host);
    host.style.width = '200px'; host.style.height = '140px';
    const root = createRoot(host);
    const vb = { x: 0, y: 0, w: 100, h: 70 };
    await act(async () => {
      root.render(
        <StrictMode>
          <SeatCanvas ref={ref} vb={vb} baseRev={1} overlayRev="o1"
            buildBase={(out) => { builtBase.push(1); out.length = 0; }}
            buildOverlay={(out) => { out.length = 0; }} simpleDots={false} label="strict" />
        </StrictMode>,
      );
    });
    // StrictMode: setup → cleanup → setup. Scheduler benar menghapus callback
    // batal, sehingga maksimal 1 frame pending yang valid.
    expect(queue.size).toBeLessThanOrEqual(1);
    flush();
    // Tanpa perbaikan (rafRef tak di-reset), replay effect ditolak scheduler
    // dan antrean kosong -> base tak pernah dibangun.
    expect(builtBase).toEqual([1]);

    // Hover/seleksi berikutnya menggambar overlay tanpa membangun ulang base.
    const overlayDrawn: string[] = [];
    await act(async () => {
      root.render(
        <StrictMode>
          <SeatCanvas ref={ref} vb={vb} baseRev={1} overlayRev="o2"
            buildBase={(out) => { builtBase.push(1); out.length = 0; }}
            buildOverlay={(out) => { out.length = 0; overlayDrawn.push('overlay'); }} simpleDots={false} label="strict" />
        </StrictMode>,
      );
    });
    flush();
    expect(builtBase.length).toBe(1);
    expect(overlayDrawn.length).toBeGreaterThan(0);

    // requestRedraw via imperative ref harus menjadwalkan frame baru.
    queue.clear();
    act(() => { ref.current?.requestRedraw(); });
    expect(queue.size).toBe(1);

    act(() => root.unmount());
    host.remove();
  });

  it('revisi terbaru saat hover pending tetap digambar (bukan revisi basi)', async () => {
    const { flush } = setupDom();
    const built: unknown[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const vb = { x: 0, y: 0, w: 100, h: 100 };
    const renderRev = async (baseRev: unknown, overlayRev: unknown) => {
      await act(async () => {
        root.render(
          <StrictMode>
            <SeatCanvas vb={vb} baseRev={baseRev} overlayRev={overlayRev}
              buildBase={(out) => { built.push(baseRev); out.length = 0; }}
              buildOverlay={(out) => { out.length = 0; }} simpleDots={false} label="rev" />
          </StrictMode>,
        );
      });
    };
    await renderRev(1, 'o1');
    flush();
    expect(built).toEqual([1]);
    // Hover pending (overlay saja) tanpa flush, lalu revisi baru masuk.
    await renderRev(1, 'o2-pending');
    await renderRev(2, 'o2-pending');
    flush();
    expect(built).toEqual([1, 2]);
    act(() => root.unmount());
    host.remove();
  });

  it('unmount dengan frame pending: callback dibatalkan dan tidak menggambar; mount ulang bersih', async () => {
    const { queue, flush } = setupDom();
    const built: unknown[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const vb = { x: 0, y: 0, w: 10, h: 10 };
    await act(async () => {
      root.render(
        <StrictMode>
          <SeatCanvas vb={vb} baseRev={9} overlayRev={1}
            buildBase={(out) => { built.push(9); out.length = 0; }}
            buildOverlay={(out) => { out.length = 0; }} simpleDots={false} label="u" />
        </StrictMode>,
      );
    });
    // Jangan flush: frame masih pending, lalu unmount.
    const pendingBefore = queue.size;
    expect(pendingBefore).toBeLessThanOrEqual(1);
    const nBefore = built.length;
    act(() => root.unmount());
    expect(queue.size).toBe(0);
    flush();
    expect(built.length).toBe(nBefore);
    // Mount ulang harus menggambar lagi dari nol.
    const root2 = createRoot(host);
    await act(async () => {
      root2.render(
        <StrictMode>
          <SeatCanvas vb={vb} baseRev={9} overlayRev={1}
            buildBase={(out) => { built.push(9); out.length = 0; }}
            buildOverlay={(out) => { out.length = 0; }} simpleDots={false} label="u" />
        </StrictMode>,
      );
    });
    flush();
    expect(built.length).toBe(nBefore + 1);
    act(() => root2.unmount());
    host.remove();
  });
});

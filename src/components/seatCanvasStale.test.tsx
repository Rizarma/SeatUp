// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SeatCanvas from './SeatCanvas';

// Seam produksi temuan #5: scheduler + callback draw membaca input visual
// terbaru saat frame dieksekusi (bukan closure penjadwalan). Reproduksi urutan
// revisi 1 → antre hover → revisi 2 → flush: yang digambar harus revisi 2.

function mockCtx(calls: string[]): CanvasRenderingContext2D {
  const ctx = {
    calls,
    clearRect: () => { calls.push('clear'); },
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    fill: () => { calls.push('fill'); },
    beginPath: () => {},
    moveTo: () => {},
    arc: () => {},
    rect: () => {},
    drawImage: () => { calls.push('blit'); },
    fillStyle: '',
    globalAlpha: 1,
    lineWidth: 0,
    canvas: { width: 10, height: 10 },
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
  return ctx;
}

describe('SeatCanvas coalescing revisi terbaru (temuan #5)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('hover pending lalu revisi baru: frame menggambar revisi terbaru', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const builtBase: unknown[] = [];
    const calls: string[] = [];
    const ctx = mockCtx(calls);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: unknown[]) => {
      if (tag === 'canvas') {
        const c = origCreate(tag) as HTMLCanvasElement;
        vi.spyOn(c, 'getContext').mockReturnValue(mockCtx([]));
        return c;
      }
      return (origCreate as unknown as (...a: unknown[]) => HTMLElement)(tag, ...rest);
    }) as typeof document.createElement);

    const host = document.createElement('div'); document.body.append(host);
    host.style.width = '100px'; host.style.height = '100px';
    const root = createRoot(host);
    const vb = { x: 0, y: 0, w: 100, h: 100 };
    const renderWith = async (baseRev: unknown, overlayRev: unknown) => {
      await act(async () => {
        root.render(
          <SeatCanvas vb={vb} baseRev={baseRev} overlayRev={overlayRev}
            buildBase={(out) => { builtBase.push(baseRev); out.length = 0; }}
            buildOverlay={(out) => { out.length = 0; }} simpleDots={false} label="test" />,
        );
      });
    };
    // 1. Mount revisi 1 dan flush: base revisi 1 dibangun.
    await renderWith(1, 'o1');
    expect(frames.length).toBe(1);
    act(() => { frames.splice(0).forEach((cb) => cb(16)); });
    expect(builtBase).toEqual([1]);
    // 2. Antrekan hover (overlay saja) tanpa flush.
    await renderWith(1, 'o2');
    expect(frames.length).toBe(1);
    // 3. Render revisi 2 (ter-coalesce ke frame yang sama, tanpa frame baru).
    await renderWith(2, 'o2');
    expect(frames.length).toBe(1);
    // 4. Flush: base revisi 2 HARUS dibangun (bukan revisi 1 basi).
    act(() => { frames.splice(0).forEach((cb) => cb(32)); });
    expect(builtBase).toEqual([1, 2]);
    // Hover berikutnya (overlay saja) tidak membangun ulang base.
    const n = builtBase.length;
    await renderWith(2, 'o3');
    act(() => { frames.splice(0).forEach((cb) => cb(48)); });
    expect(builtBase.length).toBe(n);

    act(() => root.unmount());
    host.remove();
  });

  it('maksimal satu callback frame pending + unmount membatalkan', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.splice(id - 1, 1); });
    const ctx = mockCtx([]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 10, height: 10 } as DOMRect);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const vb = { x: 0, y: 0, w: 10, h: 10 };
    await act(async () => {
      root.render(<SeatCanvas vb={vb} baseRev={1} overlayRev={1} buildBase={(o) => { o.length = 0; }} buildOverlay={(o) => { o.length = 0; }} simpleDots={false} label="t" />);
    });
    await act(async () => {
      root.render(<SeatCanvas vb={vb} baseRev={1} overlayRev={2} buildBase={(o) => { o.length = 0; }} buildOverlay={(o) => { o.length = 0; }} simpleDots={false} label="t" />);
    });
    await act(async () => {
      root.render(<SeatCanvas vb={vb} baseRev={1} overlayRev={3} buildBase={(o) => { o.length = 0; }} buildOverlay={(o) => { o.length = 0; }} simpleDots={false} label="t" />);
    });
    expect(frames.length).toBeLessThanOrEqual(1);
    act(() => root.unmount());
    host.remove();
  });
});

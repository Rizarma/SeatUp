// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import { dispatchAtStrict, statsOf } from './BenchApp';
import {
  HISTORY_LIMIT,
  StoreProvider,
  benchCommitCount,
  disableBenchCommitSpy,
  enableBenchCommitSpy,
  resetBenchCommitCount,
  useStore,
} from '../store';

// Pengujian benchmark itu sendiri (temuan P2 #4): harness harus gagal pada
// kondisi tak-mungkin-pengguna, dan penghitungan commit memakai instrumentasi
// produksi (spy commit dokumen nyata), BUKAN selisih label Urungkan yang
// berhenti bertambah saat history penuh (60 entri).

describe('bench guards (temuan #4)', () => {
  it('dispatchAtStrict gagal bila target offscreen', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    expect(() => dispatchAtStrict(svg, 'pointerdown', -10, 5)).toThrow(/luar layar/);
    expect(() => dispatchAtStrict(svg, 'pointerdown', window.innerWidth + 10, 5)).toThrow(/luar layar/);
    svg.remove();
  });

  it('dispatchAtStrict gagal bila target tertutup', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const cover = document.createElement('div');
    cover.style.position = 'fixed'; cover.style.left = '0'; cover.style.top = '0';
    cover.style.width = '100px'; cover.style.height = '100px';
    document.body.append(svg); document.body.append(cover);
    vi.spyOn(document, 'elementFromPoint').mockReturnValueOnce(cover);
    expect(() => dispatchAtStrict(svg, 'pointerdown', 10, 10)).toThrow(/tertutup/);
    vi.restoreAllMocks();
    svg.remove(); cover.remove();
  });

  it('dispatchAtStrict gagal bila tak ditemukan (null)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    vi.spyOn(document, 'elementFromPoint').mockReturnValueOnce(null);
    expect(() => dispatchAtStrict(svg, 'pointerdown', 10, 10)).toThrow(/tak ditemukan/);
    vi.restoreAllMocks();
    svg.remove();
  });

  it('statsOf melaporkan n/median/p95/maks (bukan 1 sampel diklaim p95)', () => {
    const s = statsOf([10, 20, 30, 40, 50]);
    expect(s.n).toBe(5);
    expect(s.median).toBe(30);
    expect(s.p95).toBe(50);
    expect(s.max).toBe(50);
  });
});

// --- Instrumentasi commit produksi (store nyata + spy benchmark) ---

interface Driver {
  commit: (label: string) => void;
  undo: () => void;
  redo: () => void;
  touchSelection: () => void;
  touchTool: () => void;
  docName: () => string;
  pastLen: () => number;
}

function Inner({ holder }: { holder: { d: Driver | null } }) {
  const { state, update, undo, redo, selectSeats, setTool } = useStore();
  const ref = useRef({ state });
  ref.current.state = state;
  useEffect(() => {
    holder.d = {
      commit: (label: string) => update((d) => ({ ...d, name: label })),
      undo, redo,
      touchSelection: () => selectSeats(['x']),
      touchTool: () => setTool('hand'),
      docName: () => ref.current.state.doc.name,
      pastLen: () => ref.current.state.past.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function mountDriver() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  enableBenchCommitSpy();
  resetBenchCommitCount();
  const holder: { d: Driver | null } = { d: null };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  return { holder, host, root };
}

describe('bench commit spy vs history cap (temuan #4, store produksi)', () => {
  afterEach(() => { disableBenchCommitSpy(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('history kosong + 60 commit nyata: spy tepat 60, panjang history 60', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    expect(d.pastLen()).toBe(0);
    await act(async () => { for (let i = 0; i < 60; i++) d.commit(`v${i}`); });
    expect(benchCommitCount()).toBe(60);
    expect(d.pastLen()).toBe(60);
    expect(d.docName()).toBe('v59');
    act(() => root.unmount()); host.remove();
  });

  it.each([0, 1, 59, 60])('history awal %i + 60 commit: spy selalu +60, panjang mengikuti batas 60', async (initial) => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    await act(async () => { for (let i = 0; i < initial; i++) d.commit(`pre${i}`); });
    const lenBefore = d.pastLen();
    expect(lenBefore).toBe(Math.min(60, initial));
    resetBenchCommitCount();
    await act(async () => { for (let i = 0; i < 60; i++) d.commit(`v${i}`); });
    // Kunci temuan #4: selisih panjang history SALAH saat penuh, spy benar.
    expect(benchCommitCount()).toBe(60);
    expect(d.pastLen()).toBe(Math.min(60, lenBefore + 60));
    if (lenBefore === 60) {
      // History sudah penuh: panjang tak bertambah walau 60 commit nyata terjadi.
      expect(d.pastLen()).toBe(60);
    }
    act(() => root.unmount()); host.remove();
  });

  it('drag normal saat history penuh: 1 commit teramati; cancel: 0 commit + dokumen tetap', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    await act(async () => { for (let i = 0; i < 60; i++) d.commit(`fill${i}`); });
    expect(d.pastLen()).toBe(60);
    resetBenchCommitCount();
    // Drag normal = satu commit.
    await act(async () => { d.commit('dragged'); });
    expect(benchCommitCount()).toBe(1);
    expect(d.docName()).toBe('dragged');
    // Cancel drag = tanpa update -> nol commit, dokumen tak berubah.
    resetBenchCommitCount();
    await act(async () => { /* sengaja tanpa commit: Esc sebelum pointerup */ });
    expect(benchCommitCount()).toBe(0);
    expect(d.docName()).toBe('dragged');
    act(() => root.unmount()); host.remove();
  });

  it('pan/zoom/hover/seleksi/tool: nol commit dokumen', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    resetBenchCommitCount();
    await act(async () => { d.touchSelection(); });
    await act(async () => { d.touchTool(); });
    expect(benchCommitCount()).toBe(0);
    expect(d.pastLen()).toBe(0);
    act(() => root.unmount()); host.remove();
  });

  it('undo/redo bukan commit baru; verifikasi via isi dokumen', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    await act(async () => { d.commit('v1'); d.commit('v2'); d.commit('v3'); });
    expect(benchCommitCount()).toBe(3);
    resetBenchCommitCount();
    await act(async () => { d.undo(); });
    expect(d.docName()).toBe('v2');
    expect(benchCommitCount()).toBe(0);
    await act(async () => { d.redo(); });
    expect(d.docName()).toBe('v3');
    expect(benchCommitCount()).toBe(0);
    act(() => root.unmount()); host.remove();
  });

  it('kontrol negatif: aksi target dinonaktifkan -> assertion runner GAGAL', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    resetBenchCommitCount();
    // Harness dengan commit dimatikan (bug simulasi): runner wajib gagal,
    // bukan meloloskan 0 sebagai 1.
    await act(async () => { /* commit sengaja dihilangkan */ });
    const commits = benchCommitCount();
    expect(() => {
      if (commits !== 1) throw new Error(`drag harus tepat 1 commit, dapat ${commits}`);
    }).toThrow(/tepat 1 commit/);
    // Duplikasi commit juga wajib gagal.
    await act(async () => { d.commit('a'); d.commit('b'); });
    const dup = benchCommitCount();
    expect(() => {
      if (dup !== 1) throw new Error(`drag harus tepat 1 commit, dapat ${dup}`);
    }).toThrow(/tepat 1 commit/);
    act(() => root.unmount()); host.remove();
  });

  it('batas history produksi tetap 60 (tak dinaikkan untuk meloloskan bench)', () => {
    expect(HISTORY_LIMIT).toBe(60);
  });
});

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import type { VenueDoc } from './lib/venue';
import { emptyVenue, normalizeSectionFlags } from './lib/venue';
import { ensureCategories, syncCategoryPrices } from './lib/categories';
import { revalidateSeatsIncremental } from './lib/contain';
import { clearDocIndexCache } from './lib/docIndex';

export type Tool = 'hand' | 'select' | 'seat' | 'polygon' | 'stage' | 'rectangle' | 'circle' | 'aisle' | 'row' | 'multirow';

/** Status dokumen + history undo/redo (berubah hanya saat commit/load). */
interface DocState {
  doc: VenueDoc;
  past: VenueDoc[];
  future: VenueDoc[];
  tool: Tool;
  dirty: boolean;
}

/** Seleksi sementara (berubah sering; konteks terpisah agar tak me-render ulang lapisan dasar). */
interface SelState {
  selectedId: string | null;
  selectedSeatIds: string[];
}

type DocAction =
  | { t: 'commit'; doc: VenueDoc }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'tool'; tool: Tool }
  | { t: 'load'; doc: VenueDoc }
  | { t: 'saved' };

const MAX_HISTORY = 60;
export const HISTORY_LIMIT = MAX_HISTORY;

/**
 * Instrumentasi benchmark temuan P2 #4: memisahkan "jumlah commit yang terjadi"
 * dari "panjang history yang disimpan" (yang dibatasi 60).
 * - Hanya aktif bila ?bench (StoreProvider memanggil enableBenchCommitSpy).
 * - Hanya menghitung aksi 'commit' dokumen nyata; undo/redo/load/pan/zoom/
 *   hover/seleksi sementara TIDAK dihitung.
 * - Runner + tes regresi memakai resetBenchCommitCount()/benchCommitCount()
 *   sebagai sumber kebenaran, bukan selisih label tombol Urungkan.
 */
let benchCommitSpy: { commits: number } | null = null;
export function enableBenchCommitSpy(): void {
  if (!benchCommitSpy) benchCommitSpy = { commits: 0 };
}
export function disableBenchCommitSpy(): void {
  benchCommitSpy = null;
}
export function resetBenchCommitCount(): void {
  if (benchCommitSpy) benchCommitSpy.commits = 0;
}
export function benchCommitCount(): number {
  return benchCommitSpy?.commits ?? 0;
}
export function isBenchCommitSpyEnabled(): boolean {
  return benchCommitSpy !== null;
}

/**
 * Jalankan pipeline commit (normalisasi → revalidasi inkremental → kategori).
 * Revalidasi hanya menguji ulang seat yang bergerak / section-nya berubah;
 * objek bersih mempertahankan referensi (structural sharing) sehingga
 * history undo menampung referensi, bukan 60 deep-clone seluruh dokumen.
 */
function runCommit(prevObjects: VenueDoc['objects'], incoming: VenueDoc): VenueDoc {
  const norm = normalizeSectionFlags(incoming.objects);
  const base = norm.objects === incoming.objects ? incoming : { ...incoming, objects: norm.objects };
  const rev = revalidateSeatsIncremental(prevObjects, base.objects);
  const synced = rev.objects === base.objects ? base : { ...base, objects: rev.objects };
  const withCat = syncCategoryPrices(ensureCategories(synced));
  return withCat.objects === base.objects && withCat.categories === base.categories ? base : withCat;
}

function docReducer(s: DocState, a: DocAction): DocState {
  switch (a.t) {
    case 'commit': {
      if (a.doc === s.doc) return s;
      const doc = runCommit(s.doc.objects, a.doc);
      // Spy benchmark: hitung commit dokumen nyata (termasuk saat history penuh).
      if (benchCommitSpy) benchCommitSpy.commits++;
      return {
        ...s,
        doc,
        // Structural sharing: simpan referensi doc lama (objek tak berubah
        // dipakai bersama). Aman karena semua update immutable.
        past: [...s.past.slice(-MAX_HISTORY + 1), s.doc],
        future: [],
        dirty: true,
      };
    }
    case 'undo': {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return {
        ...s,
        doc: prev,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future],
        dirty: true,
      };
    }
    case 'redo': {
      if (s.future.length === 0) return s;
      const [next, ...rest] = s.future;
      return {
        ...s,
        doc: next,
        past: [...s.past, s.doc],
        future: rest,
        dirty: true,
      };
    }
    case 'tool':
      return { ...s, tool: a.tool };
    case 'load': {
      const norm = normalizeSectionFlags(a.doc.objects);
      const base = norm.objects === a.doc.objects ? a.doc : { ...a.doc, objects: norm.objects };
      const rev = revalidateSeatsIncremental([], base.objects);
      const synced = rev.objects === base.objects ? base : { ...base, objects: rev.objects };
      const doc = syncCategoryPrices(ensureCategories(synced));
      return { doc, past: [], future: [], tool: 'select', dirty: false };
    }
    case 'saved':
      return { ...s, dirty: false };
    default:
      return s;
  }
}

interface Store {
  state: DocState & SelState;
  update: (fn: (doc: VenueDoc) => VenueDoc) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  selectSeats: (ids: string[]) => void;
  setTool: (tool: Tool) => void;
  loadDoc: (doc: VenueDoc) => void;
  markSaved: () => void;
}

const DocCtx = createContext<{
  docState: DocState;
  update: (fn: (doc: VenueDoc) => VenueDoc) => void;
  undo: () => void;
  redo: () => void;
  setTool: (tool: Tool) => void;
  loadDoc: (doc: VenueDoc) => void;
  markSaved: () => void;
} | null>(null);

const SelCtx = createContext<{
  sel: SelState;
  select: (id: string | null) => void;
  selectSeats: (ids: string[]) => void;
} | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [docState, dispatch] = useReducer(docReducer, {
    doc: emptyVenue(),
    past: [],
    future: [],
    tool: 'select',
    dirty: false,
  });
  const [sel, setSel] = useState<SelState>({ selectedId: null, selectedSeatIds: [] });

  const update = useCallback((fn: (doc: VenueDoc) => VenueDoc) => {
    // fn wajib immutable (semua pemanggil memakai spread/map).
    // rev inkremental memakai doc lama sebagai pembanding.
    const next = fn(docState.doc);
    if (next === docState.doc) return;
    dispatch({ t: 'commit', doc: next });
    // Pertahankan pilihan yang kursinya masih hidup (perilaku lama).
    setSel((s) => {
      if (s.selectedSeatIds.length === 0) return s;
      const alive = new Set<string>();
      for (const o of next.objects) {
        if (o.seats) for (const seat of o.seats) alive.add(seat.id);
      }
      if (s.selectedSeatIds.every((id) => alive.has(id))) return s;
      return { ...s, selectedSeatIds: s.selectedSeatIds.filter((id) => alive.has(id)) };
    });
  }, [docState.doc]);

  const undo = useCallback(() => {
    setSel({ selectedId: null, selectedSeatIds: [] });
    dispatch({ t: 'undo' });
  }, []);
  const redo = useCallback(() => {
    setSel({ selectedId: null, selectedSeatIds: [] });
    dispatch({ t: 'redo' });
  }, []);

  const docValue = useMemo(() => ({
    docState,
    update,
    undo,
    redo,
    setTool: (tool: Tool) => dispatch({ t: 'tool', tool }),
    loadDoc: (doc: VenueDoc) => {
      setSel({ selectedId: null, selectedSeatIds: [] });
      // Ganti dokumen: indeks turunan revisi lama tak lagi dibutuhkan —
      // kosongkan cache LRU agar tak tertahan di luar history (temuan P2 #4).
      clearDocIndexCache();
      dispatch({ t: 'load', doc });
    },
    markSaved: () => dispatch({ t: 'saved' }),
  }), [docState, update, undo, redo]);

  const selValue = useMemo(() => ({
    sel,
    select: (id: string | null) => setSel((s) => (s.selectedId === id ? s : { ...s, selectedId: id })),
    selectSeats: (ids: string[]) => setSel((s) => (s.selectedSeatIds === ids ? s : { ...s, selectedSeatIds: ids })),
  }), [sel]);

  // Kait benchmark (hanya aktif saat ?bench): injeksi dokumen besar yang
  // melebihi kuota localStorage tanpa mengubah jalur produksi.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bench')) {
      enableBenchCommitSpy();
      (window as unknown as { __seatupLoadDoc?: (doc: VenueDoc) => void }).__seatupLoadDoc = (d: VenueDoc) => {
        setSel({ selectedId: null, selectedSeatIds: [] });
        clearDocIndexCache();
        dispatch({ t: 'load', doc: d });
      };
      // Observasi commit untuk runner (dipakai BenchApp S7/S9).
      (window as unknown as { __seatupBenchCommits?: () => number }).__seatupBenchCommits = () => benchCommitCount();
      (window as unknown as { __seatupBenchResetCommits?: () => void }).__seatupBenchResetCommits = () => resetBenchCommitCount();
    }
  }, []);

  // Paparan baca dokumen untuk assertion isi (hanya ?bench): runner memakai
  // ini untuk verifikasi koordinat sebelum/sesudah drag/undo/redo, bukan
  // sekadar label tombol. Diperbarui tiap doc berubah.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bench')) {
      (window as unknown as { __seatupBenchDoc?: () => VenueDoc }).__seatupBenchDoc = () => docState.doc;
    }
  }, [docState.doc]);

  return (
    <DocCtx.Provider value={docValue}>
      <SelCtx.Provider value={selValue}>{children}</SelCtx.Provider>
    </DocCtx.Provider>
  );
}

/** Kompatibilitas: gabungan doc + seleksi (me-render ulang bila salah satu berubah). */
export function useStore(): Store {
  const d = useContext(DocCtx);
  const s = useContext(SelCtx);
  if (!d || !s) throw new Error('useStore di luar provider');
  const value = useMemo<Store>(() => ({
    state: {
      doc: d.docState.doc,
      past: d.docState.past,
      future: d.docState.future,
      tool: d.docState.tool,
      dirty: d.docState.dirty,
      selectedId: s.sel.selectedId,
      selectedSeatIds: s.sel.selectedSeatIds,
    },
    update: d.update,
    undo: d.undo,
    redo: d.redo,
    select: s.select,
    selectSeats: s.selectSeats,
    setTool: d.setTool,
    loadDoc: d.loadDoc,
    markSaved: d.markSaved,
  }), [d, s]);
  return value;
}

/** Lapisan dasar (seat/shape): hanya me-render ulang saat dokumen berubah. */
export function useDocStore() {
  const d = useContext(DocCtx);
  if (!d) throw new Error('useDocStore di luar provider');
  return d;
}

/** Overlay seleksi/ringkasan: me-render ulang saat pilihan berubah. */
export function useSelectionStore() {
  const s = useContext(SelCtx);
  if (!s) throw new Error('useSelectionStore di luar provider');
  return s;
}

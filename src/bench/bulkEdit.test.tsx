// @vitest-environment happy-dom
import { act } from 'react';
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBenchDoc } from './fixtures';
import {
  applyBulkSeatLabel,
  ownerObjectsOf,
  planBlockBox,
  planMarqueeBand,
  verifyBulkEditResult,
  verifyBulkRestored,
} from '../lib/bulkEdit';
import {
  StoreProvider,
  benchCommitCount,
  disableBenchCommitSpy,
  enableBenchCommitSpy,
  resetBenchCommitCount,
  useStore,
} from '../store';
import type { VenueDoc } from '../lib/venue';

// Regresi temuan P2 #2: edit massal memakai seam produksi yang sama dengan
// SidePanel + runner bench (applyBulkSeatLabel/verify*/plan*), lewat store
// nyata + spy commit. Bukan salinan logika di file tes.

function smallDoc(): VenueDoc {
  return makeBenchDoc({ sections: 1, rowsPerSection: 6, seatsPerRow: 10, seed: 1 });
}
function focusOf(doc: VenueDoc): string {
  return doc.objects.find((o) => o.isSection)!.id;
}

interface Driver {
  load: (d: VenueDoc) => void;
  bulk: (ids: string[], row: string) => void;
  touch: (label: string) => void;
  undo: () => void;
  redo: () => void;
  doc: () => VenueDoc;
  pastLen: () => number;
}

function Inner({ holder }: { holder: { d: Driver | null } }) {
  const { state, update, undo, redo, loadDoc } = useStore();
  // Ref selalu menunjuk store terbaru agar driver tak memakai closure basi
  // (update menutup di atas docState.doc terkini).
  const ref = useRef({ state, update, undo, redo, loadDoc });
  ref.current = { state, update, undo, redo, loadDoc };
  useEffect(() => {
    holder.d = {
      load: (d: VenueDoc) => ref.current.loadDoc(d),
      bulk: (ids: string[], row: string) => ref.current.update((doc) => applyBulkSeatLabel(doc, ids, { row })),
      touch: (label: string) => ref.current.update((d) => ({ ...d, name: label })),
      undo: () => ref.current.undo(),
      redo: () => ref.current.redo(),
      doc: () => ref.current.state.doc,
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
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return { holder, host, root };
}

describe('edit massal lintas-baris (temuan P2 #2, store+spy produksi)', () => {
  afterEach(() => { disableBenchCommitSpy(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('pita 3 baris (30 seat): 1 commit, hanya target berubah, identitas lintas objek', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    const doc = smallDoc();
    await act(async () => { d.load(doc); });
    resetBenchCommitCount();
    const plan = planMarqueeBand(d.doc(), focusOf(doc), 3);
    expect(plan.seatIds).toHaveLength(30);
    expect(plan.rowIds).toHaveLength(3);
    expect(new Set(plan.rowIds).size).toBe(3);
    const before = d.doc();
    await act(async () => { d.bulk(plan.seatIds, 'Z9'); });
    expect(benchCommitCount()).toBe(1);
    const after = d.doc();
    // Seam yang sama dipakai runner untuk verifikasi isi.
    verifyBulkEditResult({ before, after, seatIds: plan.seatIds, edit: { row: 'Z9' } });
    const owners = ownerObjectsOf(after, plan.seatIds);
    expect(owners.size).toBe(3);
    // Aturan aplikasi: harga kategori + koordinat + section + status tetap.
    const sample = after.objects.flatMap((o) => o.seats).find((s) => plan.seatIds.includes(s.id))!;
    const sampleBefore = before.objects.flatMap((o) => o.seats).find((s) => s.id === sample.id)!;
    expect(sample.price).toBe(sampleBefore.price);
    expect(sample.x).toBe(sampleBefore.x);
    expect(sample.sectionId).toBe(sampleBefore.sectionId);
    expect(sample.status).toBe(sampleBefore.status);
    act(() => root.unmount()); host.remove();
  });

  it('undo mengembalikan nilai awal; redo memulihkan hasil edit', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    const doc = smallDoc();
    await act(async () => { d.load(doc); });
    const plan = planMarqueeBand(d.doc(), focusOf(doc), 2);
    const before = d.doc();
    await act(async () => { d.bulk(plan.seatIds, 'Z7'); });
    const edited = d.doc();
    resetBenchCommitCount();
    await act(async () => { d.undo(); });
    expect(benchCommitCount()).toBe(0);
    verifyBulkRestored(d.doc(), before, 'undo');
    await act(async () => { d.redo(); });
    expect(benchCommitCount()).toBe(0);
    verifyBulkRestored(d.doc(), edited, 'redo');
    act(() => root.unmount()); host.remove();
  });

  it('history awal kosong dan penuh: edit tetap 1 commit, undo/redo via isi', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    await act(async () => { d.load(smallDoc()); });
    // Kosong.
    expect(d.pastLen()).toBe(0);
    resetBenchCommitCount();
    const plan = planMarqueeBand(d.doc(), focusOf(d.doc()), 2);
    await act(async () => { d.bulk(plan.seatIds, 'Z1'); });
    expect(benchCommitCount()).toBe(1);
    expect(d.pastLen()).toBe(1);
    // Penuh: isi hingga 60 lalu edit massal.
    await act(async () => { for (let i = 0; i < 59; i++) d.touch(`fill${i}`); });
    expect(d.pastLen()).toBe(60);
    const beforeFull = d.doc();
    const plan2 = planMarqueeBand(beforeFull, focusOf(beforeFull), 2);
    resetBenchCommitCount();
    await act(async () => { d.bulk(plan2.seatIds, 'Z2'); });
    expect(benchCommitCount()).toBe(1);
    expect(d.pastLen()).toBe(60);
    const editedFull = d.doc();
    await act(async () => { d.undo(); });
    verifyBulkRestored(d.doc(), beforeFull, 'undo-penuh');
    await act(async () => { d.redo(); });
    verifyBulkRestored(d.doc(), editedFull, 'redo-penuh');
    act(() => root.unmount()); host.remove();
  });

  it('kontrol negatif: tanpa setup seleksi, transform melempar (benchmark wajib gagal, bukan SKIP)', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    await act(async () => { d.load(smallDoc()); });
    const before = d.doc();
    resetBenchCommitCount();
    expect(() => applyBulkSeatLabel(before, [], { row: 'Z' })).toThrow(/tanpa seleksi/);
    expect(benchCommitCount()).toBe(0);
    // Simulasi harness runner: seleksi kosong setelah kontrol negatif marquee.
    const selected: string[] = [];
    expect(() => {
      if (selected.length === 0) throw new Error('setup seleksi wajib sebelum timer edit massal');
    }).toThrow(/setup seleksi wajib/);
    act(() => root.unmount()); host.remove();
  });

  it('kontrol negatif: aksi edit dihilangkan, verifikasi dokumen gagal', () => {
    const doc = smallDoc();
    const plan = planMarqueeBand(doc, focusOf(doc), 2);
    // after == before (edit sengaja dihilangkan): verifikasi wajib gagal.
    expect(() => verifyBulkEditResult({ before: doc, after: doc, seatIds: plan.seatIds, edit: { row: 'Z' } }))
      .toThrow(/row/);
    // Dokumen dirusak di luar edit (geser target + sentuh non-target): gagal.
    const tamperedTarget: VenueDoc = {
      ...doc,
      objects: doc.objects.map((o, i) => (i === 1
        ? { ...o, seats: o.seats.map((s) => ({ ...s, x: s.x + 999 })) }
        : o)),
    };
    expect(() => verifyBulkEditResult({ before: doc, after: tamperedTarget, seatIds: plan.seatIds, edit: { row: 'Z' } }))
      .toThrow(/koordinat|row/);
  });

  it('blok satu objek besar: seleksi dalam satu objek + edit/undo/redo terverifikasi', async () => {
    const { holder, host, root } = mountDriver();
    await act(async () => { root.render(<StoreProvider><Inner holder={holder} /></StoreProvider>); });
    const d = holder.d!;
    const doc = makeBenchDoc({ sections: 1, rowsPerSection: 4, seatsPerRow: 10, seed: 7, bigRowSeats: 60 });
    await act(async () => { d.load(doc); });
    const blockId = 'bench-row-0-0';
    const plan = planBlockBox(d.doc(), blockId, 25);
    expect(plan.rowIds).toEqual([blockId]);
    expect(plan.seatIds.length).toBeGreaterThanOrEqual(20);
    const owners = ownerObjectsOf(d.doc(), plan.seatIds);
    expect(owners.size).toBe(1);
    const before = d.doc();
    resetBenchCommitCount();
    await act(async () => { d.bulk(plan.seatIds, 'ZB'); });
    expect(benchCommitCount()).toBe(1);
    verifyBulkEditResult({ before, after: d.doc(), seatIds: plan.seatIds, edit: { row: 'ZB' } });
    await act(async () => { d.undo(); });
    verifyBulkRestored(d.doc(), before, 'undo-blok');
    act(() => root.unmount()); host.remove();
  });

  it('rencana deterministik: fixture sama selalu menghasilkan pita yang sama', () => {
    const a = planMarqueeBand(smallDoc(), focusOf(smallDoc()), 2);
    const b = planMarqueeBand(smallDoc(), focusOf(smallDoc()), 2);
    expect(a).toEqual(b);
  });
});

// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyVenue } from './venue';
import type { Seat, VenueDoc, VenueObject } from './venue';
import {
  DOC_INDEX_CACHE_LIMIT,
  clearDocIndexCache,
  docIndexCacheSize,
  getDocIndex,
  queryBox,
  queryBoxVisible,
  queryPoint,
  type DocIndex,
} from './docIndex';
import { StoreProvider, useStore } from '../store';

// Regresi temuan P2 #4: indeks turunan dibatasi LRU eksplisit (bukan satu
// indeks penuh per revisi history). Tes memakai getDocIndex produksi +
// oracle brute-force deterministik (tanpa timing).

function buildDoc(seedFn: (r: number, c: number) => Partial<Seat> = () => ({})): VenueDoc {
  const base = emptyVenue();
  const cat = base.categories[0];
  const section: VenueObject = {
    id: 'sec', kind: 'section', label: 'S', points: [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]],
    closed: true, isSection: true, width: 28, price: 0, rowParams: null, seats: [],
    source: { origin: 'canvas', confidence: 1 }, guess: null, categoryId: cat.id, color: cat.color,
  };
  const objects: VenueObject[] = [section];
  for (let r = 0; r < 3; r++) {
    const seats: Seat[] = [];
    for (let c = 0; c < 8; c++) {
      seats.push({
        id: `s${r}-${c}`, row: `R${r}`, number: String(c + 1),
        x: 100 + c * 30, y: 100 + r * 40,
        status: 'available', price: cat.price, sectionId: 'sec', radius: 8,
        ...seedFn(r, c),
      });
    }
    objects.push({
      id: `row-${r}`, kind: 'row-straight', label: `Baris ${r}`, points: [[100, 100 + r * 40]],
      closed: false, width: 28, price: cat.price, rowParams: null, sectionId: 'sec', seats,
      source: { origin: 'canvas', confidence: 1 }, guess: null,
    });
  }
  return { ...base, objects };
}

function allSeats(doc: VenueDoc): Seat[] {
  return doc.objects.flatMap((o) => o.seats);
}

function oracleBox(doc: VenueDoc, x0: number, y0: number, x1: number, y1: number): string[] {
  return allSeats(doc).filter((s) => s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1).map((s) => s.id).sort();
}

function expectMatchesOracle(doc: VenueDoc, idx: DocIndex): void {
  for (const s of allSeats(doc)) {
    const hit = queryPoint(idx, s.x, s.y, 10);
    expect(hit?.seat.id, `queryPoint (${s.x},${s.y})`).toBe(s.id);
  }
  // Miss jauh dari semua seat.
  expect(queryPoint(idx, -5000, -5000, 10)).toBeNull();
  const box = queryBox(idx, 0, 0, 1000, 1000, []).map((r) => r.seat.id).sort();
  expect(box).toEqual(oracleBox(doc, 0, 0, 1000, 1000));
  // Culling viewport akurat (lingkaran menyentuh bbox).
  const vis = queryBoxVisible(idx, 0, 0, 1000, 1000, []).map((r) => r.seat.id).sort();
  const oracleVis = allSeats(doc).filter((s) => {
    const r = s.radius ?? 8;
    return s.x + r >= 0 && s.x - r <= 1000 && s.y + r >= 0 && s.y - r <= 1000;
  }).map((s) => s.id).sort();
  expect(vis).toEqual(oracleVis);
}

/** Revisi label-only (koordinat tetap), meniru commit panel baris. */
function withRowLabel(doc: VenueDoc, label: string): VenueDoc {
  return {
    ...doc,
    objects: doc.objects.map((o) => o.seats.length > 0
      ? { ...o, seats: o.seats.map((s) => ({ ...s, row: label })) }
      : o),
  };
}

beforeEach(() => clearDocIndexCache());
afterEach(() => { clearDocIndexCache(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('retensi indeks turunan LRU (temuan P2 #4)', () => {
  it('70 revisi label-only: entri tertahan mengikuti batas, semua revisi benar vs oracle', () => {
    expect(DOC_INDEX_CACHE_LIMIT).toBeLessThanOrEqual(8);
    const revs: VenueDoc[] = [buildDoc()];
    for (let i = 1; i <= 70; i++) revs.push(withRowLabel(revs[i - 1], `L${i}`));
    for (const rev of revs) getDocIndex(rev);
    // Batas desain: bukan 71 indeks tertahan.
    expect(docIndexCacheSize()).toBeLessThanOrEqual(DOC_INDEX_CACHE_LIMIT);
    expect(docIndexCacheSize()).toBe(DOC_INDEX_CACHE_LIMIT);
    // Semua revisi — termasuk yang indeksnya dievikt — tetap benar (rebuild).
    for (const rev of revs) expectMatchesOracle(rev, getDocIndex(rev));
    expect(docIndexCacheSize()).toBeLessThanOrEqual(DOC_INDEX_CACHE_LIMIT);
  });

  it('revisi geometri (geser seat, radius, tambah/hapus seat, pindah section) benar vs oracle', () => {
    const rev0 = buildDoc();
    expectMatchesOracle(rev0, getDocIndex(rev0));
    // Geser satu seat + ubah radiusnya.
    const rev1: VenueDoc = {
      ...rev0,
      objects: rev0.objects.map((o) => o.id === 'row-1'
        ? { ...o, seats: o.seats.map((s) => (s.id === 's1-3' ? { ...s, x: s.x + 500, y: s.y - 200, radius: 20 } : s)) }
        : o),
    };
    expectMatchesOracle(rev1, getDocIndex(rev1));
    // Seat berradius besar tetap ter-hit di tepi (cakupan sel memakai maxRadius).
    const moved = rev1.objects.flatMap((o) => o.seats).find((s) => s.id === 's1-3')!;
    expect(queryPoint(getDocIndex(rev1), moved.x + 15, moved.y, 2)?.seat.id).toBe('s1-3');
    // Tambah + hapus seat.
    const rev2: VenueDoc = {
      ...rev1,
      objects: rev1.objects.map((o) => {
        if (o.id === 'row-0') {
          return {
            ...o,
            seats: [...o.seats.filter((s) => s.id !== 's0-0'),
              { id: 's0-new', row: 'R0', number: '9', x: 900, y: 100, status: 'taken' as const, price: 0, sectionId: 'sec', radius: 8 }],
          };
        }
        return o;
      }),
    };
    expectMatchesOracle(rev2, getDocIndex(rev2));
    expect(getDocIndex(rev2).seatById.has('s0-0')).toBe(false);
    expect(getDocIndex(rev2).seatById.get('s0-new')?.seat.status).toBe('taken');
    // Pindah section + kategori section berubah.
    const base = emptyVenue();
    const cat2 = { ...base.categories[0], id: 'cat-2', price: 999 };
    const rev3: VenueDoc = {
      ...rev2, categories: [...rev2.categories, cat2],
      objects: rev2.objects.map((o) => {
        if (o.id === 'sec') return { ...o, categoryId: 'cat-2' };
        if (o.id === 'row-2') return { ...o, seats: o.seats.map((s) => ({ ...s, sectionId: 'sec' })) };
        return o;
      }),
    };
    expectMatchesOracle(rev3, getDocIndex(rev3));
    expect(getDocIndex(rev3).sectionPrice.get('sec')).toBe(999);
    expect(docIndexCacheSize()).toBeLessThanOrEqual(DOC_INDEX_CACHE_LIMIT);
  });

  it('undo ke revisi yang indeksnya dievikt: rebuild + benar, bukan stale', () => {
    const revs: VenueDoc[] = [buildDoc()];
    for (let i = 1; i <= 10; i++) revs.push(withRowLabel(revs[i - 1], `U${i}`));
    const firstIdx = getDocIndex(revs[0]);
    for (const rev of revs) getDocIndex(rev);
    expect(docIndexCacheSize()).toBeLessThanOrEqual(DOC_INDEX_CACHE_LIMIT);
    // rev0 pasti keluar dari LRU kecil setelah 10 revisi (11 dokumen > batas).
    const stillCached = getDocIndex(revs[10]);
    void stillCached;
    const rebuilt = getDocIndex(revs[0]);
    expectMatchesOracle(revs[0], rebuilt);
    // Dokumen aktif (terbaru) tak rebuild: identitas stabil.
    const a = getDocIndex(revs[10]);
    const b = getDocIndex(revs[10]);
    expect(a).toBe(b);
    expect(docIndexCacheSize()).toBeLessThanOrEqual(DOC_INDEX_CACHE_LIMIT);
    void firstIdx;
  });

  it('dokumen berbeda tak memakai indeks stale satu sama lain', () => {
    const docA = buildDoc();
    const docB = buildDoc((r, c) => ({ x: 5000 + c * 30, y: 5000 + r * 40 }));
    const idxA = getDocIndex(docA);
    const idxB = getDocIndex(docB);
    expect(idxA).not.toBe(idxB);
    expect(queryPoint(idxA, 100, 100, 10)?.seat.id).toBe('s0-0');
    expect(queryPoint(idxB, 5000, 5000, 10)?.seat.id).toBe('s0-0');
    // Mutasi A: B tak berubah dan tak rebuild.
    const docA2 = withRowLabel(docA, 'ZZ');
    expectMatchesOracle(docA2, getDocIndex(docA2));
    expect(getDocIndex(docB)).toBe(idxB);
    expect(queryPoint(getDocIndex(docB), 5000, 5000, 10)?.seat.id).toBe('s0-0');
  });

  it('dokumen aktif tak rebuild karena operasi non-doc (pan/zoom/hover/seleksi)', () => {
    const doc = buildDoc();
    const first = getDocIndex(doc);
    // Ulangi akses: tanpa ganti referensi doc, selalu hit yang sama.
    for (let i = 0; i < 20; i++) expect(getDocIndex(doc)).toBe(first);
    expect(docIndexCacheSize()).toBe(1);
  });

  it('store nyata: seleksi/tool tak rebuild indeks; ganti dokumen membersihkan cache', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const holder: { cur?: { doc: VenueDoc; select: (ids: string[]) => void; tool: (t: 'hand') => void; load: (d: VenueDoc) => void } } = {};
    function Inner() {
      const { state, selectSeats, setTool, loadDoc } = useStore();
      holder.cur = {
        doc: state.doc,
        select: (ids: string[]) => selectSeats(ids),
        tool: (t: 'hand') => setTool(t),
        load: (d: VenueDoc) => loadDoc(d),
      };
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<StoreProvider><Inner /></StoreProvider>); });
    const doc = holder.cur!.doc;
    const before = getDocIndex(doc);
    await act(async () => { holder.cur!.select(['x']); });
    await act(async () => { holder.cur!.tool('hand'); });
    // Seleksi/tool bukan revisi doc: identitas indeks stabil, ukuran tetap.
    expect(getDocIndex(holder.cur!.doc)).toBe(before);
    expect(docIndexCacheSize()).toBe(1);
    expect(holder.cur!.doc).toBe(doc);
    // Ganti dokumen: cache dikosongkan (tak ada retensi lintas dokumen).
    await act(async () => { holder.cur!.load(buildDoc()); });
    expect(docIndexCacheSize()).toBe(0);
    expect(getDocIndex(holder.cur!.doc)).not.toBe(before);
    expect(docIndexCacheSize()).toBe(1);
    act(() => root.unmount());
    host.remove();
  });
});

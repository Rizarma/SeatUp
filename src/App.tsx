import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Armchair, Hand, Circle, MousePointerClick, Podium, Footprints, Download, Eye, FolderOpen, MousePointer2, PanelRight, PencilRuler, Pentagon,
  Redo2, Rows3, Save, Square, Trash2, Undo2, Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GenSeat, Pt, RowParams, VenueObject } from './lib/venue';
import { straightSeats, uid, emptyVenue } from './lib/venue';
import { grayscaleToDrafts, guessKind } from './lib/raster';
import { parseSvgLayout } from './lib/svgImport';
import type { DraftShape } from './lib/raster';
import { classifySeats, sectionGeomFor } from './lib/contain';
import { estimateCapacity } from './lib/capacity';
import { validateVenueDoc, parseVenueJson } from './lib/validate';
import { markEligibility } from './lib/panelContext';
import { saveLocal, loadLocal, downloadJson, readTextFile, readImageFile } from './lib/storage';
import { saveBackground, loadBackground, clearBackground, hasBackgroundFlag, dataUrlToBlob } from './lib/bgImage';
import { categoryPriceForSection } from './lib/categories';
import { getDocIndex } from './lib/docIndex';
import { StoreProvider, useStore } from './store';
import type { Tool } from './store';
import EditorCanvas from './components/EditorCanvas';
import SidePanel from './components/SidePanel';
import type { RowForm } from './components/SidePanel';
import Preview from './components/Preview';

const TOOLS: { id: Tool; label: string; hint: string; Icon: LucideIcon; shortcut?: string }[] = [
  { id: 'select', label: 'Select', hint: 'Pilih atau geser objek', Icon: MousePointer2, shortcut: 'V' },
  { id: 'hand', label: 'Hand', hint: 'Seret untuk navigasi kanvas', Icon: Hand, shortcut: 'H' },
  { id: 'stage', label: 'Stage', hint: 'Buat stage (seret kotak)', Icon: Podium },
  { id: 'aisle', label: 'Lorong', hint: 'Buat lorong (seret garis)', Icon: Footprints },
  { id: 'polygon', label: 'Polygon', hint: 'Gambar polygon', Icon: Pentagon },
  { id: 'rectangle', label: 'Rectangle', hint: 'Buat rectangle (seret di kanvas)', Icon: Square },
  { id: 'circle', label: 'Circle', hint: 'Buat circle (seret diameter di kanvas)', Icon: Circle },
  { id: 'seat', label: 'Pilih kursi', hint: 'Klik pilih kursi · Shift/Cmd/Ctrl multi · seret marquee', Icon: MousePointerClick },
  { id: 'row', label: 'Baris kursi', hint: 'Buat 1 baris (klik – gerak – klik)', Icon: Armchair },
  { id: 'multirow', label: 'Blok baris', hint: 'Buat banyak baris sekaligus (klik – gerak – klik)', Icon: Rows3 },
];

// Urutan + separator dock: [select, hand] | [stage, lorong] | [polygon, rectangle, circle]
const DOCK_GROUPS_VENUE: Tool[][] = [
  ['select', 'hand'],
  ['stage', 'aisle'],
  ['polygon', 'rectangle', 'circle'],
];
const DOCK_GROUPS_FOCUS: Tool[][] = [
  ['select', 'hand'],
  ['seat', 'row', 'multirow'],
];

// Fokus yang menempel di tombol dock membuat outline :focus-visible + tooltip
// ::after tertinggal di ikon lama saat tool diganti via shortcut. Lepaskan selalu.
function blurDockButton() {
  const el = document.activeElement as HTMLElement | null;
  if (el && el.closest?.('.dock')) el.blur();
}

const DEFAULT_ROWFORM: RowForm = {
  mode: 'straight', rows: 3, seatsPerRow: 12, seatGap: 26, rowGap: 34,
  angleDeg: 0, radius: 230, spanDeg: 140, startDeg: 20, rowLabelOffset: 0,
};

/** Preview baris ala seats.io: titik awal → ujung kursor, ke kiri/kanan.
 *  Multi: gerak vertikal menambah baris (atas/bawah). Selalu lurus. */
function buildRowBlock(start: Pt, end: Pt, form: RowParams, scale: number, multi: boolean) {
  const stepX = Math.max(8, Number.isFinite(form.seatGap) ? form.seatGap : 26) * scale;
  const stepY = Math.max(8, Number.isFinite(form.rowGap) ? form.rowGap : 34) * scale;
  const count = Math.min(200, Math.floor(Math.abs(end[0] - start[0]) / stepX) + 1);
  const rows = multi ? Math.min(60, Math.floor(Math.abs(end[1] - start[1]) / stepY) + 1) : 1;
  const raw = straightSeats(start, 0, rows, count, stepX, stepY, form.rowLabelOffset);
  const dirX = end[0] < start[0] ? -1 : 1;
  const dirY = end[1] < start[1] ? -1 : 1;
  const seats = raw.map((s) => ({
    ...s,
    x: dirX < 0 ? start[0] - (s.x - start[0]) : s.x,
    y: dirY < 0 ? start[1] - (s.y - start[1]) : s.y,
  }));
  return { seats, count, rows };
}

function EditorTab({ onSave, onLoad, onExport, onImportJson }: {
  onSave: () => void; onLoad: () => void; onExport: () => void; onImportJson: (f: File) => void;
}) {
  const { state, update, select, selectSeats, setTool } = useStore();
  const [rowForm, setRowForm] = useState<RowForm>(DEFAULT_ROWFORM);
  const [anchor, setAnchor] = useState<Pt | null>(null);
  const [rowCursor, setRowCursor] = useState<Pt | null>(null);
  const [rowDrag, setRowDrag] = useState<{ start: Pt; end: Pt } | null>(null);
  const cancelRowDrag = useCallback(() => { setRowDrag(null); setAnchor(null); setRowCursor(null); }, []);
  const [aisleWidth, setAisleWidth] = useState(28);
  const [showBg, setShowBg] = useState(true);
  const [importMsg, setImportMsg] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [seatScale, setSeatScale] = useState(1);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const { doc, tool, selectedId, selectedSeatIds } = state;
  // Kait bench (?bench): paparkan seleksi + dokumen untuk verifikasi identitas
  // (tanpa mengubah jalur produksi; hanya dibaca BenchApp).
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bench')) {
      (window as unknown as { __seatupBenchSelected?: string[] }).__seatupBenchSelected = [...selectedSeatIds];
      (window as unknown as { __seatupBenchSelectedObj?: string | null }).__seatupBenchSelectedObj = selectedId;
    }
  }, [selectedSeatIds, selectedId]);

  // Shortcut: V = Select, H = Hand (abaikan saat mengetik di input/textarea/select).
  // Lepaskan fokus dari tombol dock agar outline + tooltip tak menempel di ikon lama.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') { cancelRowDrag(); setTool('select'); blurDockButton(); }
      else if (k === 'h') { cancelRowDrag(); setTool('hand'); blurDockButton(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelRowDrag, setTool]);

  const sections = useMemo(() => doc.objects.filter((o) => o.isSection), [doc.objects]);
  const focusedSection = sections.find(o => o.id === focusId) ?? null;
  const activeFocusId = focusedSection?.id ?? null;

  const toolById = useMemo(() => new Map(TOOLS.map((t) => [t.id, t])), []);
  const dockGroups = (activeFocusId ? DOCK_GROUPS_FOCUS : DOCK_GROUPS_VENUE)
    .map((g) => g.map((id) => toolById.get(id)!).filter(Boolean))
    .filter((g) => g.length > 0);
  // Baris kursi hanya dibuat di dalam section fokus. Venue tidak punya target.
  const effSectionId = activeFocusId;
  const effSection = focusedSection;
  const effGeom = useMemo(() => (effSection ? sectionGeomFor(effSection) : null), [effSection]);

  const placementScale = activeFocusId ? seatScale : 1;
  const docIndex = useMemo(() => getDocIndex(doc), [doc]);
  const capacity = useMemo(() => {
    if (!effGeom || !effSection || !activeFocusId) return null;
    const stepX = Math.max(8, Number.isFinite(rowForm.seatGap) ? rowForm.seatGap : 26) * placementScale;
    const stepY = Math.max(8, Number.isFinite(rowForm.rowGap) ? rowForm.rowGap : 34) * placementScale;
    const aisles = doc.objects.filter((o) => o.kind === 'aisle');
    const refs = docIndex.seatsBySection.get(activeFocusId);
    let existing = 0;
    if (refs) for (const r of refs) if (!r.seat.invalid) existing++;
    const est = estimateCapacity(effGeom, stepX, stepY, 8 * placementScale, aisles, existing);
    return { ...est, existing };
  }, [effGeom, effSection, activeFocusId, rowForm.seatGap, rowForm.rowGap, placementScale, doc.objects, docIndex]);
  const enterSection = (id: string) => {
    const section = sections.find(o => o.id === id);
    const geom = section && sectionGeomFor(section);
    if (!geom) return;
    const points = geom.rings.flat();
    const width = Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]));
    const height = Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]));
    setSeatScale(Math.max(0.001, Math.min(1, Math.max(width, height) / 2400)));
    setFocusId(id); cancelRowDrag(); select(id); selectSeats([]); setTool('seat');
  };
  const leaveSection = () => { setFocusId(null); cancelRowDrag(); select(null); selectSeats([]); setTool('select'); };

  // Baris ala seats.io: klik pertama = titik awal, gerak kursor = preview,
  // klik kedua / lepas-seret = commit. Multi: vertikal menambah baris.
  const rowPreview = useMemo(() => {
    if (!anchor) return null;
    const end = rowDrag?.end ?? rowCursor ?? anchor;
    return buildRowBlock(anchor, end, rowForm, placementScale, tool === 'multirow');
  }, [anchor, rowDrag, rowCursor, rowForm, placementScale, tool]);
  const genSeats = useMemo(() => rowPreview?.seats ?? [], [rowPreview]);

  const ghosts = useMemo(() => {
    if (!anchor) return null;
    if (!effGeom) return genSeats.map((s) => ({ x: s.x, y: s.y, ok: false }));
    const ok = classifySeats(genSeats, effGeom, 8 * placementScale);
    return genSeats.map((s, i) => ({ x: s.x, y: s.y, ok: ok[i] }));
  }, [anchor, genSeats, effGeom, placementScale]);
  const validCount = ghosts?.filter((g) => g.ok).length ?? 0;
  const rejectedCount = ghosts ? ghosts.length - validCount : 0;

  const commitSeats = (candidates: GenSeat[], origin: Pt, params: RowParams) => {
    if (!effSection || !effGeom) return;
    const ok = classifySeats(candidates, effGeom, 8 * placementScale);
    const kept = candidates.filter((_, i) => ok[i]);
    if (kept.length === 0) return;
    // Harga selalu ngikut kategori section aktif (sumber tunggal di tab Kategori).
    const catPrice = categoryPriceForSection(doc.objects, doc.categories, effSection.id);
    const obj: VenueObject = {
      id: uid('obj'),
      kind: 'row-straight',
      label: `Baris ${doc.objects.filter((o) => o.kind.startsWith('row')).length + 1}`,
      points: [origin],
      closed: false,
      width: 28,
      price: catPrice,
      rowParams: params,
      seats: kept.map((s, i) => ({
        id: `${uid('seat')}-${i}`, row: s.row, number: s.number, x: s.x, y: s.y, radius: 8 * placementScale,
        status: 'available' as const, price: catPrice, sectionId: effSection.id, invalid: false,
      })),
      source: { origin: 'canvas', confidence: 1 },
      guess: null,
      isSection: false,
      sectionId: effSection.id,
    };
    update((d) => ({ ...d, objects: [...d.objects, obj] }));
    select(obj.id);
    setAnchor(null);
  };

  const commitRowBlock = (start: Pt, end: Pt, multi: boolean) => {
    const { seats, count, rows } = buildRowBlock(start, end, rowForm, placementScale, multi);
    commitSeats(seats, start, {
      ...rowForm, mode: 'straight', rows: multi ? rows : 1, seatsPerRow: count, angleDeg: 0,
      seatGap: Math.max(8, rowForm.seatGap) * placementScale, rowGap: rowForm.rowGap * placementScale,
    });
  };
  const releaseRowDrag = (start: Pt, end: Pt) => {
    commitRowBlock(start, end, tool === 'multirow');
    cancelRowDrag();
  };
  const handleRowDrag = (start: Pt, end: Pt) => {
    // Seret selalu mulai ulang dari titik tekan (gambar-dan-selesai).
    setAnchor(start);
    setRowCursor(end);
    setRowDrag({ start, end });
  };
  const handleRowHover = (p: Pt) => {
    setRowCursor((prev) => (prev && prev[0] === p[0] && prev[1] === p[1] ? prev : p));
  };
  const handleTapCommit = (end: Pt) => {
    if (!anchor) return;
    commitRowBlock(anchor, end, tool === 'multirow');
    cancelRowDrag();
  };

  const importFile = async (file: File, asBg: boolean) => {
    try {
      setImportMsg('memproses…');
      const meta = await readImageFile(file);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('gagal decode'));
        img.src = meta.url;
      });
      const maxDim = 400;
      const k = Math.min(1, maxDim / Math.max(meta.width, meta.height));
      const sw = Math.max(8, Math.round(meta.width * k));
      const sh = Math.max(8, Math.round(meta.height * k));
      const cv = document.createElement('canvas');
      cv.width = sw;
      cv.height = sh;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas 2d tak tersedia');
      ctx.drawImage(img, 0, 0, sw, sh);
      const data = ctx.getImageData(0, 0, sw, sh).data;
      const gray = new Uint8Array(sw * sh);
      for (let i = 0; i < sw * sh; i++) {
        gray[i] = Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3);
      }
      const res = grayscaleToDrafts(gray, sw, sh, 0.2);
      const fx = doc.width / sw;
      const fy = doc.height / sh;
      const objs: VenueObject[] = res.shapes.map((s: DraftShape, i: number) => ({
        id: uid('draft'),
        kind: 'import-draft' as const,
        label: `Draf ${i + 1}`,
        points: s.polygon.map((p) => [Math.round(p[0] * fx), Math.round(p[1] * fy)] as Pt),
        closed: true,
        width: 28,
        price: 0,
        rowParams: null,
        seats: [],
        source: { origin: 'import-draft' as const, confidence: 0.35 },
        guess: guessKind(s.bbox, sw, sh),
      }));
      const prevBg = doc.backgroundImage;
      update((d) => ({
        ...d,
        backgroundImage: asBg ? meta.url : d.backgroundImage,
        objects: [...d.objects, ...objs],
      }));
      if (asBg) {
        // Latar hidup di IndexedDB (blob asli), bukan di JSON dokumen.
        try {
          await saveBackground(file);
        } catch {
          // tampilkan sesi ini saja; draf tetap tersimpan
        }
        if (prevBg && prevBg.startsWith('blob:') && prevBg !== meta.url) URL.revokeObjectURL(prevBg);
      }
      setImportMsg(
        `gambar ${meta.width}×${meta.height} → ${res.componentsRaw} komponen, ${res.kept} draf disimpan (${res.elapsedMs}ms). ` +
        `Ini draf kasar: relabel, geser vertex, atau hapus yang salah. Bukan hasil presisi.`,
      );
    } catch (err) {
      setImportMsg(`Impor gagal: ${err instanceof Error ? err.message : 'tak diketahui'}`);
    }
  };

  const importSvgFile = async (file: File) => {
    try {
      setImportMsg('memproses SVG…');
      const text = await readTextFile(file);
      const res = parseSvgLayout(text, doc.width, doc.height);
      if (res.objects.length === 0) {
        setImportMsg(`SVG tak menghasilkan objek. ${res.skipped.slice(0, 3).join('; ') || 'File kosong?'}`);
        return;
      }
      update((d) => ({ ...d, objects: [...d.objects, ...res.objects] }));
      const skip = res.skipped.length > 0 ? ` Dilewati ${res.skipped.length} (${res.skipped[0]}).` : '';
      setImportMsg(
        `SVG ${res.viewBox[0]}×${res.viewBox[1]}: ${res.found} shape → ${res.objects.length} objek vektor editable.` +
        `${skip} Kurva hanya geser/skala; teks outline jadi dekorasi; bukan pengenalan section.`,
      );
    } catch {
      setImportMsg('Impor SVG gagal dibaca.');
    }
  };

  const bgFile = async (file: File) => {
    try {
      const meta = await readImageFile(file);
      let persisted = false;
      try {
        await saveBackground(file);
        persisted = true;
      } catch {
        persisted = false;
      }
      if (doc.backgroundImage?.startsWith('blob:')) URL.revokeObjectURL(doc.backgroundImage);
      update((d) => ({ ...d, backgroundImage: meta.url }));
      setImportMsg(persisted
        ? 'Latar tersimpan di browser (IndexedDB, di luar kuota localStorage).'
        : 'Latar ditampilkan sesi ini saja (penyimpanan IndexedDB tak tersedia).');
    } catch {
      setImportMsg('Latar gagal dibaca.');
    }
  };

  const clearBg = () => {
    if (doc.backgroundImage?.startsWith('blob:')) URL.revokeObjectURL(doc.backgroundImage);
    void clearBackground().catch(() => {});
    update((d) => ({ ...d, backgroundImage: null }));
  };

  const selectedObj = doc.objects.find((o) => o.id === selectedId) ?? undefined;

  return (
    <div className="editor">
      <div className="canvaswrap">
        <button className="panel-toggle" aria-expanded={panelOpen} aria-controls="side-panel"
          aria-label="Buka tutup panel samping" data-tip="Panel samping" onClick={() => setPanelOpen((v) => !v)}>
          <PanelRight size={20} strokeWidth={2} aria-hidden="true" />
        </button>
        {focusedSection && (
        <div className="section-navigation">
          <>
            <button onClick={leaveSection}><ArrowLeft size={16} /> Kembali ke venue</button>
            <strong>{focusedSection.label}</strong>
            <span>{docIndex.seatsBySection.get(activeFocusId ?? '')?.length ?? 0} kursi</span>
            <label>Skala kursi baru <input aria-label="Skala kursi baru (%)" type="number" min={0.1} max={100} step={0.1}
              value={Number((seatScale * 100).toFixed(2))} onChange={e => { const n = Number(e.target.value); if (n >= 0.1 && n <= 100) setSeatScale(n / 100); }} /> %</label>
            {capacity && (
              <span role="status" title={`Grid baris lurus: kolom ${Math.max(8, rowForm.seatGap) * placementScale}px × baris ${Math.max(8, rowForm.rowGap) * placementScale}px, footprint penuh di dalam section dan di luar lorong.${capacity.coarse ? ' Estimasi kasar via luas (grid eksak terlalu besar).' : ''}`}>
                ~{capacity.total} muat · sisa ~{capacity.remaining}{capacity.coarse ? ' (kasar)' : ''}
              </span>
            )}
            {selectedSeatIds.length > 0 && <>
              <span role="status">{selectedSeatIds.length} kursi terpilih · Delete hapus kursi saja</span>
              <button aria-label={`Hapus ${selectedSeatIds.length} kursi terpilih`} onClick={() => {
                const doomed = new Set(selectedSeatIds);
                update((d) => ({
                  ...d,
                  objects: d.objects.map((o) => o.seats.some((s) => doomed.has(s.id))
                    ? { ...o, seats: o.seats.filter((s) => !doomed.has(s.id)) }
                    : o),
                }));
                selectSeats([]);
              }}>Hapus {selectedSeatIds.length} kursi</button>
              <button onClick={() => selectSeats([])}>Batal pilih</button>
            </>}
          </>
        </div>
        )}
        {rowDrag && rowPreview && <div className="seat-drag-summary" role="status">
          {tool === 'multirow' ? `${rowPreview.rows} baris × ${rowPreview.count} kursi` : `${rowPreview.count} kursi`} · {validCount} valid · {rejectedCount} ditolak
          <span>Lepaskan untuk membuat {tool === 'multirow' ? 'blok' : 'baris'} · Esc untuk batal</span>
        </div>}
        <EditorCanvas hoveredObjectId={hoveredObjectId} onRowDrag={handleRowDrag} onRowRelease={releaseRowDrag} onRowHover={handleRowHover} onRowTapCommit={handleTapCommit} onCancelRowDrag={cancelRowDrag} rowDrag={rowDrag} focusId={activeFocusId} onFocusSection={enterSection} seatRadius={8 * placementScale} anchor={anchor} onAnchor={setAnchor} showBg={showBg} ghosts={ghosts} aisleWidth={aisleWidth} />
        <div className="dock" role="toolbar" aria-label="Alat editor">
          {dockGroups.map((group, gi) => (
            <span key={gi} className="dgroup" role="group" aria-label={gi === 0 ? 'Pilih alat' : gi === 1 ? 'Stage dan lorong' : 'Bentuk'}>
              {group.map((t) => {
                const tip = t.shortcut
                  ? `${t.label} — ${t.shortcut}`
                  : ['stage', 'aisle', 'polygon', 'rectangle', 'circle'].includes(t.id)
                    ? t.label
                    : `${t.label} — ${t.hint}`;
                return (
                  <button
                    key={t.id}
                    className={tool === t.id ? 'on' : ''}
                    aria-pressed={tool === t.id}
                    aria-label={tip}
                    data-tip={tip}
                    onClick={(e) => { cancelRowDrag(); setTool(t.id); e.currentTarget.blur(); }}
                  >
                    <t.Icon size={20} strokeWidth={2} aria-hidden="true" />
                  </button>
                );
              })}
              {gi < dockGroups.length - 1 && <span className="dsep" aria-hidden="true" />}
            </span>
          ))}
        </div>
      </div>
      <SidePanel
        onHoverObject={setHoveredObjectId}
        rowForm={rowForm} setRowForm={setRowForm} anchor={anchor}
        aisleWidth={aisleWidth} setAisleWidth={setAisleWidth}
        showBg={showBg} setShowBg={setShowBg} importMsg={importMsg}
        onImportFile={importFile} onImportSvgFile={importSvgFile} onBgFile={bgFile}
        onClearBg={clearBg}
        hasBg={!!doc.backgroundImage}
        sections={activeFocusId ? sections.filter(s => s.id === activeFocusId) : sections} sectionId={effSectionId} setSectionId={() => {}} focusId={activeFocusId} onEnterSection={enterSection}
        validCount={anchor ? validCount : null} rejectedCount={anchor ? rejectedCount : null}
        previewCount={anchor ? genSeats.length : null}
        previewRows={anchor ? rowPreview?.rows ?? null : null}
        onMarkSection={() => {
          if (!selectedObj) return;
          if (!markEligibility(selectedObj).ok) return;
          update((d) => ({
            ...d,
            objects: d.objects.map((o) => (o.id === selectedObj.id
              ? { ...o, isSection: true, categoryId: o.categoryId ?? d.categories[0]?.id ?? null }
              : o)),
          }));
        }}
        onUnmarkSection={() => {
          if (!selectedObj) return;
          update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === selectedObj.id ? { ...o, isSection: false } : o)) }));
        }}
        onPurgeInvalid={() => {
          if (!selectedObj) return;
          update((d) => ({
            ...d,
            objects: d.objects.map((o) => (o.id === selectedObj.id ? { ...o, seats: o.seats.filter((s) => !s.invalid) } : o)),
          }));
        }}
        onSave={onSave} onLoad={onLoad} onExport={onExport} onImportJsonFile={onImportJson}
        open={panelOpen}
        onCloseDrawer={() => setPanelOpen(false)}
      />
    </div>
  );

}

function Shell() {
  const { state, undo, redo, loadDoc, markSaved } = useStore();
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  const { doc, past, future } = state;

  const doSave = () => {
    try {
      // Dokumen JSON selalu tanpa latar (URL sesi tak portabel, dataURL boros
      // kuota); blob latar sudah/sedang tersimpan di IndexedDB saat dipilih.
      saveLocal({ ...doc, backgroundImage: null });
      markSaved();
      setMsg(!doc.backgroundImage
        ? 'Tersimpan di browser (localStorage).'
        : hasBackgroundFlag()
          ? 'Tersimpan: dokumen di localStorage, latar di IndexedDB.'
          : 'Tersimpan (latar hanya sesi ini — IndexedDB tak tersedia).');
    } catch (err) {
      setMsg(`Gagal simpan: ${err instanceof Error ? err.message : 'penyimpanan penuh'}. Ekspor JSON dulu.`);
    }
  };
  const doLoad = async () => {
    const raw = loadLocal();
    if (!raw) {
      setMsg('Belum ada simpanan lokal.');
      return;
    }
    const { doc: d, errors } = parseVenueJson(raw);
    if (!d) {
      setMsg(`Simpanan rusak: ${errors.join('; ')}`);
      return;
    }
    if (doc.backgroundImage?.startsWith('blob:')) URL.revokeObjectURL(doc.backgroundImage);
    const storedBg = d.backgroundImage;
    let bgUrl: string | null = null;
    if (typeof storedBg === 'string' && storedBg.startsWith('data:')) {
      // Migrasi dokumen lama: pindahkan dataURL ke IndexedDB agar JSON tetap kecil.
      try {
        const blob = await dataUrlToBlob(storedBg);
        await saveBackground(blob);
        bgUrl = URL.createObjectURL(blob);
      } catch {
        bgUrl = storedBg;
      }
    } else if (hasBackgroundFlag()) {
      try {
        const blob = await loadBackground();
        if (blob) bgUrl = URL.createObjectURL(blob);
      } catch {
        // jalan tanpa latar
      }
    }
    loadDoc({ ...d, backgroundImage: bgUrl });
    setMsg(bgUrl
      ? 'Simpanan lokal + latar dimuat.'
      : hasBackgroundFlag()
        ? 'Simpanan lokal dimuat (blob latar tak ditemukan).'
        : 'Simpanan lokal dimuat.');
  };
  const doExport = () => {
    // Hanya dataURL yang portabel ikut diekspor; URL blob sesi selalu dibuang.
    const portableBg = typeof doc.backgroundImage === 'string' && doc.backgroundImage.startsWith('data:')
      ? doc.backgroundImage
      : null;
    const v = validateVenueDoc(JSON.parse(JSON.stringify({ ...doc, backgroundImage: portableBg })));
    if (!v.ok) {
      setMsg(`Gagal ekspor: ${v.errors.slice(0, 3).join('; ')}`);
      return;
    }
    downloadJson({ ...doc, backgroundImage: portableBg });
    setMsg(doc.backgroundImage && !portableBg
      ? 'venue.json diunduh tanpa latar (latar sesi tak portabel).'
      : 'venue.json diunduh (tervalidasi).');
  };
  const doImportJson = async (file: File) => {
    const text = await readTextFile(file);
    const { doc: d, errors } = parseVenueJson(text);
    if (!d) {
      setMsg(`Impor ditolak: ${errors.slice(0, 3).join('; ')}`);
      return;
    }
    loadDoc(d);
    setMsg(`Impor OK: ${d.objects.length} objek.`);
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>SeatUp</h1>
        </div>
        <div className="navbar-actions">
          <div className="seg" role="group" aria-label="Mode tampilan">
            <button
              className={tab === 'editor' ? 'on' : ''} aria-pressed={tab === 'editor'}
              aria-label="Mode editor" data-tip="Mode editor" onClick={() => setTab('editor')}
            ><PencilRuler size={18} strokeWidth={2} aria-hidden="true" /></button>
            <button
              className={tab === 'preview' ? 'on' : ''} aria-pressed={tab === 'preview'}
              aria-label="Mode preview pembeli" data-tip="Preview pembeli" onClick={() => setTab('preview')}
            ><Eye size={18} strokeWidth={2} aria-hidden="true" /></button>
          </div>
          <span className="nsep" aria-hidden="true" />
          <div className="nrow" role="toolbar" aria-label="Aksi project">
            <button className="nbtn" onClick={undo} disabled={past.length === 0}
              aria-label={`Urungkan (${past.length})`} data-tip={`Urungkan (${past.length})`}>
              <Undo2 size={18} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn" onClick={redo} disabled={future.length === 0}
              aria-label={`Ulangi (${future.length})`} data-tip={`Ulangi (${future.length})`}>
              <Redo2 size={18} strokeWidth={2} aria-hidden="true" /></button>
            <span className="nsep" aria-hidden="true" />
            <button className="nbtn" onClick={doSave} aria-label="Simpan lokal" data-tip="Simpan lokal">
              <Save size={18} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn" onClick={doLoad} aria-label="Muat simpanan lokal" data-tip="Muat lokal">
              <FolderOpen size={18} strokeWidth={2} aria-hidden="true" /></button>
            <span className="nsep" aria-hidden="true" />
            <button className="nbtn" onClick={doExport} aria-label="Ekspor JSON tervalidasi" data-tip="Ekspor JSON">
              <Download size={18} strokeWidth={2} aria-hidden="true" /></button>
            <label className="nbtn filelabel" aria-label="Buka project JSON" data-tip="Buka project JSON">
              <Upload size={18} strokeWidth={2} aria-hidden="true" />
              <input type="file" accept="application/json" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImportJson(f);
                e.target.value = '';
              }} />
            </label>
            <span className="nsep" aria-hidden="true" />
            <button className="nbtn danger" onClick={() => { if (doc.objects.length === 0 || confirm('Buang semua objek?')) loadDoc(emptyVenue()); }}
              aria-label="Bersihkan semua objek" data-tip="Bersihkan">
              <Trash2 size={18} strokeWidth={2} aria-hidden="true" /></button>
          </div>
        </div>
      </header>
      {msg && <p className="toast" role="status">{msg}</p>}
      {tab === 'editor'
        ? <EditorTab onSave={doSave} onLoad={doLoad} onExport={doExport} onImportJson={(f) => void doImportJson(f)} />
        : <Preview />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

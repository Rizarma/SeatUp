import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Armchair, Hand, Circle, MousePointerClick, Theater, Download, Eye, FolderOpen, LayoutTemplate, MousePointer2, PanelRight, PencilRuler, Pentagon,
  Redo2, Save, Spline, Square, Trash2, Undo2, Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GenSeat, Pt, RowParams, VenueObject } from './lib/venue';
import { arcSeats, straightSeats, uid, emptyVenue, sampleVenue } from './lib/venue';
import { grayscaleToDrafts, guessKind } from './lib/raster';
import { parseSvgLayout } from './lib/svgImport';
import type { DraftShape } from './lib/raster';
import { dragSeatLayout } from './lib/dragSeats';
import { classifySeats, sectionGeomFor } from './lib/contain';
import { validateVenueDoc, parseVenueJson } from './lib/validate';
import { saveLocal, loadLocal, downloadJson, readTextFile, readImageFile } from './lib/storage';
import { StoreProvider, useStore } from './store';
import type { Tool } from './store';
import EditorCanvas from './components/EditorCanvas';
import SidePanel from './components/SidePanel';
import type { RowForm } from './components/SidePanel';
import Preview from './components/Preview';

const TOOLS: { id: Tool; label: string; hint: string; Icon: LucideIcon }[] = [
  { id: 'hand', label: 'Geser kanvas', hint: 'Hand tool — seret untuk navigasi kanvas', Icon: Hand },
  { id: 'select', label: 'Pilih/geser', hint: 'Pilih atau geser objek', Icon: MousePointer2 },
  { id: 'seat', label: 'Pilih kursi', hint: 'Klik pilih kursi · Shift/Cmd/Ctrl multi · seret marquee', Icon: MousePointerClick },
  { id: 'polygon', label: 'Polygon', hint: 'Gambar polygon', Icon: Pentagon },
  { id: 'stage', label: 'Panggung', hint: 'Buat panggung (seret kotak)', Icon: Theater },
  { id: 'rectangle', label: 'Kotak', hint: 'Buat kotak (seret di kanvas)', Icon: Square },
  { id: 'circle', label: 'Lingkaran', hint: 'Buat lingkaran (seret diameter di kanvas)', Icon: Circle },
  { id: 'aisle', label: 'Lorong', hint: 'Buat lorong (seret garis)', Icon: Spline },
  { id: 'row', label: 'Baris kursi', hint: 'Buat baris kursi', Icon: Armchair },
];

const DEFAULT_ROWFORM: RowForm = {
  mode: 'arc', rows: 3, seatsPerRow: 12, seatGap: 26, rowGap: 34,
  angleDeg: 0, radius: 230, spanDeg: 140, startDeg: 20, rowLabelOffset: 0, price: 150000,
};

function EditorTab({ onSave, onLoad, onExport, onImportJson }: {
  onSave: () => void; onLoad: () => void; onExport: () => void; onImportJson: (f: File) => void;
}) {
  const { state, update, select, selectSeats, setTool } = useStore();
  const [rowForm, setRowForm] = useState<RowForm>(DEFAULT_ROWFORM);
  const [anchor, setAnchor] = useState<Pt | null>(null);
  const [rowDrag, setRowDrag] = useState<{ start: Pt; end: Pt } | null>(null);
  const cancelRowDrag = useCallback(() => { setRowDrag(null); setAnchor(null); }, []);
  const [aisleWidth, setAisleWidth] = useState(28);
  const [showBg, setShowBg] = useState(true);
  const [importMsg, setImportMsg] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [seatScale, setSeatScale] = useState(1);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const { doc, tool, selectedId, selectedSeatIds } = state;

  const sections = useMemo(() => doc.objects.filter((o) => o.isSection), [doc.objects]);
  const focusedSection = sections.find(o => o.id === focusId) ?? null;
  const activeFocusId = focusedSection?.id ?? null;
  // Baris kursi hanya dibuat di dalam section fokus. Venue tidak punya target.
  const effSectionId = activeFocusId;
  const effSection = focusedSection;
  const effGeom = useMemo(() => (effSection ? sectionGeomFor(effSection) : null), [effSection]);

  const placementScale = activeFocusId ? seatScale : 1;
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

  const dragLayout = useMemo(() => rowDrag ? dragSeatLayout(rowDrag.start, rowDrag.end, rowForm, placementScale) : null, [rowDrag, rowForm, placementScale]);
  const genSeats = useMemo(() => {
    if (dragLayout) return dragLayout.seats;
    if (!anchor) return [];
    const generated = rowForm.mode === 'arc'
      ? arcSeats(anchor, rowForm.radius, rowForm.rowGap, rowForm.startDeg, rowForm.spanDeg, rowForm.rows, rowForm.seatsPerRow, rowForm.rowLabelOffset)
      : straightSeats(anchor, rowForm.angleDeg, rowForm.rows, rowForm.seatsPerRow, rowForm.seatGap, rowForm.rowGap, rowForm.rowLabelOffset);
    return generated.map(s => ({ ...s, x: anchor[0] + (s.x - anchor[0]) * placementScale, y: anchor[1] + (s.y - anchor[1]) * placementScale }));
  }, [anchor, rowForm, placementScale, dragLayout]);

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
    const obj: VenueObject = {
      id: uid('obj'),
      kind: params.mode === 'arc' ? 'row-arc' : 'row-straight',
      label: `Baris ${doc.objects.filter((o) => o.kind.startsWith('row')).length + 1} (${params.mode === 'arc' ? 'busur' : 'lurus'})`,
      points: [origin],
      closed: false,
      width: 28,
      price: rowForm.price,
      rowParams: params,
      seats: kept.map((s, i) => ({
        id: `${uid('seat')}-${i}`, row: s.row, number: s.number, x: s.x, y: s.y, radius: 8 * placementScale,
        status: 'available' as const, price: rowForm.price, sectionId: effSection.id, invalid: false,
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

  const commitRow = () => {
    if (!anchor) return;
    commitSeats(genSeats, anchor, { ...rowForm, seatGap: rowForm.seatGap * placementScale, rowGap: rowForm.rowGap * placementScale, radius: rowForm.radius * placementScale });
  };
  const releaseRowDrag = (start: Pt, end: Pt) => {
    const layout = dragSeatLayout(start, end, rowForm, placementScale);
    commitSeats(layout.seats, start, layout.params);
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
      update((d) => ({
        ...d,
        backgroundImage: asBg ? meta.url : d.backgroundImage,
        objects: [...d.objects, ...objs],
      }));
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
      update((d) => ({ ...d, backgroundImage: meta.url }));
    } catch {
      setImportMsg('Latar gagal dibaca.');
    }
  };

  const selectedObj = doc.objects.find((o) => o.id === selectedId) ?? undefined;

  return (
    <div className="editor">
      <div className="canvaswrap">
        <button className="panel-toggle" aria-expanded={panelOpen} aria-controls="side-panel"
          aria-label="Buka tutup panel samping" data-tip="Panel samping" onClick={() => setPanelOpen((v) => !v)}>
          <PanelRight size={20} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="section-navigation">
          {focusedSection ? <>
            <button onClick={leaveSection}><ArrowLeft size={16} /> Kembali ke venue</button>
            <strong>{focusedSection.label}</strong>
            <span>{doc.objects.flatMap(o => o.seats).filter(s => s.sectionId === activeFocusId).length} kursi</span>
            <label>Skala kursi baru <input aria-label="Skala kursi baru (%)" type="number" min={0.1} max={100} step={0.1}
              value={Number((seatScale * 100).toFixed(2))} onChange={e => { const n = Number(e.target.value); if (n >= 0.1 && n <= 100) setSeatScale(n / 100); }} /> %</label>
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
          </> : <>
          <span>Kursi disembunyikan di venue. Klik dua kali section untuk mengatur kursi di dalamnya.</span>
            {selectedObj?.isSection && <button onClick={() => enterSection(selectedObj.id)}>Edit isi section</button>}
          </>}
        </div>
        {rowDrag && dragLayout && <div className="seat-drag-summary" role="status">
          {dragLayout.params.rows} baris × {dragLayout.params.seatsPerRow} kursi · {validCount} valid · {rejectedCount} ditolak
          {dragLayout.limited && ' · Maksimal 60 baris × 200 kursi per drag'}
          <span>Lepaskan untuk membuat · Esc untuk batal</span>
        </div>}
        <EditorCanvas hoveredObjectId={hoveredObjectId} onRowDrag={(start, end) => setRowDrag({ start, end })} onRowRelease={releaseRowDrag} onCancelRowDrag={cancelRowDrag} rowDrag={rowDrag} focusId={activeFocusId} onFocusSection={enterSection} seatRadius={8 * placementScale} anchor={anchor} onAnchor={setAnchor} showBg={showBg} ghosts={ghosts} aisleWidth={aisleWidth} />
        <div className="dock" role="toolbar" aria-label="Alat editor">
          {TOOLS.filter(t => activeFocusId ? (t.id === 'hand' || t.id === 'select' || t.id === 'seat' || t.id === 'row') : (t.id !== 'seat' && t.id !== 'row')).map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? 'on' : ''}
              aria-pressed={tool === t.id}
              aria-label={`${t.label} — ${t.hint}`}
              data-tip={`${t.label} — ${t.hint}`}
              onClick={() => { cancelRowDrag(); setTool(t.id); }}
            >
              <t.Icon size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <SidePanel
        onHoverObject={setHoveredObjectId}
        rowForm={rowForm} setRowForm={setRowForm} anchor={anchor} onCommitRow={commitRow}
        aisleWidth={aisleWidth} setAisleWidth={setAisleWidth}
        showBg={showBg} setShowBg={setShowBg} importMsg={importMsg}
        onImportFile={importFile} onImportSvgFile={importSvgFile} onBgFile={bgFile}
        onClearBg={() => update((d) => ({ ...d, backgroundImage: null }))}
        hasBg={!!doc.backgroundImage}
        sections={activeFocusId ? sections.filter(s => s.id === activeFocusId) : sections} sectionId={effSectionId} setSectionId={() => {}} focusId={activeFocusId} onEnterSection={enterSection}
        validCount={anchor ? validCount : null} rejectedCount={anchor ? rejectedCount : null}
        canCommit={!!anchor && !!effGeom && validCount > 0}
        onMarkSection={() => {
          if (!selectedObj) return;
          update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === selectedObj.id ? { ...o, isSection: true } : o)) }));
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
  const { doc, past, future, dirty } = state;
  const seatCount = doc.objects.reduce((a, o) => a + o.seats.length, 0);

  const doSave = () => {
    saveLocal(doc);
    markSaved();
    setMsg('Tersimpan di browser (localStorage).');
  };
  const doLoad = () => {
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
    loadDoc(d);
    setMsg('Simpanan lokal dimuat.');
  };
  const doExport = () => {
    const v = validateVenueDoc(JSON.parse(JSON.stringify(doc)));
    if (!v.ok) {
      setMsg(`Gagal ekspor: ${v.errors.slice(0, 3).join('; ')}`);
      return;
    }
    downloadJson(doc);
    setMsg('venue.json diunduh (tervalidasi).');
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
          <h1>Seat Management PoC</h1>
          <p className="muted">{doc.name} · {doc.objects.length} objek · {seatCount} kursi {dirty ? '· belum disimpan' : '· tersimpan'}</p>
        </div>
        <div className="navbar-actions">
          <div className="seg" role="group" aria-label="Mode tampilan">
            <button
              className={tab === 'editor' ? 'on' : ''} aria-pressed={tab === 'editor'}
              aria-label="Mode editor" data-tip="Mode editor" onClick={() => setTab('editor')}
            ><PencilRuler size={20} strokeWidth={2} aria-hidden="true" /></button>
            <button
              className={tab === 'preview' ? 'on' : ''} aria-pressed={tab === 'preview'}
              aria-label="Mode preview pembeli" data-tip="Preview pembeli" onClick={() => setTab('preview')}
            ><Eye size={20} strokeWidth={2} aria-hidden="true" /></button>
          </div>
          <span className="nsep" aria-hidden="true" />
          <div className="nrow" role="toolbar" aria-label="Aksi project">
            <button className="nbtn" onClick={undo} disabled={past.length === 0}
              aria-label={`Urungkan (${past.length})`} data-tip={`Urungkan (${past.length})`}>
              <Undo2 size={20} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn" onClick={redo} disabled={future.length === 0}
              aria-label={`Ulangi (${future.length})`} data-tip={`Ulangi (${future.length})`}>
              <Redo2 size={20} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn" onClick={() => { loadDoc(sampleVenue()); setMsg('Contoh venue-U dimuat.'); }}
              aria-label="Muat contoh venue-U" data-tip="Contoh venue-U">
              <LayoutTemplate size={20} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn danger" onClick={() => { if (doc.objects.length === 0 || confirm('Buang semua objek?')) loadDoc(emptyVenue()); }}
              aria-label="Bersihkan semua objek" data-tip="Bersihkan">
              <Trash2 size={20} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn" onClick={doSave} aria-label="Simpan lokal" data-tip="Simpan lokal">
              <Save size={20} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn" onClick={doLoad} aria-label="Muat simpanan lokal" data-tip="Muat lokal">
              <FolderOpen size={20} strokeWidth={2} aria-hidden="true" /></button>
            <button className="nbtn" onClick={doExport} aria-label="Ekspor JSON tervalidasi" data-tip="Ekspor JSON">
              <Download size={20} strokeWidth={2} aria-hidden="true" /></button>
            <label className="nbtn filelabel" aria-label="Buka project JSON" data-tip="Buka project JSON">
              <Upload size={20} strokeWidth={2} aria-hidden="true" />
              <input type="file" accept="application/json" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImportJson(f);
                e.target.value = '';
              }} />
            </label>
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

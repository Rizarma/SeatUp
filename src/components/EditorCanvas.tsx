import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, Maximize } from 'lucide-react';
import type { Pt, Seat, VenueObject } from '../lib/venue';
import { uid } from '../lib/venue';
import { fitViewBox, toWorld, viewBoxStr } from '../lib/camera';
import type { ViewBox } from '../lib/camera';
import { getGridLevels, minorOpacity } from '../lib/grid';
import { resizePreserveScale } from '../lib/viewTransform';
import { ghostKindForTool, isShapeTool, SHAPE_CLICK_DRAG_THRESHOLD_PX, buildShapeObject, toolForGhostKind } from '../lib/shapeDraft';
import { resolvedPoints, sectionGeomFor, shapeCenter, vectorCanvasCenter } from '../lib/contain';
import { bboxOf, normalizeAngle, rotatePoints, rotateShapeBy, rotationOf, toPointsString, translatePoints } from '../lib/geometry';
import { buildSectionSummaryPath, sectionDragOffset } from '../lib/rowSummary';
import { useStore } from '../store';
import { getDocIndex, queryBox, queryBoxVisible, queryPoint, type SeatRef } from '../lib/docIndex';
import { cullMargin, lodFor } from '../lib/viewTransform';
import SeatCanvas, { type SeatCanvasHandle } from './SeatCanvas';
import type { OverlaySpec, SeatDrawSpec } from '../lib/seatCanvas';

export const STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  pick: '#3b82f6',
  book: '#f59e0b',
  taken: '#9ca3af',
};

/** Batas seat SVG→Canvas: di atas ini kursi dirender Canvas 2D + hit-test indeks. */
export const CANVAS_SEAT_THRESHOLD = 1500;
const EMPTY_GHOSTS: Array<{ x: number; y: number; ok: boolean }> = [];

/** Ghost gambar: 'stage' = kotak panggung, 'rect' = kotak vektor, 'circle' = lingkaran vektor, 'aisle' = garis lorong. */
interface Ghost {
  kind: 'stage' | 'aisle' | 'rect' | 'circle';
  a: Pt;
  b: Pt;
}

interface Props {
  hoveredObjectId: string | null;
  rowDrag: { start: Pt; end: Pt } | null;
  onRowDrag: (start: Pt, end: Pt) => void;
  onRowRelease: (start: Pt, end: Pt) => void;
  onRowHover: (p: Pt) => void;
  /** Klik kedua (tanpa seret) saat jangkar sudah terpasang = simpan baris. */
  onRowTapCommit: (end: Pt) => void;
  onCancelRowDrag: () => void;
  focusId: string | null;
  onFocusSection: (id: string) => void;
  seatRadius: number;
  anchor: Pt | null;
  onAnchor: (p: Pt | null) => void;
  showBg: boolean;
  /** Kandidat kursi + hasil uji footprint (hijau=valid, merah=ditolak). */
  ghosts: Array<{ x: number; y: number; ok: boolean }> | null;
  /** Lebar default lorong baru (px). */
  aisleWidth: number;
  /** Kabari induk saat draf bentuk ada/tidak (untuk petunjuk panel). */
  onShapeDraftChange?: (hasDraft: boolean) => void;
}

/**
 * Hit-test baris untuk tool Select pada mode Canvas: resolve seat -> objek baris pemilik.
 * Seam regresi temuan #1 (diuji langsung tanpa DOM).
 */
export function resolveCanvasRowHit(
  idx: { seatById: Map<string, { seat: { sectionId?: string | null }; objId: string }>; objectById: Map<string, VenueObject> },
  seatId: string,
  focusId: string | null,
): VenueObject | null {
  const entry = idx.seatById.get(seatId);
  if (!entry) return null;
  if (!focusId || entry.seat.sectionId !== focusId) return null;
  const obj = idx.objectById.get(entry.objId);
  if (!obj) return null;
  if (obj.kind !== 'row-straight' && obj.kind !== 'row-arc') return null;
  return obj;
}

/** Objek akhir drag-translate dari posisi pointerup (bukan preview satu frame tertinggal). */
export function finalTranslateForDrag(orig: VenueObject, start: Pt, end: Pt): VenueObject {
  return translateObj(orig, end[0] - start[0], end[1] - start[1]);
}

/**
 * Kepemilikan renderer eksplisit (temuan P2 #2): setiap seat existing hanya
 * digambar oleh SATU renderer agar opacity/status tak ganda.
 * - baseOwner: 'canvas' bila existing >1500, selain itu 'svg'.
 * - ghostOwner: 'canvas' bila kandidat >500 (tool row/multirow + anchor),
 *   'svg' bila <=500, null bila tak ada ghost aktif.
 * - ghost-only Canvas (base svg + ghost canvas): builder base Canvas HARUS
 *   kosong; overlay Canvas HANYA ghost (seleksi/hover tetap SVG).
 * - base Canvas: SVG baris mengembalikan null; Canvas menggambar base +
 *   overlay (seleksi/hover/ghost).
 */
export type SeatRenderer = 'canvas' | 'svg';
export function seatBaseOwner(existingCount: number): SeatRenderer {
  return existingCount > CANVAS_SEAT_THRESHOLD ? 'canvas' : 'svg';
}
export function ghostOwner(
  tool: string,
  anchor: unknown,
  ghostCount: number,
): SeatRenderer | null {
  if (!anchor) return null;
  if (tool !== 'row' && tool !== 'multirow') return null;
  if (ghostCount <= 0) return null;
  return ghostCount > 500 ? 'canvas' : 'svg';
}
/** True bila lapisan dasar seat dimiliki Canvas (bukan ghost-only). */
export function isBaseOnCanvas(existingCount: number): boolean {
  return seatBaseOwner(existingCount) === 'canvas';
}
/** True bila overlay seleksi/hover dimiliki Canvas (sama dengan base). */
export function isSelectionOnCanvas(existingCount: number): boolean {
  return seatBaseOwner(existingCount) === 'canvas';
}

/**
 * Kompatibilitas: nama lama untuk "ghost butuh Canvas".
 * @deprecated pakai ghostOwner() agar kepemilikan eksplisit.
 */
export function needsGhostCanvas(tool: string, anchor: unknown, ghostCount: number): boolean {
  return ghostOwner(tool, anchor, ghostCount) === 'canvas';
}

/** Jenis overlay per kandidat ghost (hijau=valid, merah=ditolak). */
export function ghostOverlayKinds(ghosts: Array<{ ok: boolean }>): string[] {
  return ghosts.map((g) => (g.ok ? 'ghost-ok' : 'ghost-bad'));
}

/**
 * Hash visual ghost: berubah bila koordinat ATAU validitas berubah,
 * walau jumlah kandidat tetap. Dipakai overlayRev agar overlay redraw
 * tanpa membangun ulang base. FNV-1a atas (x,y,ok) terkuantisasi 1e3
 * agar stabil terhadap noise float sub-pixel.
 */
export function ghostVisualHash(ghosts: Array<{ x: number; y: number; ok: boolean }>): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  };
  mix(ghosts.length);
  for (let i = 0; i < ghosts.length; i++) {
    const g = ghosts[i];
    mix(Math.round(g.x * 1000));
    mix(Math.round(g.y * 1000));
    mix(g.ok ? 1 : 0);
  }
  return h >>> 0;
}

function translateObj(o: VenueObject, dx: number, dy: number): VenueObject {
  const moved = {
    ...o,
    points: translatePoints(o.points, dx, dy),
    seats: o.seats.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
  };
  // Offset vector berada di koordinat venue, seperti delta pointer.
  if (o.vTransform && o.vTransform.scale !== 0) {
    moved.vTransform = {
      ...o.vTransform,
      tx: o.vTransform.tx + dx,
      ty: o.vTransform.ty + dy,
    };
  }
  return moved;
}

function translateSectionContents(o: VenueObject, sectionId: string, dx: number, dy: number): VenueObject {
  const rowBelongsToSection = o.sectionId === sectionId;
  const seatBelongsToSection = (seat: Seat) => seat.sectionId === sectionId;
  const hasSectionSeats = o.seats.some(seatBelongsToSection);
  if (!rowBelongsToSection && !hasSectionSeats) return o;

  // Baris lama dapat menyimpan relasi section hanya pada kursinya.
  const isLegacyRow = !o.sectionId && (o.kind === 'row-straight' || o.kind === 'row-arc');
  return {
    ...o,
    points: rowBelongsToSection || isLegacyRow ? translatePoints(o.points, dx, dy) : o.points,
    seats: hasSectionSeats
      ? o.seats.map((seat) => seatBelongsToSection(seat) ? { ...seat, x: seat.x + dx, y: seat.y + dy } : seat)
      : o.seats,
  };
}

/** Lingkaran seat dasar (memo: hanya render ulang bila props primitif berubah). */
const SeatBaseDot = memo(function SeatBaseDot({ s, fill, dimmed, interactive, seatId }: {
  s: Seat; fill: string; dimmed: boolean; interactive: boolean; seatId: string;
}) {
  return (
    <circle cx={s.x} cy={s.y} r={(s.radius ?? 8) * 0.875} fill={fill} opacity={dimmed ? 0.45 : 0.9}
      data-seat-id={seatId}
      style={interactive ? { cursor: 'pointer' } : undefined}>
      <title>{`${s.row}${s.number}`}</title>
    </circle>
  );
});

/** Satu kelompok baris: base memo + delegasi event di <g> (tanpa closure per seat). */
const RowSeatsGroup = memo(function RowSeatsGroup({ rowObj, color, interactive, onSeatDown, onSeatOver, onSeatOut }: {
  rowObj: VenueObject; color: string; interactive: boolean;
  onSeatDown: (e: React.PointerEvent) => void;
  onSeatOver: (e: React.PointerEvent) => void;
  onSeatOut: (e: React.PointerEvent) => void;
}) {
  return (
    <g onPointerDown={interactive ? onSeatDown : undefined}
      onPointerOver={interactive ? onSeatOver : undefined}
      onPointerOut={interactive ? onSeatOut : undefined}>
      {rowObj.seats.map((s) => {
        const fill = s.invalid ? '#dc2626' : color;
        const dimmed = !s.invalid && (s.status === 'taken' || s.status === 'book');
        return <SeatBaseDot key={s.id} s={s} fill={fill} dimmed={dimmed} interactive={interactive} seatId={s.id} />;
      })}
    </g>
  );
});

export default function EditorCanvas({ hoveredObjectId, rowDrag, onRowDrag, onRowRelease, onRowHover, onRowTapCommit, onCancelRowDrag, focusId, onFocusSection, seatRadius, anchor, onAnchor, showBg, ghosts, aisleWidth, onShapeDraftChange }: Props) {
  const { state, update, select, selectSeats, setTool } = useStore();
  const { doc, tool, selectedId, selectedSeatIds } = state;
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasHoverId, setCanvasHoverId] = useState<string | null>(null);
  const [hoverSeatId, setHoverSeatId] = useState<string | null>(null);
  const rowGesture = useRef<{ start: Pt; clientX: number; clientY: number; pointerId: number; dragged: boolean; hadAnchor: boolean } | null>(null);
  /** Gesture bentuk (stage/lorong/rectangle/circle): klik–gerak–klik + seret cepat. */
  const shapeGesture = useRef<{ start: Pt; clientX: number; clientY: number; pointerId: number; dragged: boolean; hadAnchor: boolean; kind: Ghost['kind'] } | null>(null);
  /** True bila gesture drag objek aktif dibatalkan (Esc/cancel): pointerup berikutnya wajib nol commit. */
  const dragCancelledRef = useRef(false);
  /** pointerId yang memegang capture saat drag objek (untuk dilepas aman saat batal). */
  const dragPointerRef = useRef<number | null>(null);
  /** Mulai gesture drag objek baru: reset flag batal agar gesture berikutnya tetap berfungsi. */
  const beginObjectDrag = useCallback((pointerId: number | null) => {
    dragCancelledRef.current = false;
    dragPointerRef.current = pointerId;
  }, []);
  useEffect(() => { rowGesture.current = null; shapeGesture.current = null; seatGesture.current = null; setSeatMarquee(null); onCancelRowDrag(); setCanvasHoverId(null); setHoverSeatId(null); hoverSeatRef.current = null; focusSeatRef.current = null; dragCancelledRef.current = true; dragPointerRef.current = null; setDrag(null); setScaleDrag(null); setRotateDrag(null); setPreviewObj(null); setGhost(null); }, [tool, focusId, onCancelRowDrag]);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  // Kabari panel saat draf bentuk ada/hilang (untuk petunjuk kontekstual).
  useEffect(() => { onShapeDraftChange?.(ghost !== null); }, [ghost, onShapeDraftChange]);
  const [drag, setDrag] = useState<
    | { id: string; vertex: number; orig: VenueObject; start: Pt }
    | { id: string; vertex: -1; orig: VenueObject; start: Pt }
    | null
  >(null);
  const [previewObj, setPreviewObj] = useState<VenueObject | null>(null);
  const [scaleDrag, setScaleDrag] = useState<{ id: string; orig: VenueObject; cx: number; cy: number; d0: number } | null>(null);
  /** Drag gagang putar: putar preview terhadap (cx,cy); commit saat pointerup. */
  const [rotateDrag, setRotateDrag] = useState<{ id: string; orig: VenueObject; cx: number; cy: number; startAngle: number; delta: number } | null>(null);
  const [vectorPathBounds, setVectorPathBounds] = useState<{
    d: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [seatMarquee, setSeatMarquee] = useState<{ start: Pt; end: Pt } | null>(null);
  const seatGesture = useRef<{ start: Pt; clientX: number; clientY: number; pointerId: number; additive: boolean } | null>(null);
  /** Tap terakhir di kursi (untuk bedakan klik tunggal vs ganda). */
  const seatTap = useRef<{ id: string; t: number } | null>(null);
  const selVecRef = useRef<SVGGElement>(null);
  // Kamera: viewBox mengikuti aspek kontainer (tak ada letterbox). World = unit doc.
  // vbRef = sumber kebenaran terbaru (termasuk frame yang belum di-commit ke state).
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: doc.width, h: doc.height });
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const pendingVb = useRef<ViewBox | null>(null);
  const camRaf = useRef(0);
  const [cssW, setCssW] = useState(1000);
  const [, setCssH] = useState(700);
  const cssRef = useRef({ w: 1000, h: 700 });
  /** Terapkan viewBox langsung (tombol/zoom/fit/keyboard). */
  const applyVbSync = useCallback((next: ViewBox) => {
    pendingVb.current = null;
    if (camRaf.current !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(camRaf.current);
      camRaf.current = 0;
    }
    vbRef.current = next;
    setVb(next);
  }, []);
  /** Coalesce per-pointermove: maksimal 1 setVb per frame, tanpa antrean. */
  const scheduleVb = useCallback((next: ViewBox) => {
    pendingVb.current = next;
    if (camRaf.current !== 0) return;
    if (typeof requestAnimationFrame !== 'function') {
      pendingVb.current = null;
      vbRef.current = next;
      setVb(next);
      return;
    }
    camRaf.current = requestAnimationFrame(() => {
      camRaf.current = 0;
      const p = pendingVb.current;
      pendingVb.current = null;
      if (p) {
        vbRef.current = p;
        setVb(p);
      }
    });
  }, []);
  /** Pakai posisi akhir terbaru walau frame terjadwal belum berjalan. */
  const flushVb = useCallback(() => {
    const p = pendingVb.current;
    pendingVb.current = null;
    if (camRaf.current !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(camRaf.current);
      camRaf.current = 0;
    }
    if (p) {
      vbRef.current = p;
      setVb(p);
      return p;
    }
    return vbRef.current;
  }, []);
  useEffect(() => () => {
    if (camRaf.current !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(camRaf.current);
  }, []);
  const savedVenueView = useRef<ViewBox | null>(null);
  const previousFocus = useRef<string | null>(null);
  // rectW/H di-cache saat gesture mulai agar pan tak memaksa layout per-move.
  const pan = useRef<{ x: number; y: number; vb: ViewBox; rectW: number; rectH: number } | null>(null);

  // Indeks turunan doc (WeakMap: O(1) bila doc tak berubah — kamera/hover tak membangun ulang).
  const index = getDocIndex(doc);
  const focused = index.objectById.get(focusId ?? '') ?? doc.objects.find(o => o.id === focusId);
  const sectionColor = useCallback((id: string): string => index.sectionColor.get(id) ?? '#94a3b3', [index]);
  const focusGeom = useMemo(() => focused ? sectionGeomFor(focused) : null, [focused]);
  const focusSeatCount = focusId ? (index.seatsBySection.get(focusId)?.length ?? 0) : 0;
  const seatsAsCanvas = focusSeatCount > CANVAS_SEAT_THRESHOLD;
  const lod = lodFor(vb, cssW, seatRadius);
  // Hover kanvas-mode: ref (bukan state) agar tak me-render ulang seluruh scene.
  const hoverSeatRef = useRef<SeatRef | null>(null);
  const focusSeatRef = useRef<SeatRef | null>(null);
  const hoverRaf = useRef(0);
  const hoverPending = useRef<{ x: number; y: number } | null>(null);
  const seatCanvasRef = useRef<SeatCanvasHandle>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const baseRefs = useRef<SeatRef[]>([]);
  const specPool = useRef<SeatDrawSpec[]>([]);
  // Revisi untuk redraw kanvas: naik tiap doc berubah (render-time derive, tanpa effect).
  const prevDocRef = useRef(doc);
  const baseRevRef = useRef(0);
  if (prevDocRef.current !== doc) {
    prevDocRef.current = doc;
    baseRevRef.current += 1;
    hoverSeatRef.current = null;
    focusSeatRef.current = null;
  }

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cw = Math.max(1, r.width || 1000);
    const ch = Math.max(1, r.height || 700);
    cssRef.current = { w: cw, h: ch };
    setCssW(cw);
    setCssH(ch);
    if (focusGeom) {
      const box = bboxOf(focusGeom.rings.flat());
      if (!box) return;
      applyVbSync(fitViewBox(cw, ch, box.w * 1.3, box.h * 1.3, box.cx, box.cy));
    } else applyVbSync(fitViewBox(cw, ch, doc.width, doc.height));
  }, [focusGeom, doc.width, doc.height, applyVbSync]);
  const fitRef = useRef(fit);
  useEffect(() => { fitRef.current = fit; }, [fit]);
  useEffect(() => {
    if (previousFocus.current === focusId) return;
    if (focusId && !previousFocus.current) savedVenueView.current = vbRef.current;
    if (!focusId && savedVenueView.current) applyVbSync(savedVenueView.current);
    else fitRef.current();
    previousFocus.current = focusId;
    dragCancelledRef.current = true; dragPointerRef.current = null;
    setDraft([]); setGhost(null); setDrag(null); setPreviewObj(null); setScaleDrag(null); setRotateDrag(null);
    setSeatMarquee(null); seatGesture.current = null;
    hoverSeatRef.current = null; focusSeatRef.current = null;
    selectSeats([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
  // Unmount: jangan sisakan ghost/anchor/drag (commit/cancel/tool/section sudah via cancelRowDrag).
  useEffect(() => () => {
    try { onCancelRowDrag(); } catch { /* abaikan */ }
    dragCancelledRef.current = true; dragPointerRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Resize kontainer: pertahankan pusat + zoom (tanpa letterbox), bukan fit ulang.
  // Aspek vb selalu == aspek viewport sehingga SVG, Canvas, dan hit-test satu definisi.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const nw = Math.max(1, r.width || 1000);
      const nh = Math.max(1, r.height || 700);
      const prev = cssRef.current;
      cssRef.current = { w: nw, h: nh };
      setCssW(nw);
      setCssH(nh);
      const next = resizePreserveScale(vbRef.current, prev.w, prev.h, nw, nh);
      if (next) applyVbSync(next);
      else fitRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.width, doc.height]);
  const zoom = useCallback((factor: number, fx = 0.5, fy = 0.5) => {
    const v = vbRef.current;
    const width = Math.max(2, Math.min(doc.width * 4, v.w * factor));
    const k = width / v.w;
    applyVbSync({ x: v.x + v.w * fx * (1 - k), y: v.y + v.h * fy * (1 - k), w: width, h: v.h * k });
  }, [doc.width, applyVbSync]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (rowGesture.current) return;
      zoom(Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.005), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [zoom]);
  const selected = index.objectById.get(selectedId ?? '') ?? null;

  const toSvgCb = useCallback((clientX: number, clientY: number): Pt | null => {
    if (!svgRef.current) return null;
    const r = svgRef.current.getBoundingClientRect();
    return toWorld(clientX, clientY, r, vbRef.current);
  }, []);

  // Seleksi terbaru untuk handler stabil (tanpa mengikat identitas array ke memo).
  const selIdsRef = useRef(selectedSeatIds);
  selIdsRef.current = selectedSeatIds;

  /** Klik kursi: tunggal = sebaris, ganda cepat = 1 kursi, modifier = toggle satuan. */
  const activateSeat = useCallback((seatId: string, additive: boolean) => {
    const entry = index.seatById.get(seatId);
    if (!entry) return;
    if (!focusId || entry.seat.sectionId !== focusId) return;
    const rowObj = index.objectById.get(entry.objId);
    if (!rowObj) return;
    focusSeatRef.current = entry;
    if (additive) {
      const next = new Set(selIdsRef.current);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      selectSeats([...next]);
      seatTap.current = null;
    } else {
      // Klik tunggal = seluruh barisnya; klik ganda cepat = 1 kursi itu saja.
      const now = Date.now();
      const last = seatTap.current;
      if (last && last.id === seatId && now - last.t < 400) {
        seatTap.current = null;
        selectSeats([seatId]);
      } else {
        seatTap.current = { id: seatId, t: now };
        selectSeats(rowObj.seats.map((x) => x.id));
      }
    }
    // cegah marquee mulai dari kursi (kanvas-mode: pemanggil belum memulai gesture)
    seatGesture.current = null;
    setSeatMarquee(null);
    seatCanvasRef.current?.requestRedraw();
  }, [index, focusId, selectSeats]);

  const commitPolygon = useCallback((pts: Pt[]) => {
    if (pts.length < 3) return;
    const obj: VenueObject = {
      id: uid('obj'), kind: 'section', label: `Polygon ${doc.objects.length + 1}`,
      shape: 'polygon',
      points: pts, closed: true, width: 28, price: 0, rowParams: null, seats: [],
      source: { origin: 'canvas', confidence: 1 }, guess: null,
    };
    update((d) => ({ ...d, objects: [...d.objects, obj] }));
    select(obj.id);
    setDraft([]);
  }, [doc.objects.length, update, select]);

  // keyboard: Enter tutup polygon, Esc batal dulu lalu pindah ke Select (seperti V), Delete hapus (kursi dulu, baru objek)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === 'Enter' && draft.length >= 3) commitPolygon(draft);
      if (e.key === 'Escape') {
        const hadWork = draft.length > 0 || ghost !== null || drag !== null
          || previewObj !== null || scaleDrag !== null || rotateDrag !== null
          || seatMarquee !== null || rowGesture.current !== null || shapeGesture.current !== null || seatGesture.current !== null
          || rowDrag !== null || anchor !== null || selectedId !== null || selectedSeatIds.length > 0;
        rowGesture.current = null;
        shapeGesture.current = null;
        seatGesture.current = null;
        setSeatMarquee(null);
        onCancelRowDrag();
        setDraft([]);
        setGhost(null);
        // Batal penuh drag objek: flag + state + preview + capture + frame hover.
        dragCancelledRef.current = true;
        const pid = dragPointerRef.current;
        dragPointerRef.current = null;
        setDrag(null);
        setScaleDrag(null);
        setRotateDrag(null);
        setPreviewObj(null);
        try {
          const svg = svgRef.current;
          if (svg && pid !== null && typeof svg.hasPointerCapture === 'function' && svg.hasPointerCapture(pid)) {
            svg.releasePointerCapture(pid);
          }
        } catch { /* abaikan: capture mungkin sudah lepas */ }
        if (hoverRaf.current !== 0 && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(hoverRaf.current);
          hoverRaf.current = 0;
        }
        hoverPending.current = null;
        onAnchor(null);
        selectSeats([]);
        select(null);
        hoverSeatRef.current = null;
        focusSeatRef.current = null;
        seatCanvasRef.current?.requestRedraw();
        // Esc dua tahap ala Figma: pertama batalkan dulu, Esc berikutnya (tak ada kerja) pindah ke Select.
        if (!hadWork && tool !== 'select') setTool('select');
        // Lepaskan fokus dari tombol dock agar outline + tooltip tak menempel di ikon lama.
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && activeEl.closest?.('.dock')) activeEl.blur();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedSeatIds.length > 0) {
          e.preventDefault();
          const doomed = new Set(selectedSeatIds);
          update((d) => ({
            ...d,
            objects: d.objects
              .map((o) => o.seats.some((s) => doomed.has(s.id))
                ? { ...o, seats: o.seats.filter((s) => !doomed.has(s.id)) }
                : o),
          }));
          selectSeats([]);
          return;
        }
        if (selectedId && selectedId !== focusId) {
          update((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== selectedId) }));
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, ghost, drag, previewObj, scaleDrag, rotateDrag, seatMarquee, rowDrag, anchor, tool, commitPolygon, selectedId, selectedSeatIds, update, select, selectSeats, setTool, onAnchor, onCancelRowDrag, focusId]);

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || (e.button === 0 && (e.altKey || tool === 'hand'))) {
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      const rc = e.currentTarget.getBoundingClientRect();
      pan.current = { x: e.clientX, y: e.clientY, vb: flushVb(), rectW: Math.max(1, rc.width), rectH: Math.max(1, rc.height) }; return;
    }
    if (e.button !== 0) return;
    const p = toSvgCb(e.clientX, e.clientY);
    if (!p) return;
    if (tool === 'polygon') {
      setDraft((d) => [...d, p]);
      return;
    }
    if (tool === 'row' || tool === 'multirow') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const hadAnchor = anchor !== null;
      rowGesture.current = { start: p, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, dragged: false, hadAnchor };
      // Klik pertama memasang jangkar; klik berikutnya (ada jangkar) diurus
      // saat pointerup: tap = commit, seret = mulai ulang dari titik tekan.
      if (!hadAnchor) onAnchor(p);
      return;
    }
    if (tool === 'seat' && focusId) {
      // Kanvas-mode: tak ada node DOM kursi — hit-test via indeks spasial.
      if (seatsAsCanvas) {
        const tol = Math.max(4, seatRadius + 2, vbRef.current.w / Math.max(1, cssW) * 6);
        const hit = queryPoint(index, p[0], p[1], tol);
        if (hit && hit.seat.sectionId === focusId) {
          activateSeat(hit.seat.id, e.shiftKey || e.metaKey || e.ctrlKey);
          return;
        }
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      seatGesture.current = {
        start: p, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
      };
      setSeatMarquee({ start: p, end: p });
      return;
    }
    if (tool === 'stage' || tool === 'aisle' || tool === 'rectangle' || tool === 'circle') {
      const kind: Ghost['kind'] = ghostKindForTool(tool);
      // Klik kedua dimulai saat draf sudah ada: jangan reset titik awal.
      if (ghost && ghost.kind === kind && toolForGhostKind(ghost.kind) === tool) {
        e.currentTarget.setPointerCapture(e.pointerId);
        shapeGesture.current = { start: ghost.a, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, dragged: false, hadAnchor: true, kind };
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      shapeGesture.current = { start: p, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, dragged: false, hadAnchor: false, kind };
      setGhost({ kind, a: p, b: p });
      return;
    }
    // Tool Select pada mode Canvas: grup baris SVG dihilangkan, jadi hit-test
    // manual via indeks -> resolve ke objek baris pemiliknya.
    if (tool === 'select' && focusId && seatsAsCanvas) {
      const tol = Math.max(4, seatRadius + 2, vbRef.current.w / Math.max(1, cssW) * 6);
      const hit = queryPoint(index, p[0], p[1], tol);
      const rowObj = hit ? resolveCanvasRowHit(index, hit.seat.id, focusId) : null;
      if (rowObj) {
        select(rowObj.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        beginObjectDrag(e.pointerId);
        setDrag({ id: rowObj.id, vertex: -1, orig: rowObj, start: p });
        setPreviewObj(null);
        return;
      }
    }
    select(null);
    if (focusId) selectSeats([]);
  };

  const processHover = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = toWorld(clientX, clientY, r, vbRef.current);
    const tol = Math.max(4, seatRadius + 2, vbRef.current.w / Math.max(1, r.width) * 6);
    const hit = queryPoint(index, w[0], w[1], tol);
    const inFocus = hit && hit.seat.sectionId === focusId ? hit : null;
    const prevId = hoverSeatRef.current?.seat.id ?? null;
    const nextId = inFocus?.seat.id ?? null;
    if (prevId !== nextId) {
      hoverSeatRef.current = inFocus;
      const tip = tooltipRef.current;
      if (tip) {
        if (inFocus) {
          const wrap = tip.parentElement?.getBoundingClientRect();
          const k = Math.max(1, r.width) / Math.max(1, vbRef.current.w);
          const sx = (inFocus.seat.x - vbRef.current.x) * k;
          const sy = (inFocus.seat.y - vbRef.current.y) * k;
          const dx = wrap ? r.left - wrap.left : 0;
          const dy = wrap ? r.top - wrap.top : 0;
          tip.style.display = 'block';
          tip.style.transform = `translate(${dx + sx + 12}px, ${dy + sy - 12}px)`;
          tip.textContent = `${inFocus.seat.row}${inFocus.seat.number}`;
        } else {
          tip.style.display = 'none';
        }
      }
      seatCanvasRef.current?.requestRedraw();
    }
  }, [index, focusId, seatRadius]);

  const scheduleHover = useCallback((clientX: number, clientY: number) => {
    hoverPending.current = { x: clientX, y: clientY };
    if (hoverRaf.current !== 0) return;
    if (typeof requestAnimationFrame !== 'function') {
      const p = hoverPending.current;
      hoverPending.current = null;
      if (p) processHover(p.x, p.y);
      return;
    }
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = 0;
      const p = hoverPending.current;
      hoverPending.current = null;
      if (p) processHover(p.x, p.y);
    });
  }, [processHover]);

  useEffect(() => () => {
    if (hoverRaf.current !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(hoverRaf.current);
  }, []);

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pan.current) {
      const start = pan.current;
      scheduleVb({ ...start.vb, x: start.vb.x - (e.clientX - start.x) * start.vb.w / start.rectW, y: start.vb.y - (e.clientY - start.y) * start.vb.h / start.rectH });
      return;
    }
    const p = toSvgCb(e.clientX, e.clientY);
    if (!p) return;
    const gesture = rowGesture.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - gesture.clientX, e.clientY - gesture.clientY) >= 5) gesture.dragged = true;
      if (gesture.dragged) onRowDrag(gesture.start, p);
      return;
    }
    const sgShape = shapeGesture.current;
    if (sgShape && sgShape.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - sgShape.clientX, e.clientY - sgShape.clientY) >= SHAPE_CLICK_DRAG_THRESHOLD_PX) sgShape.dragged = true;
      if (sgShape.dragged) setGhost({ kind: sgShape.kind, a: sgShape.start, b: p });
      return;
    }
    const sg = seatGesture.current;
    if (sg && sg.pointerId === e.pointerId) {
      setSeatMarquee({ start: sg.start, end: p });
      return;
    }
    // Hover preview baris/blok: kursor tanpa tombol = ujung preview.
    if ((tool === 'row' || tool === 'multirow') && focusId && e.buttons === 0 && !scaleDrag && !rotateDrag && !drag && !ghost) {
      onRowHover(p);
    }
    // Hover kursi kanvas-mode: via indeks, tanpa setState React.
    if (seatsAsCanvas && tool === 'seat' && focusId && e.buttons === 0 && !scaleDrag && !rotateDrag && !drag && !ghost) {
      scheduleHover(e.clientX, e.clientY);
    }
    // Pratinjau hover bentuk: kursor tanpa tombol menggerakkan ujung draf
    // yang menunggu klik kedua (pola klik–gerak–klik ala baris kursi).
    if (ghost && isShapeTool(tool) && e.buttons === 0 && !scaleDrag && !rotateDrag && !drag && toolForGhostKind(ghost.kind) === tool) {
      setGhost({ ...ghost, b: p });
      return;
    }
    if (ghost && !isShapeTool(tool)) {
      setGhost({ ...ghost, b: p });
      return;
    }
    if (scaleDrag) {
      const dx = p[0] - scaleDrag.cx;
      const dy = p[1] - scaleDrag.cy;
      const d1 = Math.max(Math.hypot(dx, dy), 4);
      const k = d1 / scaleDrag.d0;
      const t = scaleDrag.orig.vTransform;
      if (t) {
        // skala vector terhadap pusat bbox: canvas = s*u + t, pusat tetap
        const s2 = t.scale * k;
        const ux = (scaleDrag.cx - t.tx) / t.scale;
        const uy = (scaleDrag.cy - t.ty) / t.scale;
        setPreviewObj({
          ...scaleDrag.orig,
          vTransform: { tx: scaleDrag.cx - ux * s2, ty: scaleDrag.cy - uy * s2, scale: s2, ...(t.rotation ? { rotation: t.rotation } : null) },
        });
      }
      return;
    }
    if (rotateDrag) {
      // Sudut pointer relatif pusat (derajat) → delta dari awal drag.
      const ang = (Math.atan2(p[1] - rotateDrag.cy, p[0] - rotateDrag.cx) * 180) / Math.PI;
      let d = (((ang - rotateDrag.startAngle) % 360) + 540) % 360 - 180;
      // Shift = snap kelipatan 15° (konvensi umum editor kanvas).
      if (e.shiftKey) d = Math.round(d / 15) * 15;
      // Rotasi persisten (bukan bake): preview = sudut awal + delta, panel
      // dan containment membaca status yang sama.
      if (d === 0) {
        setPreviewObj(rotateDrag.orig);
      } else {
        try {
          setPreviewObj(rotateShapeBy(rotateDrag.orig, d));
        } catch {
          setPreviewObj(rotateDrag.orig);
        }
      }
      if (d !== rotateDrag.delta) setRotateDrag({ ...rotateDrag, delta: d });
      return;
    }
    if (!drag) return;
    if (drag.vertex >= 0) {
      const dx = p[0] - drag.start[0];
      const dy = p[1] - drag.start[1];
      // Vertex ditampilkan terputar; delta pointer (kanvas) diputar balik
      // agar tersimpan ke base points yang benar.
      const rot = rotationOf(drag.orig);
      let ddx = dx;
      let ddy = dy;
      if (rot !== 0) {
        const rr = rotatePoints([[dx, dy]], -rot, 0, 0)[0];
        ddx = rr[0];
        ddy = rr[1];
      }
      const pts = drag.orig.points.slice();
      pts[drag.vertex] = [drag.orig.points[drag.vertex][0] + ddx, drag.orig.points[drag.vertex][1] + ddy];
      setPreviewObj({ ...drag.orig, points: pts });
    } else {
      setPreviewObj(finalTranslateForDrag(drag.orig, drag.start, p));
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const gesture = rowGesture.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      rowGesture.current = null;
      const vbNow = flushVb();
      const r = svgRef.current?.getBoundingClientRect();
      const end = r ? toWorld(e.clientX, e.clientY, r, vbNow) : toSvgCb(e.clientX, e.clientY);
      const moved = Math.hypot(e.clientX - gesture.clientX, e.clientY - gesture.clientY) >= 5;
      if (end && (gesture.dragged || moved)) onRowRelease(gesture.start, end);
      else if (end && gesture.hadAnchor) onRowTapCommit(end);
      // Tap pertama tanpa jangkar: jangkar sudah dipasang saat pointerdown,
      // biarkan terpasang untuk preview hover.
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const sg2 = seatGesture.current;
    if (sg2 && sg2.pointerId === e.pointerId) {
      seatGesture.current = null;
      const vbNow = flushVb();
      const r = svgRef.current?.getBoundingClientRect();
      const end = (r ? toWorld(e.clientX, e.clientY, r, vbNow) : toSvgCb(e.clientX, e.clientY)) ?? seatMarquee?.end ?? sg2.start;
      const pxMoved = Math.hypot(e.clientX - sg2.clientX, e.clientY - sg2.clientY);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* abaikan */ }
      }
      const box = seatMarquee ? { a: seatMarquee.start, b: end } : { a: sg2.start, b: end };
      const w = Math.abs(box.b[0] - box.a[0]);
      const h = Math.abs(box.b[1] - box.a[1]);
      if (pxMoved < 5 && w < 4 && h < 4) {
        if (!sg2.additive) selectSeats([]);
      } else {
        const x0 = Math.min(box.a[0], box.b[0]);
        const x1 = Math.max(box.a[0], box.b[0]);
        const y0 = Math.min(box.a[1], box.b[1]);
        const y1 = Math.max(box.a[1], box.b[1]);
        // Marquee via indeks spasial (bukan flatMap seluruh dokumen).
        const refs = queryBox(index, x0, y0, x1, y1, []);
        const inside: string[] = [];
        for (const ref of refs) {
          if (focusId && ref.seat.sectionId !== focusId) continue;
          inside.push(ref.seat.id);
        }
        if (sg2.additive) {
          const merged = new Set(selIdsRef.current);
          for (const id of inside) {
            if (merged.has(id)) merged.delete(id);
            else merged.add(id);
          }
          // klik marquee kecil tanpa isi + additive = toggle tak terjadi; biarkan seleksi lama
          selectSeats([...merged]);
        } else {
          selectSeats(inside);
        }
      }
      setSeatMarquee(null);
      return;
    }
    if (pan.current) { flushVb(); pan.current = null; return; }
    const sgest = shapeGesture.current;
    if (sgest && sgest.pointerId === e.pointerId) {
      shapeGesture.current = null;
      // Posisi akhir SELALU dari event pointerup (bukan preview satu frame
      // tertinggal) agar pas di titik yang dipilih, termasuk saat zoom.
      const vbNow = flushVb();
      const r = svgRef.current?.getBoundingClientRect();
      const end = (r ? toWorld(e.clientX, e.clientY, r, vbNow) : toSvgCb(e.clientX, e.clientY)) ?? sgest.start;
      const moved = Math.hypot(e.clientX - sgest.clientX, e.clientY - sgest.clientY) >= SHAPE_CLICK_DRAG_THRESHOLD_PX;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* abaikan */ }
      }
      const commitShape = (a: Pt, b: Pt): boolean => {
        const obj = buildShapeObject(sgest.kind, a, b, { aisleWidth, objectCount: doc.objects.length });
        if (!obj) return false;
        // Satu objek = satu aksi undo (satu update).
        update((d) => ({ ...d, objects: [...d.objects, obj] }));
        select(obj.id);
        return true;
      };
      if (sgest.dragged || moved) {
        // Cara cepat: tekan–seret–lepas dalam satu gerakan.
        if (commitShape(sgest.start, end)) {
          setGhost(null);
        } else {
          // Di bawah ukuran minimum: pertahankan titik awal.
          setGhost({ kind: sgest.kind, a: sgest.start, b: end });
        }
      } else if (sgest.hadAnchor) {
        // Klik kedua tanpa seret: buat objek dari pratinjau.
        if (commitShape(sgest.start, end)) {
          setGhost(null);
        } else {
          // Di bawah ukuran minimum: pertahankan titik awal.
          setGhost({ kind: sgest.kind, a: sgest.start, b: end });
        }
      } else {
        // Klik pertama tanpa seret: pasang titik awal, tunggu klik kedua.
        // Pratinjau hover mengikuti kursor tanpa menahan tombol.
        setGhost({ kind: sgest.kind, a: sgest.start, b: end });
      }
      return;
    }
    // Commit drag memakai posisi AKHIR pointerup (bukan preview satu frame tertinggal).
    // Satu commit/undo untuk objek dan semua kursi yang ikut digeser.
    // Bila gesture dibatalkan (Esc/cancel), pointerup berikutnya NOL commit.
    if (dragCancelledRef.current) {
      dragCancelledRef.current = false;
      dragPointerRef.current = null;
      setDrag(null);
      setScaleDrag(null);
      setRotateDrag(null);
      setPreviewObj(null);
      return;
    }
    if (drag) {
      const r = svgRef.current?.getBoundingClientRect();
      const vbNow = flushVb();
      const end = r ? toWorld(e.clientX, e.clientY, r, vbNow) : toSvgCb(e.clientX, e.clientY);
      if (end && drag.vertex === -1) {
        const dx = end[0] - drag.start[0];
        const dy = end[1] - drag.start[1];
        if (Math.hypot(dx, dy) >= 0.5) {
          const done = translateObj(drag.orig, dx, dy);
          update((d) => ({
            ...d,
            objects: d.objects.map((o) => {
              if (o.id === done.id) return done;
              return done.isSection ? translateSectionContents(o, done.id, dx, dy) : o;
            }),
          }));
        }
      } else if (drag && previewObj && drag.vertex >= 0) {
        const done = previewObj;
        update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === done.id ? done : o)) }));
      }
    }
    if (scaleDrag && previewObj) {
      const done = previewObj;
      update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === done.id ? done : o)) }));
    }
    // Rotate: commit hanya bila sudut berubah (delta 0 = tak ada undo baru).
    if (rotateDrag && previewObj && rotateDrag.delta !== 0) {
      const done = previewObj;
      update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === done.id ? done : o)) }));
    }
    dragCancelledRef.current = false;
    dragPointerRef.current = null;
    setDrag(null);
    setScaleDrag(null);
    setRotateDrag(null);
    setPreviewObj(null);
  };

  const ghostSeats = ghosts ?? EMPTY_GHOSTS;

  const rendered = previewObj
    ? doc.objects.map((o) => (o.id === previewObj.id ? previewObj : o))
    : doc.objects;
  // Objek dalam fokus via indeks (tanpa pindai seats per objek per render).
  const focusObjIds = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const o of rendered) {
      if (o.id === focusId || o.sectionId === focusId) set.add(o.id);
    }
    const refs = index.seatsBySection.get(focusId);
    if (refs) for (const r of refs) set.add(r.objId);
    return set;
  }, [rendered, focusId, index]);
  // Mode venue: JANGAN render kelompok baris/kursi sama sekali (bukan CSS hide).
  // Hanya section + objek venue relevan. Kursi section aktif dirender setelah masuk.
  const visible = useMemo(() => focusId
    ? rendered.filter(o => focusObjIds!.has(o.id))
    : rendered.filter(o => o.kind !== 'row-straight' && o.kind !== 'row-arc'),
  [rendered, focusId, focusObjIds]);

  const selectedShape = previewObj?.id === selectedId ? previewObj : selected;
  const selectedVector = selectedShape?.kind === 'vector' ? selectedShape : null;
  const vectorTransform = selectedVector?.vTransform;
  const selectedPathData = selectedVector && vectorTransform
    && (!focusObjIds || focusObjIds.has(selectedVector.id))
    ? selectedVector.d
    : undefined;
  // getBBox mengukur path lokal. Posisi kanvas mengikuti transform terbaru pada render yang sama.
  useLayoutEffect(() => {
    const path = selVecRef.current?.querySelector('path');
    if (!selectedPathData || !path) {
      setVectorPathBounds(null);
      return;
    }
    try {
      const { x, y, width, height } = path.getBBox();
      setVectorPathBounds({ d: selectedPathData, x, y, width, height });
    } catch {
      setVectorPathBounds(null);
    }
  }, [selectedPathData]);

  const vecBox = vectorTransform && vectorPathBounds && vectorPathBounds.d === selectedPathData
    ? {
        x: vectorTransform.tx + vectorPathBounds.x * vectorTransform.scale,
        y: vectorTransform.ty + vectorPathBounds.y * vectorTransform.scale,
        w: vectorPathBounds.width * vectorTransform.scale,
        h: vectorPathBounds.height * vectorTransform.scale,
      }
    : null;

  // Pusat rotasi vector (flatten + vTransform, tanpa rotasi) — pusat yang sama
  // dipakai sectionGeomFor agar tampilan = uji containment. Memo per objek
  // agar pan/zoom tak mem-flatten ulang.
  const vectorCenters = useMemo(() => {
    const m = new Map<string, Pt>();
    for (const o of rendered) {
      if (o.kind !== 'vector' || !o.d) continue;
      const rot = o.vTransform?.rotation ?? 0;
      if (!Number.isFinite(rot) || rot === 0) continue;
      const c = vectorCanvasCenter(o);
      if (c) m.set(o.id, c);
    }
    return m;
  }, [rendered]);

  const ptsStr = toPointsString;

  // ---- Ringkasan susunan kursi mode venue (satu path tipis per section) ----
  // Sumber: seatsBySection via seat.sectionId (baris lama ikut). Grup per
  // (objId pemilik, seat.row); urutan fisik/data, bukan label/nomor.
  // Cache terhadap perubahan data kursi: pan/zoom/hover memakai ulang path
  // yang sama (deps tak mencakup vb/hover). Clip = geometri aktual section
  // (rotasi polygon di-bake via resolvedPoints; vector via transform di clip).
  // Saat section digeser: clip mengikuti bentuk terbaru (rendered/preview),
  // kursi mengikuti delta drag sebelum commit; saat rotate/resize: clip ikut
  // bentuk terbaru, kursi mengikuti data lama (offset nol).
  interface VenueSummaryClipPoly { kind: 'poly'; d: string }
  interface VenueSummaryClipVec {
    kind: 'vec'; d: string; tx: number; ty: number; scale: number;
    rot: number; cx: number | null; cy: number | null; rule: 'evenodd' | 'nonzero';
  }
  interface VenueSummaryEntry { d: string; color: string; clip: VenueSummaryClipPoly | VenueSummaryClipVec }
  const venueSummaries = useMemo(() => {
    if (focusId) return null;
    const out = new Map<string, VenueSummaryEntry>();
    const dragId = drag && drag.vertex === -1 ? drag.id : null;
    const dragOrig = drag && drag.vertex === -1 ? drag.orig : null;
    for (const o of rendered) {
      if (!o.isSection) continue;
      if (o.kind !== 'section' && o.kind !== 'vector') continue;
      const refs = index.seatsBySection.get(o.id);
      if (!refs || refs.length === 0) continue;
      let offset: Pt | null = null;
      if (dragId === o.id && dragOrig && previewObj?.id === o.id) {
        const off = sectionDragOffset(dragOrig, previewObj);
        if (off[0] !== 0 || off[1] !== 0) offset = off;
      }
      const s = buildSectionSummaryPath(refs, offset);
      if (!s.d) continue;
      let clip: VenueSummaryEntry['clip'];
      if (o.kind === 'vector') {
        if (!o.d || !o.vTransform) continue;
        const t = o.vTransform;
        const rot = Number.isFinite(t.rotation ?? 0) ? (t.rotation ?? 0) : 0;
        const c = rot !== 0 ? (vectorCenters.get(o.id) ?? vectorCanvasCenter(o)) : null;
        clip = {
          kind: 'vec', d: o.d, tx: t.tx, ty: t.ty, scale: t.scale,
          rot, cx: c ? c[0] : null, cy: c ? c[1] : null,
          rule: o.svgFillRule ?? 'nonzero',
        };
      } else {
        if (o.points.length < 3) continue;
        // Clip sebagai <path> (bukan <polygon>) agar query polygon lama
        // (section + stage) tak berubah dan dblclick tes tetap ke fill.
        const rp = resolvedPoints(o);
        clip = {
          kind: 'poly',
          d: `M ${rp.map((p) => `${Math.round(p[0] * 100) / 100} ${Math.round(p[1] * 100) / 100}`).join(' L ')} Z`,
        };
      }
      out.set(o.id, { d: s.d, color: index.sectionColor.get(o.id) ?? '#94a3b3', clip });
    }
    return out;
  }, [focusId, rendered, index, drag, previewObj, vectorCenters]);

  // Infinite grid ala Miro: major tegas + minor berbayang, bertukar peran saat zoom.
  // Level dihitung dari vb.w agar kerapatan layar selalu nyaman (~16..80px).
  const grid = useMemo(() => getGridLevels(vb.w), [vb.w]);
  const gridMinorOp = minorOpacity(grid.minorAlpha);

  // ---- Seat layer: builder kanvas (pooling, tanpa alokasi per frame) ----
  const seatInteractive = !!focusId && tool === 'seat';

  // Ghost besar (>500) harus punya renderer Canvas walau existing <=1500.
  const ghostLarge = ghostOwner(tool, anchor, ghostSeats.length) === 'canvas';
  const mountCanvas = !!focusId && (seatsAsCanvas || !!ghostLarge);
  // Kepemilikan base eksplisit: hanya Canvas bila existing >1500.
  // Ghost-only (base SVG) -> builder base Canvas HARUS kosong agar seat tidak
  // digambar dua kali (Canvas + SVG). Mode base masuk ke kunci cache agar
  // transisi SVG<->Canvas menginvalidasi citra lama.
  const baseOnCanvasFlag = seatsAsCanvas;
  // Revisi base: doc + preview drag (preview mengikuti posisi sementara).
  // Revisi overlay: seleksi + ghost + baris terpilih (tanpa rebuild base).
  const docRev = baseRevRef.current;
  const previewKey = previewObj
    ? `${previewObj.id}|${previewObj.seats.length}|${previewObj.seats[0]?.x ?? 0},${previewObj.seats[0]?.y ?? 0}|${previewObj.points[0]?.[0] ?? 0},${previewObj.points[0]?.[1] ?? 0}`
    : null;
  const baseRev = useMemo(
    () => ({ docRev, previewKey, baseMode: baseOnCanvasFlag ? 'canvas' : 'svg-empty' }),
    [docRev, previewKey, baseOnCanvasFlag],
  );
  // Identitas visual ghost: hash koordinat + validitas (bukan sekadar jumlah),
  // agar geser dengan jumlah tetap tetap memicu redraw overlay tanpa rebuild base.
  const ghostHash = ghostVisualHash(ghostSeats);
  const overlayRev = useMemo(
    () => ({ sel: selectedSeatIds, ghostN: ghostSeats.length, ghostHash, ax: anchor?.[0] ?? null, ay: anchor?.[1] ?? null, selId: selectedId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSeatIds, ghostSeats.length, ghostHash, anchor, selectedId],
  );

  const buildSeatBase = useCallback((out: SeatDrawSpec[]) => {
    out.length = 0;
    // Kepemilikan eksplisit: Canvas hanya menggambar base bila existing >1500.
    // Ghost-only (base tetap SVG) -> kosong agar tak digambar dua kali.
    if (!focusId || !mountCanvas || !baseOnCanvasFlag) return;
    const v = vbRef.current;
    const m = cullMargin(v, seatRadius);
    const refs = baseRefs.current;
    refs.length = 0;
    // Culling sadar radius besar: pusat boleh di luar viewport selama bentuk terlihat.
    queryBoxVisible(index, v.x - m, v.y - m, v.x + v.w + m, v.y + v.h + m, refs);
    // Preview drag baris: ganti koordinat lama dengan posisi sementara agar
    // Canvas mengikuti pointer, bukan koordinat dokumen lama.
    const previewMap = previewObj && previewObj.seats.length > 0
      ? new Map(previewObj.seats.map((s) => [s.id, s]))
      : null;
    // Membership O(1) untuk cegah duplikasi preview-dari-luar (ganti refs.some per seat).
    let refIds: Set<string> | null = null;
    if (previewMap && previewObj && (previewObj.kind === 'row-straight' || previewObj.kind === 'row-arc')) {
      refIds = new Set<string>();
      for (let i = 0; i < refs.length; i++) refIds.add(refs[i].seat.id);
    }
    const pool = specPool.current;
    let n = 0;
    for (let i = 0; i < refs.length; i++) {
      const s0 = refs[i].seat;
      if (s0.sectionId !== focusId) continue;
      const s = previewMap?.get(s0.id) ?? s0;
      let sp = pool[n];
      if (!sp) {
        sp = { x: 0, y: 0, r: 8, fill: '', alpha: 1, dimmed: false };
        pool[n] = sp;
      }
      sp.x = s.x;
      sp.y = s.y;
      sp.r = s.radius ?? seatRadius;
      sp.fill = s.invalid ? '#dc2626' : (index.sectionColor.get(s.sectionId ?? '') ?? '#94a3b3');
      sp.alpha = 0.9;
      sp.dimmed = !s.invalid && (s.status === 'taken' || s.status === 'book');
      out.push(sp);
      n++;
    }
    // Seat preview yang masuk viewport tetapi basisnya di luar (geser jauh).
    // Traversal linear: tiap daftar (refs, previewSeats) diproses sekali; Set O(1).
    if (previewMap && previewObj && refIds && (previewObj.kind === 'row-straight' || previewObj.kind === 'row-arc')) {
      for (const s of previewObj.seats) {
        if (s.sectionId !== focusId) continue;
        if (s.x < v.x - m || s.x > v.x + v.w + m || s.y < v.y - m || s.y > v.y + v.h + m) continue;
        if (refIds.has(s.id)) continue;
        let sp = pool[n];
        if (!sp) {
          sp = { x: 0, y: 0, r: 8, fill: '', alpha: 1, dimmed: false };
          pool[n] = sp;
        }
        sp.x = s.x;
        sp.y = s.y;
        sp.r = s.radius ?? seatRadius;
        sp.fill = s.invalid ? '#dc2626' : (index.sectionColor.get(s.sectionId ?? '') ?? '#94a3b3');
        sp.alpha = 0.9;
        sp.dimmed = !s.invalid && (s.status === 'taken' || s.status === 'book');
        out.push(sp);
        n++;
      }
    }
  }, [index, focusId, mountCanvas, baseOnCanvasFlag, seatRadius, previewObj]);

  const buildSeatOverlay = useCallback((out: OverlaySpec[]) => {
    out.length = 0;
    if (!focusId || !mountCanvas) return;
    // Ghost-only Canvas (base SVG): overlay Canvas HANYA ghost agar seleksi/
    // hover tak digambar dua kali (SVG tetap menggambarnya).
    const selectionOnCanvas = baseOnCanvasFlag;
    if (selectionOnCanvas) {
    // Peta preview sekali (bukan find per seat terpilih): O(sel + preview).
    const previewById = previewObj && previewObj.seats.length > 0
      ? new Map(previewObj.seats.map((s) => [s.id, s]))
      : null;
    for (const id of selIdsRef.current) {
      const entry = index.seatById.get(id);
      if (!entry || entry.seat.sectionId !== focusId) continue;
      // Selama drag baris, posisi overlay mengikuti preview sementara.
      const pv = previewById?.get(id);
      const x = pv?.x ?? entry.seat.x;
      const y = pv?.y ?? entry.seat.y;
      out.push({ x, y, r: entry.seat.radius ?? seatRadius, kind: 'selected' });
    }
    // Baris terpilih via tool Select (tanpa seat selection): tandai seluruh baris.
    if (selectedId) {
      const selObj = index.objectById.get(selectedId);
      if (selObj && (selObj.kind === 'row-straight' || selObj.kind === 'row-arc')) {
        const src = previewObj?.id === selObj.id ? previewObj : selObj;
        for (const s of src.seats) {
          if (s.sectionId !== focusId) continue;
          out.push({ x: s.x, y: s.y, r: (s.radius ?? seatRadius) * 1.25, kind: 'selected' });
        }
      }
    }
    const hov = hoverSeatRef.current;
    if (hov && hov.seat.sectionId === focusId) {
      out.push({ x: hov.seat.x, y: hov.seat.y, r: hov.seat.radius ?? seatRadius, kind: 'hover' });
    }
    const foc = focusSeatRef.current;
    if (foc && foc.seat.id !== hov?.seat.id && foc.seat.sectionId === focusId) {
      out.push({ x: foc.seat.x, y: foc.seat.y, r: foc.seat.radius ?? seatRadius, kind: 'hover' });
    }
    }
    // Ghost preview baris besar: selalu di overlay Canvas (bukan ribuan node SVG),
    // terlepas dari jumlah existing seat.
    if ((tool === 'row' || tool === 'multirow') && anchor && ghostSeats.length > 500) {
      for (const g of ghostSeats) {
        out.push({ x: g.x, y: g.y, r: seatRadius, kind: g.ok ? 'ghost-ok' : 'ghost-bad' });
      }
    }
  }, [index, focusId, mountCanvas, baseOnCanvasFlag, seatRadius, tool, anchor, ghostSeats, selectedId, previewObj]);

  // Delegasi event kursi SVG-mode: satu handler stabil per kelompok (tanpa closure per seat).
  const rowSeatDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || e.altKey) return;
    const t = (e.target as Element).closest?.('[data-seat-id]');
    const id = t?.getAttribute('data-seat-id');
    if (!id) return;
    e.stopPropagation();
    activateSeat(id, e.shiftKey || e.metaKey || e.ctrlKey);
  }, [activateSeat]);
  const rowSeatOver = useCallback((e: React.PointerEvent) => {
    const t = (e.target as Element).closest?.('[data-seat-id]');
    const id = t?.getAttribute('data-seat-id');
    setHoverSeatId((prev) => (prev === (id ?? null) ? prev : (id ?? null)));
  }, []);
  const rowSeatOut = useCallback(() => setHoverSeatId(null), []);

  // Navigasi keyboard kursi (kanvas-mode): panah pindah fokus, Enter/Space toggle.
  const moveSeatFocus = useCallback((dx: number, dy: number) => {
    if (!focusId) return;
    const refs = index.seatsBySection.get(focusId);
    if (!refs || refs.length === 0) return;
    const cur = focusSeatRef.current?.seat ?? hoverSeatRef.current?.seat ?? null;
    let best: SeatRef | null = null;
    let bestScore = Infinity;
    const cx = cur ? cur.x : refs[0].seat.x;
    const cy = cur ? cur.y : refs[0].seat.y;
    for (const ref of refs) {
      const s = ref.seat;
      const vx = s.x - cx;
      const vy = s.y - cy;
      if (cur && vx === 0 && vy === 0) continue;
      const dot = vx * dx + vy * dy;
      if (dot <= 0) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      const score = perp * 4 + dot;
      if (score < bestScore) {
        bestScore = score;
        best = ref;
      }
    }
    if (!best && !cur) best = refs[0];
    if (best) {
      focusSeatRef.current = best;
      hoverSeatRef.current = best;
      if (liveRef.current) liveRef.current.textContent = `Kursi ${best.seat.row}${best.seat.number}`;
      seatCanvasRef.current?.requestRedraw();
    }
  }, [index, focusId]);

  return (
    <>
    <div style={{ position: 'absolute', inset: 0 }}>
    <svg
      onPointerLeave={() => { setCanvasHoverId(null); setHoverSeatId(null); hoverSeatRef.current = null; seatCanvasRef.current?.requestRedraw(); const tip = tooltipRef.current; if (tip) tip.style.display = 'none'; }}
      ref={svgRef}
      viewBox={viewBoxStr(vb)}
      className={tool === 'hand' ? 'canvas hand-tool' : 'canvas'}
      aria-label={focusId ? 'Editor isi section' : 'Editor venue'}
      tabIndex={0}
      style={{ outline: 'none' }}
      onDragStart={(e) => e.preventDefault()}
      onKeyDown={e => {
        const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const step = steps[e.key];
        if (rowGesture.current) return;
        // Kanvas-mode + tool seat: panah = navigasi kursi (bukan geser kamera).
        if (seatsAsCanvas && seatInteractive && step) {
          e.preventDefault();
          moveSeatFocus(step[0], step[1]);
          return;
        }
        if (seatsAsCanvas && seatInteractive && (e.key === 'Enter' || e.key === ' ')) {
          const cur = focusSeatRef.current ?? hoverSeatRef.current;
          if (cur) {
            e.preventDefault();
            activateSeat(cur.seat.id, true);
            if (liveRef.current) liveRef.current.textContent = `Kursi ${cur.seat.row}${cur.seat.number} dipilih`;
          }
          return;
        }
        if (step) { e.preventDefault(); const v = vbRef.current; applyVbSync({ ...v, x: v.x + step[0] * v.w * 0.1, y: v.y + step[1] * v.h * 0.1 }); }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(0.8); }
        if (e.key === '-') { e.preventDefault(); zoom(1.25); }
        if (e.key === '0') { e.preventDefault(); fit(); }
      }}
      onPointerDownCapture={e => {
        if (e.button === 1 || e.altKey || tool === 'hand') { e.stopPropagation(); onSvgPointerDown(e); }
      }}
      onPointerDown={onSvgPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onLostPointerCapture={() => { flushVb(); pan.current = null; if (rowGesture.current) { rowGesture.current = null; onCancelRowDrag(); } shapeGesture.current = null; seatGesture.current = null; setSeatMarquee(null); if (drag !== null || scaleDrag !== null || rotateDrag !== null || previewObj !== null) { dragCancelledRef.current = true; dragPointerRef.current = null; setDrag(null); setScaleDrag(null); setRotateDrag(null); setPreviewObj(null); } }}
      onPointerCancel={() => { rowGesture.current = null; shapeGesture.current = null; seatGesture.current = null; setSeatMarquee(null); onCancelRowDrag(); flushVb(); pan.current = null; dragCancelledRef.current = true; dragPointerRef.current = null; setDrag(null); setScaleDrag(null); setRotateDrag(null); setGhost(null); setPreviewObj(null); hoverSeatRef.current = null; focusSeatRef.current = null; seatCanvasRef.current?.requestRedraw(); }}
      onDoubleClick={() => {
        if (draft.length >= 3) commitPolygon(draft);
      }}
    >
      <style>{`.canvas .lbl { font-size: ${Math.min(15, vb.w / 70)}px; }`}</style>
      <defs>
        <pattern id="grid-major" width={grid.major} height={grid.major} patternUnits="userSpaceOnUse">
          <path d={`M ${grid.major} 0 L 0 0 0 ${grid.major}`} fill="none" stroke="#e5e7eb" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </pattern>
        <pattern id="grid-minor" width={grid.minor} height={grid.minor} patternUnits="userSpaceOnUse">
          <path d={`M ${grid.minor} 0 L 0 0 0 ${grid.minor}`} fill="none" stroke="#e5e7eb" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeOpacity={gridMinorOp} />
        </pattern>
        {venueSummaries && [...venueSummaries].map(([id, s]) => (
          s.clip.kind === 'poly'
            ? (
              <clipPath key={id} id={`summary-clip-${id}`}>
                <path d={s.clip.d} />
              </clipPath>
            )
            : (
              <clipPath key={id} id={`summary-clip-${id}`}>
                <path
                  d={s.clip.d}
                  transform={`${s.clip.rot !== 0 && s.clip.cx !== null && s.clip.cy !== null ? `rotate(${s.clip.rot} ${s.clip.cx} ${s.clip.cy}) ` : ''}translate(${s.clip.tx} ${s.clip.ty}) scale(${s.clip.scale})`}
                  clipRule={s.clip.rule}
                />
              </clipPath>
            )
        ))}
      </defs>
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#ffffff" />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#grid-major)" />
      {gridMinorOp > 0.02 && (
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#grid-minor)" />
      )}
      {!focusId && showBg && doc.backgroundImage && (
        <image href={doc.backgroundImage} x={0} y={0} width={doc.width} height={doc.height} opacity={0.45} preserveAspectRatio="none" />
      )}

      {visible.map((o) => {
        const isSel = o.id === selectedId;
        // Container section di mode fokus = workspace pasif: tak bisa diklik,
        // tak bisa di-hover, tak ada gaya terpilih. Interaksi hanya isi di dalamnya.
        const isFocusContainer = !!focusId && o.id === focusId;
        const objectHoverEvents = {
          onPointerEnter: () => { if (o.id === focusId) return; if (tool === 'select' && !drag && !scaleDrag && !pan.current) setCanvasHoverId(o.id); },
          onPointerLeave: () => setCanvasHoverId(null),
        };
        const sectionEvents = {
          ...objectHoverEvents,
          onDoubleClick: (e: React.MouseEvent) => {
            if (o.isSection && !focusId && tool === 'select') { e.stopPropagation(); onFocusSection(o.id); }
          },
        };
        const selectDrag = {
          onPointerDown: (e: React.PointerEvent) => {
            if (tool !== 'select' || e.button !== 0 || e.altKey || o.id === focusId) return;
            e.stopPropagation();
            select(o.id);
            if (o.id === focusId) return;
            svgRef.current?.setPointerCapture(e.pointerId);
            const svg = svgRef.current;
            if (!svg) return;
            const r = svg.getBoundingClientRect();
            const p: Pt = toWorld(e.clientX, e.clientY, r, vbRef.current);
            beginObjectDrag(e.pointerId);
            setDrag({ id: o.id, vertex: -1, orig: o, start: p });
          },
        };
        if (o.kind === 'vector' && o.d && o.vTransform) {
          const t = o.vTransform;
          const st = o.svgStroke ?? null;
          const selStyle = isSel ? { stroke: '#2563eb', strokeWidth: 2.5 / t.scale } : {};
          const secColor = o.isSection ? sectionColor(o.id) : null;
          const rot = t.rotation ?? 0;
          const rc = Number.isFinite(rot) && rot !== 0 ? (vectorCenters.get(o.id) ?? vectorCanvasCenter(o)) : null;
          // Section vector memakai bahasa visual yang sama dengan polygon
          // section: fill warna identitas + outline, bukan fill dekorasi solid.
          const fill = secColor ?? o.svgFill ?? 'black';
          const fillOpacity = secColor ? 0.18 : o.svgFillOpacity ?? undefined;
          const stroke = secColor ?? (st ? st.color : 'none');
          const strokeWidth = secColor ? 2 / t.scale : st ? st.width : undefined;
          // Ringkasan venue: fill di bawah, garis ringkasan di tengah (clip ke
          // geometri aktual, dekoratif), outline di atas agar tetap crisp.
          // Highlight seleksi/hover dirender belakangan sehingga selalu di atas.
          const venueSum = !focusId && o.isSection ? venueSummaries?.get(o.id) ?? null : null;
          if (venueSum) {
            return (
              <g key={o.id} {...(isFocusContainer ? {} : sectionEvents)} aria-label={o.label}>
                <g transform={rc ? `rotate(${rot} ${rc[0]} ${rc[1]})` : undefined}>
                  <g
                    ref={isSel ? selVecRef : undefined}
                    transform={`translate(${t.tx} ${t.ty}) scale(${t.scale})`}
                  >
                    <path
                      d={o.d}
                      fill={fill}
                      fillOpacity={fillOpacity}
                      vectorEffect="non-scaling-stroke"
                      fillRule={o.svgFillRule ?? 'nonzero'}
                      stroke="none"
                      {...(isFocusContainer ? {} : selectDrag)}
                      style={{ cursor: tool === 'select' ? 'move' : undefined }}
                    />
                  </g>
                </g>
                <g clipPath={`url(#summary-clip-${o.id})`} pointerEvents="none" aria-hidden="true">
                  <path
                    d={venueSum.d}
                    fill="none"
                    stroke={venueSum.color}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.55}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
                <g transform={rc ? `rotate(${rot} ${rc[0]} ${rc[1]})` : undefined} pointerEvents="none" aria-hidden="true">
                  <g transform={`translate(${t.tx} ${t.ty}) scale(${t.scale})`}>
                    <path
                      d={o.d}
                      fill="none"
                      fillRule={o.svgFillRule ?? 'nonzero'}
                      stroke={isSel ? '#2563eb' : stroke}
                      strokeWidth={isSel ? 2.5 / t.scale : strokeWidth}
                      strokeLinecap={st?.linecap as 'butt' | 'round' | 'square' | undefined}
                      strokeLinejoin={st?.linejoin as 'miter' | 'round' | 'bevel' | undefined}
                      strokeDasharray={st?.dash}
                      strokeDashoffset={st?.dashOffset}
                      strokeOpacity={st?.opacity}
                      vectorEffect="non-scaling-stroke"
                      style={isSel && !isFocusContainer ? selStyle : undefined}
                    />
                  </g>
                </g>
              </g>
            );
          }
          return (
            <g key={o.id} {...(isFocusContainer ? {} : sectionEvents)} aria-label={o.label}>
              <g transform={rc ? `rotate(${rot} ${rc[0]} ${rc[1]})` : undefined}>
              <g
                ref={isSel ? selVecRef : undefined}
                transform={`translate(${t.tx} ${t.ty}) scale(${t.scale})`}
              >
                <path
                  d={o.d}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  vectorEffect="non-scaling-stroke"
                  fillRule={o.svgFillRule ?? 'nonzero'}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeLinecap={st?.linecap as 'butt' | 'round' | 'square' | undefined}
                  strokeLinejoin={st?.linejoin as 'miter' | 'round' | 'bevel' | undefined}
                  strokeDasharray={st?.dash}
                  strokeDashoffset={st?.dashOffset}
                  strokeOpacity={st?.opacity}
                  {...(isFocusContainer ? {} : selectDrag)}
                  style={{ cursor: tool === 'select' ? 'move' : undefined }}
                />
                {isSel && !isFocusContainer && (
                  <path d={o.d} fill="none" stroke="#2563eb" strokeWidth={2.5 / t.scale} pointerEvents="none" style={selStyle} />
                )}
              </g>
              </g>
            </g>
          );
        }
        const selStyle = isSel ? { stroke: '#2563eb', strokeWidth: 3 } : {};
        if (o.kind === 'aisle') {
          const arot = rotationOf(o);
          const ac = arot !== 0 ? shapeCenter(o) : null;
          // Lorong terpilih harus TETAP tebal (strokeWidth = o.width), hanya warna
          // berubah biru. Jangan pakai selStyle di sini: style.strokeWidth: 3
          // akan mengalahkan atribut presentation strokeWidth (CSS > atribut),
          // sehingga lorong menyusut jadi garis tipis 3px saat diklik.
          return (
            <g key={o.id} {...sectionEvents} aria-label={o.label}
              transform={ac ? `rotate(${arot} ${ac[0]} ${ac[1]})` : undefined}>
              <polyline points={ptsStr(o.points)} fill="none" stroke={isSel ? '#2563eb' : '#94a3b8'} strokeWidth={o.width} strokeLinecap="round" opacity={isSel ? 1 : 0.8} {...selectDrag} style={{ cursor: tool === 'select' ? 'move' : undefined }} />
            </g>
          );
        }
        if (o.kind === 'row-straight' || o.kind === 'row-arc') {
          if (seatsAsCanvas) return null;
          return (
            <g key={o.id} {...objectHoverEvents} {...(seatInteractive ? {} : selectDrag)} aria-label={`${o.label} (${o.seats.length} kursi)`}>
              {(() => {
                const hoveredId = tool === 'select' ? (canvasHoverId ?? hoveredObjectId) : hoveredObjectId;
                const hovered = hoveredId === o.id || (hoverSeatId != null && o.seats.some((s) => s.id === hoverSeatId));
                if (!hovered) return null;
                const first = o.seats[0];
                if (!first) return null;
                const r = first.radius ?? 8;
                const gap = r * 1.5;
                const cx = first.x - gap;
                const cy = first.y - gap;
                const arm = r * 0.45;
                const col = isSel ? '#2563eb' : '#64748b';
                return (
                  <g key={`anchor-${o.id}`} pointerEvents="none" aria-hidden="true">
                    <title>Jangkar baris</title>
                    <line x1={cx - arm} y1={cy} x2={cx + arm} y2={cy} stroke={col} strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    <line x1={cx} y1={cy - arm} x2={cx} y2={cy + arm} stroke={col} strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    <circle cx={cx} cy={cy} r={r * 0.14} fill={col} />
                  </g>
                );
              })()}
              <RowSeatsGroup rowObj={o} color={sectionColor(o.seats[0]?.sectionId ?? o.sectionId ?? focusId ?? '')}
                interactive={seatInteractive} onSeatDown={rowSeatDown} onSeatOver={rowSeatOver} onSeatOut={rowSeatOut} />
              {seatInteractive && hoverSeatId != null && (
                <RowHoverRings index={index} seatId={hoverSeatId} />
              )}
              <SeatSelectedRings index={index} ids={selectedSeatIds} focusId={focusId} rowId={o.id} />
            </g>
          );
        }
        const fill = o.isSection
          ? sectionColor(o.id)
          : o.kind === 'stage' ? '#cbd5e1' : o.kind === 'import-draft' ? 'rgba(251,191,36,0.35)' : 'rgba(147,197,253,0.35)';
        const fillOpacity = o.isSection ? 0.18 : undefined;
        const stroke = o.isSection ? sectionColor(o.id) : o.kind === 'import-draft' ? '#dc2626' : o.kind === 'stage' ? '#475569' : '#3b82f6';
        const prot = rotationOf(o);
        const prc = prot !== 0 ? shapeCenter(o) : null;
        // Ringkasan venue polygon: fill (interaktif) di bawah, garis di tengah
        // (clip geometri aktual, dekoratif), outline di atas agar tetap crisp.
        const venueSumPoly = !focusId && o.isSection && o.kind === 'section' ? venueSummaries?.get(o.id) ?? null : null;
        if (venueSumPoly) {
          // Outline sebagai <path> (bukan <polygon> kedua) agar jumlah
          // <polygon> terlihat tetap: fill per section + stage.
          const outlineD = `M ${o.points.map((p) => `${Math.round(p[0] * 100) / 100} ${Math.round(p[1] * 100) / 100}`).join(' L ')} Z`;
          return (
            <g key={o.id} {...(isFocusContainer ? {} : sectionEvents)} aria-label={o.label}>
              <g transform={prc ? `rotate(${prot} ${prc[0]} ${prc[1]})` : undefined}>
                <polygon vectorEffect="non-scaling-stroke" points={ptsStr(o.points)} fill={fill} fillOpacity={fillOpacity} stroke="none" {...(isFocusContainer ? {} : selectDrag)} style={{ cursor: tool === 'select' ? 'move' : undefined }} />
              </g>
              <g clipPath={`url(#summary-clip-${o.id})`} pointerEvents="none" aria-hidden="true">
                <path
                  d={venueSumPoly.d}
                  fill="none"
                  stroke={venueSumPoly.color}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.55}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
              <g transform={prc ? `rotate(${prot} ${prc[0]} ${prc[1]})` : undefined} pointerEvents="none" aria-hidden="true">
                <path d={outlineD} fill="none" stroke={isSel && !isFocusContainer ? '#2563eb' : stroke} strokeWidth={isSel && !isFocusContainer ? 3 : 2} vectorEffect="non-scaling-stroke" />
              </g>
            </g>
          );
        }
        return (
          <g key={o.id} {...(isFocusContainer ? {} : sectionEvents)} aria-label={o.label}
            transform={prc ? `rotate(${prot} ${prc[0]} ${prc[1]})` : undefined}>
            <polygon vectorEffect="non-scaling-stroke" points={ptsStr(o.points)} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={isSel && !isFocusContainer ? 3 : 2} strokeDasharray={o.kind === 'import-draft' && !o.isSection ? '10 6' : undefined} {...(isFocusContainer ? {} : selectDrag)} style={isFocusContainer ? undefined : selStyle} />
          </g>
        );
      })}

      {(() => {
        const effectiveHoverId = tool === 'select' ? canvasHoverId ?? hoveredObjectId : hoveredObjectId;
        const hovered = visible.find(o => o.id === effectiveHoverId);
        if (!hovered) return null;
        // Container section di mode fokus = workspace pasif, jangan di-highlight.
        if (hovered.id === focusId) return null;
        // Jangan pernah munculkan kursi tersembunyi venue lewat highlight panel.
        if (!focusId && (hovered.kind === 'row-straight' || hovered.kind === 'row-arc')) return null;
        const style = { stroke: '#f59e0b', strokeWidth: 3, vectorEffect: 'non-scaling-stroke' as const };
        let outline;
        if (hovered.kind === 'vector' && hovered.d && hovered.vTransform) {
          const hrot = hovered.vTransform.rotation ?? 0;
          const hrc = Number.isFinite(hrot) && hrot !== 0
            ? (vectorCenters.get(hovered.id) ?? vectorCanvasCenter(hovered))
            : null;
          outline = <g transform={hrc ? `rotate(${hrot} ${hrc[0]} ${hrc[1]})` : undefined}>
            <path d={hovered.d} transform={`translate(${hovered.vTransform.tx} ${hovered.vTransform.ty}) scale(${hovered.vTransform.scale})`}
              fill="rgba(245,158,11,0.16)" fillRule={hovered.svgFillRule ?? 'nonzero'} {...style} />
          </g>;
        } else if (hovered.kind === 'aisle') {
          const harot = rotationOf(hovered);
          const harc = harot !== 0 ? shapeCenter(hovered) : null;
          outline = <polyline points={ptsStr(hovered.points)} fill="none" stroke="#f59e0b" strokeWidth={hovered.width + vb.w / 180} strokeLinecap="round" opacity={0.6}
            transform={harc ? `rotate(${harot} ${harc[0]} ${harc[1]})` : undefined} />;
        } else if (hovered.kind.startsWith('row')) {
          if (seatsAsCanvas) return null;
          outline = hovered.seats.map(seat => <circle key={seat.id} cx={seat.x} cy={seat.y} r={(seat.radius ?? 8) * 1.2} fill="rgba(245,158,11,0.16)" {...style} />);
        } else {
          const hprot = rotationOf(hovered);
          const hprc = hprot !== 0 ? shapeCenter(hovered) : null;
          outline = <polygon points={ptsStr(hovered.points)} fill="rgba(245,158,11,0.16)" {...style}
            transform={hprc ? `rotate(${hprot} ${hprc[0]} ${hprc[1]})` : undefined} />;
        }
        return <g data-highlight-object={hovered.id} pointerEvents="none" aria-hidden="true">{outline}</g>;
      })()}

      {selected && selected.id !== focusId && visible.find((o) => o.id === selected.id) && (selected.kind !== 'row-straight' && selected.kind !== 'row-arc') && (() => {
        // Vertex mengikuti rotasi (koordinat kanvas hasil resolve) agar
        // menempel di shape; index tetap 1:1 dengan base points.
        const vTarget = previewObj?.id === selected.id ? previewObj : selected;
        return (
          <g>
            {resolvedPoints(vTarget).map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={8}
                fill="#fff"
                stroke="#2563eb"
                strokeWidth={2.5}
                className="vh"
                onPointerDown={(e) => {
                  if (tool !== 'select') return;
                  e.stopPropagation();
                  const svg = svgRef.current;
                  if (!svg) return;
                  const r = svg.getBoundingClientRect();
                  const sp: Pt = toWorld(e.clientX, e.clientY, r, vbRef.current);
                  beginObjectDrag(e.pointerId);
                  setDrag({ id: selected.id, vertex: i, orig: selected, start: sp });
                }}
              />
            ))}
          </g>
        );
      })()}

      {selectedVector && selectedVector.id !== focusId && vecBox && tool === 'select' && !drag && (() => {
        const { x, y, w, h } = vecBox;
        // Saat ada rotasi, pusat skala = pusat rotasi (flatten) agar konsisten
        // dengan containment & preview; kotak seleksi ikut diputar.
        const rot1 = vectorTransform?.rotation ?? 0;
        const rc = Number.isFinite(rot1) && rot1 !== 0
          ? vectorCenters.get(selectedVector.id) ?? vectorCanvasCenter(selectedVector)
          : null;
        const cx = rc ? rc[0] : x + w / 2;
        const cy = rc ? rc[1] : y + h / 2;
        const S = 12;
        const corners: Array<[number, number]> = [
          [x, y],
          [x + w, y],
          [x, y + h],
          [x + w, y + h],
        ];
        return (
          <g transform={rc ? `rotate(${rot1} ${rc[0]} ${rc[1]})` : undefined}>
            <rect x={x} y={y} width={w} height={h} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />
            {corners.map(([px, py], i) => (
              <rect
                key={i}
                x={px - S / 2} y={py - S / 2} width={S} height={S} fill="#fff" stroke="#2563eb" strokeWidth={2} className="vh"
                style={{ cursor: 'nwse-resize' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  beginObjectDrag(e.pointerId);
                  setScaleDrag({ id: selectedVector.id, orig: selectedVector, cx, cy, d0: Math.max(Math.hypot(px - cx, py - cy), 4) });
                }}
              />
            ))}
          </g>
        );
      })()}

      {/* Objek points (section/polygon/stage/aisle/draf) sengaja TANPA kotak bbox:
          seleksi hanya mengikuti shape polygon + vertex bulat agar tidak ganda. */}

      {/* Gagang putar: lingkaran di atas pusat shape terpilih (tool select).
          Seret mengelilingi pusat untuk memutar; Shift = snap 15°; Esc batal.
          Gagang muncul saat idle atau rotasi. */}
      {selected && tool === 'select' && selected.id !== focusId && !drag && !scaleDrag
        && (selected.kind === 'stage' || selected.kind === 'section'
          || selected.kind === 'import-draft' || selected.kind === 'vector')
        && visible.find((o) => o.id === selected.id) && (() => {
        const target = selectedShape ?? selected;
        const active = rotateDrag && rotateDrag.id === selected.id ? rotateDrag : null;
        let box: { x: number; y: number; w: number; h: number } | null = null;
        let cx = 0;
        let cy = 0;
        if (target.kind === 'vector') {
          if (!vecBox) return null;
          box = vecBox;
          const rc = vectorCenters.get(target.id) ?? vectorCanvasCenter(target);
          cx = rc ? rc[0] : box.x + box.w / 2;
          cy = rc ? rc[1] : box.y + box.h / 2;
        } else {
          // Kotak dari objek awal drag agar pusat stabil saat preview berputar.
          const src = active ? active.orig : target;
          if (src.points.length === 0) return null;
          const b = bboxOf(src.points);
          if (!b) return null;
          box = b;
          cx = active ? active.cx : b.cx;
          cy = active ? active.cy : b.cy;
        }
        // Gagang MENGORBIT mengikuti orientasi shape: offset dari pusat
        // sebesar setengah tinggi box + GAP agar gagang selalu di luar shape.
        // Angka = total sudut live.
        const baseRot = rotationOf(active ? active.orig : target);
        const liveRot = active ? normalizeAngle(baseRot + active.delta) : baseRot;
        const GAP = 28;
        const R = box.h / 2 + GAP;
        const off = rotatePoints([[0, -R]], liveRot, 0, 0)[0];
        const hx = cx + off[0];
        const hy = cy + off[1];
        const top = rotatePoints([[cx, box.y]], liveRot, cx, cy)[0];
        return (
          <g key={`rotate-${selected.id}`}>
            <line x1={top[0]} y1={top[1]} x2={hx} y2={hy} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />
            <circle
              cx={hx} cy={hy} r={8} fill="#fff" stroke="#2563eb" strokeWidth={2.5} className="vh"
              data-rotate-handle={selected.id}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                if (tool !== 'select' || e.button !== 0 || e.altKey) return;
                e.stopPropagation();
                const svg = svgRef.current;
                if (!svg) return;
                const r = svg.getBoundingClientRect();
                const sp: Pt = toWorld(e.clientX, e.clientY, r, vbRef.current);
                const sa = (Math.atan2(sp[1] - cy, sp[0] - cx) * 180) / Math.PI;
                beginObjectDrag(e.pointerId);
                setRotateDrag({ id: selected.id, orig: target, cx, cy, startAngle: sa, delta: 0 });
              }}
            >
              <title>Seret untuk memutar (Shift = kelipatan 15°)</title>
            </circle>
            {active && (
              <text x={hx + 12} y={hy + 4} className="lbl">{Math.round(liveRot)}°</text>
            )}
          </g>
        );
      })()}

      {draft.length > 0 && (
        <g>
          <polyline points={ptsStr(draft)} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
          {draft.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={5} fill="#2563eb" />
          ))}
          <text x={draft[draft.length - 1][0] + 10} y={draft[draft.length - 1][1]} className="lbl">Enter/klik-ganda = tutup</text>
        </g>
      )}

      {ghost && (
        <g pointerEvents="none">
          {ghost.kind === 'circle'
            ? <circle cx={(ghost.a[0] + ghost.b[0]) / 2} cy={(ghost.a[1] + ghost.b[1]) / 2} r={Math.hypot(ghost.b[0] - ghost.a[0], ghost.b[1] - ghost.a[1]) / 2} fill="rgba(147,197,253,0.35)" stroke="#3b82f6" strokeDasharray="6 4" pointerEvents="none" />
            : ghost.kind === 'stage' || ghost.kind === 'rect'
            ? <rect x={Math.min(ghost.a[0], ghost.b[0])} y={Math.min(ghost.a[1], ghost.b[1])} width={Math.abs(ghost.b[0] - ghost.a[0])} height={Math.abs(ghost.b[1] - ghost.a[1])} fill={ghost.kind === 'stage' ? 'rgba(100,116,139,0.4)' : 'rgba(147,197,253,0.35)'} stroke={ghost.kind === 'stage' ? '#475569' : '#3b82f6'} strokeDasharray="6 4" />
            : <line x1={ghost.a[0]} y1={ghost.a[1]} x2={ghost.b[0]} y2={ghost.b[1]} stroke="#94a3b8" strokeWidth={aisleWidth} strokeLinecap="round" opacity={0.6} />}
          {/* Penanda titik awal draf bentuk (klik pertama). */}
          <circle cx={ghost.a[0]} cy={ghost.a[1]} r={5} fill="#2563eb" stroke="#fff" strokeWidth={2} />
          <text x={ghost.a[0] + 12} y={ghost.a[1] - 10} className="lbl">Klik lagi untuk membuat · Esc untuk batal</text>
        </g>
      )}

      {rowDrag && <rect
        x={Math.min(rowDrag.start[0], rowDrag.end[0])} y={Math.min(rowDrag.start[1], rowDrag.end[1])}
        width={Math.abs(rowDrag.end[0] - rowDrag.start[0])} height={Math.abs(rowDrag.end[1] - rowDrag.start[1])}
        fill="rgba(37,99,235,0.04)" stroke="#2563eb" strokeWidth={1} vectorEffect="non-scaling-stroke"
        strokeDasharray="5 4" pointerEvents="none" />}

      {seatMarquee && Math.hypot(seatMarquee.end[0] - seatMarquee.start[0], seatMarquee.end[1] - seatMarquee.start[1]) >= 4 && <rect
        x={Math.min(seatMarquee.start[0], seatMarquee.end[0])} y={Math.min(seatMarquee.start[1], seatMarquee.end[1])}
        width={Math.abs(seatMarquee.end[0] - seatMarquee.start[0])} height={Math.abs(seatMarquee.end[1] - seatMarquee.start[1])}
        fill="rgba(29,78,216,0.08)" stroke="#1d4ed8" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
        strokeDasharray="6 4" pointerEvents="none" />}

      {(tool === 'row' || tool === 'multirow') && anchor && ghosts && focusId && ghostSeats.length <= 500 && (
        <g>
          <circle cx={anchor[0]} cy={anchor[1]} r={seatRadius * 1.125} fill="none" stroke="#16a34a" strokeWidth={2.5} />
          {ghostSeats.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={seatRadius * 0.75} fill={s.ok ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.45)'} stroke={s.ok ? '#16a34a' : '#dc2626'} strokeWidth={seatRadius * 0.18} strokeDasharray={`${seatRadius * 0.4} ${seatRadius * 0.4}`} />
          ))}
          <text x={anchor[0] + 14} y={anchor[1] - 10} className="lbl">
            jangkar baris ({ghostSeats.filter((s) => s.ok).length} valid · {ghostSeats.filter((s) => !s.ok).length} ditolak)
          </text>
        </g>
      )}
      {(tool === 'row' || tool === 'multirow') && anchor && ghosts && focusId && ghostSeats.length > 500 && (
        <g>
          <circle cx={anchor[0]} cy={anchor[1]} r={seatRadius * 1.125} fill="none" stroke="#16a34a" strokeWidth={2.5} />
          <text x={anchor[0] + 14} y={anchor[1] - 10} className="lbl">
            jangkar baris ({ghostSeats.filter((s) => s.ok).length} valid · {ghostSeats.filter((s) => !s.ok).length} ditolak)
          </text>
        </g>
      )}
    </svg>
    {mountCanvas && (
      <SeatCanvas ref={seatCanvasRef} vb={vb} baseRev={baseRev}
        overlayRev={overlayRev}
        buildBase={buildSeatBase} buildOverlay={buildSeatOverlay}
        simpleDots={lod.level === 'dot'} label="editor" />
    )}
    <div ref={tooltipRef} role="status" aria-live="polite"
      style={{ display: 'none', position: 'absolute', left: 0, top: 0, pointerEvents: 'none', background: '#0f172a', color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 6, zIndex: 5 }} />
    <div ref={liveRef} aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }} />
    {isShapeTool(tool) && (
      <div className="shape-hint" role="status"
        style={{ position: 'absolute', left: 12, bottom: 12, pointerEvents: 'none', background: 'rgba(15,23,42,0.85)', color: '#fff', fontSize: 12, padding: '4px 10px', borderRadius: 6 }}>
        {ghost ? 'Klik lagi untuk membuat · Esc untuk batal' : 'Klik titik awal di kanvas'}
      </div>
    )}
    </div>
    <div className="editor-camera" role="toolbar" aria-label="Navigasi kanvas">
      <button aria-label="Perbesar kanvas" title="Perbesar" onClick={() => zoom(0.8)}><Plus size={18} aria-hidden="true" /></button>
      <button aria-label="Perkecil kanvas" title="Perkecil" onClick={() => zoom(1.25)}><Minus size={18} aria-hidden="true" /></button>
      <button aria-label="Pas di layar" title="Pas di layar" onClick={() => fit()}><Maximize size={18} aria-hidden="true" /></button>
    </div>
    </>
  );
}

/**
 * Overlay hover sebaris (SVG-mode, perilaku lama): seluruh kursi dalam baris
 * yang sama dengan kursi hover mendapat cincin amber. Hanya dirender untuk
 * baris yang sedang di-hover (bukan seluruh scene).
 */
function RowHoverRings({ index, seatId }: { index: ReturnType<typeof getDocIndex>; seatId: string }) {
  const entry = index.seatById.get(seatId);
  if (!entry) return null;
  const rowObj = index.objectById.get(entry.objId);
  if (!rowObj) return null;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {rowObj.seats.map((s) => (
        <circle key={`hover-${s.id}`} cx={s.x} cy={s.y} r={(s.radius ?? 8) * 1.25}
          fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      ))}
    </g>
  );
}

/** Cincin seleksi (SVG-mode): hanya kursi terpilih dalam baris ini yang dirender. */
function SeatSelectedRings({ index, ids, focusId, rowId }: { index: ReturnType<typeof getDocIndex>; ids: string[]; focusId: string | null; rowId: string }) {
  if (ids.length === 0) return null;
  const rings: React.ReactNode[] = [];
  for (const id of ids) {
    const entry = index.seatById.get(id);
    if (!entry || entry.objId !== rowId) continue;
    if (focusId && entry.seat.sectionId !== focusId) continue;
    const s = entry.seat;
    rings.push(
      <circle key={`sel-${id}`} cx={s.x} cy={s.y} r={(s.radius ?? 8) * 1.25} fill="none"
        stroke="#1d4ed8" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />,
    );
  }
  if (rings.length === 0) return null;
  return <g pointerEvents="none" aria-hidden="true">{rings}</g>;
}

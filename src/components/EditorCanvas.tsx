import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, Maximize } from 'lucide-react';
import type { Pt, VenueObject } from '../lib/venue';
import { uid } from '../lib/venue';
import { fitViewBox, toWorld, viewBoxStr } from '../lib/camera';
import type { ViewBox } from '../lib/camera';
import { sectionGeomFor } from '../lib/contain';
import { sectionColorById } from '../lib/sectionColor';
import { bboxOf, toPointsString, translatePoints } from '../lib/geometry';
import { useStore } from '../store';

export const STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  pick: '#3b82f6',
  book: '#f59e0b',
  taken: '#9ca3af',
};

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
}

function translateObj(o: VenueObject, dx: number, dy: number): VenueObject {
  const moved = {
    ...o,
    points: translatePoints(o.points, dx, dy),
    seats: o.seats.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
  };
  // vektor disimpan dalam unit path: geser balik ke unit path
  if (o.vTransform && o.vTransform.scale !== 0) {
    moved.vTransform = {
      tx: o.vTransform.tx + dx / o.vTransform.scale,
      ty: o.vTransform.ty + dy / o.vTransform.scale,
      scale: o.vTransform.scale,
    };
  }
  return moved;
}

export default function EditorCanvas({ hoveredObjectId, rowDrag, onRowDrag, onRowRelease, onCancelRowDrag, focusId, onFocusSection, seatRadius, anchor, onAnchor, showBg, ghosts, aisleWidth }: Props) {
  const { state, update, select, selectSeats } = useStore();
  const { doc, tool, selectedId, selectedSeatIds } = state;
  const selectedSeatSet = useMemo(() => new Set(selectedSeatIds), [selectedSeatIds]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasHoverId, setCanvasHoverId] = useState<string | null>(null);
  const [hoverSeatId, setHoverSeatId] = useState<string | null>(null);
  const rowGesture = useRef<{ start: Pt; clientX: number; clientY: number; pointerId: number; dragged: boolean } | null>(null);
  useEffect(() => { rowGesture.current = null; seatGesture.current = null; setSeatMarquee(null); onCancelRowDrag(); setCanvasHoverId(null); setHoverSeatId(null); }, [tool, focusId, onCancelRowDrag]);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [drag, setDrag] = useState<
    | { id: string; vertex: number; orig: VenueObject; start: Pt }
    | { id: string; vertex: -1; orig: VenueObject; start: Pt }
    | null
  >(null);
  const [previewObj, setPreviewObj] = useState<VenueObject | null>(null);
  const [scaleDrag, setScaleDrag] = useState<{ id: string; orig: VenueObject; cx: number; cy: number; d0: number } | null>(null);
  const [vecBox, setVecBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [seatMarquee, setSeatMarquee] = useState<{ start: Pt; end: Pt } | null>(null);
  const seatGesture = useRef<{ start: Pt; clientX: number; clientY: number; pointerId: number; additive: boolean } | null>(null);
  const selVecRef = useRef<SVGGElement>(null);
  // Kamera: viewBox mengikuti aspek kontainer (tak ada letterbox). World = unit doc.
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: doc.width, h: doc.height });
  const savedVenueView = useRef<ViewBox | null>(null);
  const previousFocus = useRef<string | null>(null);
  const pan = useRef<{ x: number; y: number; vb: ViewBox } | null>(null);
  const focused = doc.objects.find(o => o.id === focusId);
  const sectionColor = (id: string): string => sectionColorById(doc.objects, id);
  const focusGeom = useMemo(() => focused ? sectionGeomFor(focused) : null, [focused]);
  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (focusGeom) {
      const box = bboxOf(focusGeom.rings.flat());
      if (!box) return;
      setVb(fitViewBox(r.width, r.height, box.w * 1.3, box.h * 1.3, box.cx, box.cy));
    } else setVb(fitViewBox(r.width, r.height, doc.width, doc.height));
  }, [focusGeom, doc.width, doc.height]);
  const fitRef = useRef(fit);
  useEffect(() => { fitRef.current = fit; }, [fit]);
  useEffect(() => {
    if (previousFocus.current === focusId) return;
    if (focusId && !previousFocus.current) savedVenueView.current = vb;
    if (!focusId && savedVenueView.current) setVb(savedVenueView.current);
    else fitRef.current();
    previousFocus.current = focusId;
    setDraft([]); setGhost(null); setDrag(null); setPreviewObj(null); setScaleDrag(null);
    setSeatMarquee(null); seatGesture.current = null;
    selectSeats([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.width, doc.height]);
  const zoom = useCallback((factor: number, fx = 0.5, fy = 0.5) => {
    setVb(v => {
      const width = Math.max(2, Math.min(doc.width * 4, v.w * factor));
      const k = width / v.w;
      return { x: v.x + v.w * fx * (1 - k), y: v.y + v.h * fy * (1 - k), w: width, h: v.h * k };
    });
  }, [doc.width]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (rowGesture.current) return;
      zoom(Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.005), (e.clientX-r.left)/r.width, (e.clientY-r.top)/r.height);
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [zoom]);
  const selected = doc.objects.find((o) => o.id === selectedId) ?? null;

  // ukur bbox vektor terpilih (koordinat path) -> konversi ke kanvas
  useEffect(() => {
    setVecBox(null);
    if (selected?.kind !== 'vector' || !selected.d || !selected.vTransform) return;
    const g = selVecRef.current;
    if (!g) return;
    try {
      const path = g.querySelector('path');
      if (!path) return;
      const b = (path as unknown as SVGGraphicsElement).getBBox();
      const t = selected.vTransform;
      setVecBox({
        x: t.tx + b.x * t.scale,
        y: t.ty + b.y * t.scale,
        w: b.width * t.scale,
        h: b.height * t.scale,
      });
    } catch {
      setVecBox(null);
    }
  }, [selected]);

  const toSvgCb = useCallback((e: React.PointerEvent<SVGSVGElement>): Pt | null => {
    if (!svgRef.current) return null;
    const r = svgRef.current.getBoundingClientRect();
    return toWorld(e.clientX, e.clientY, r, vb);
  }, [vb]);

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

  // keyboard: Enter tutup polygon, Esc batal, Delete hapus (kursi dulu, baru objek)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === 'Enter' && draft.length >= 3) commitPolygon(draft);
      if (e.key === 'Escape') {
        rowGesture.current = null;
        seatGesture.current = null;
        setSeatMarquee(null);
        onCancelRowDrag();
        setDraft([]);
        setGhost(null);
        onAnchor(null);
        selectSeats([]);
        select(null);
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
  }, [draft, commitPolygon, selectedId, selectedSeatIds, update, select, selectSeats, onAnchor, onCancelRowDrag, focusId]);

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || (e.button === 0 && (e.altKey || tool === 'hand'))) {
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      pan.current = { x: e.clientX, y: e.clientY, vb }; return;
    }
    if (e.button !== 0) return;
    const p = toSvgCb(e);
    if (!p) return;
    if (tool === 'polygon') {
      setDraft((d) => [...d, p]);
      return;
    }
    if (tool === 'row') {
      e.currentTarget.setPointerCapture(e.pointerId);
      rowGesture.current = { start:p, clientX:e.clientX, clientY:e.clientY, pointerId:e.pointerId, dragged:false };
      onAnchor(p);
      return;
    }
    if (tool === 'seat' && focusId) {
      e.currentTarget.setPointerCapture(e.pointerId);
      seatGesture.current = {
        start: p, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
      };
      setSeatMarquee({ start: p, end: p });
      return;
    }
    if (tool === 'stage' || tool === 'aisle' || tool === 'rectangle' || tool === 'circle') {
      const kind: Ghost['kind'] =
        tool === 'stage' ? 'stage'
        : tool === 'aisle' ? 'aisle'
        : tool === 'rectangle' ? 'rect'
        : 'circle';
      setGhost({ kind, a: p, b: p });
      return;
    }
    select(null);
    if (focusId) selectSeats([]);
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pan.current) {
      const r = e.currentTarget.getBoundingClientRect(), start = pan.current;
      setVb({ ...start.vb, x: start.vb.x - (e.clientX-start.x)*start.vb.w/r.width, y: start.vb.y - (e.clientY-start.y)*start.vb.h/r.height });
      return;
    }
    const p = toSvgCb(e);
    if (!p) return;
    const gesture = rowGesture.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - gesture.clientX, e.clientY - gesture.clientY) >= 5) gesture.dragged = true;
      if (gesture.dragged) onRowDrag(gesture.start, p);
      return;
    }
    const sg = seatGesture.current;
    if (sg && sg.pointerId === e.pointerId) {
      setSeatMarquee({ start: sg.start, end: p });
      return;
    }
    if (ghost) {
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
          vTransform: { tx: scaleDrag.cx - ux * s2, ty: scaleDrag.cy - uy * s2, scale: s2 },
        });
      }
      return;
    }
    if (!drag) return;
    const dx = p[0] - drag.start[0];
    const dy = p[1] - drag.start[1];
    if (drag.vertex >= 0) {
      const pts = drag.orig.points.slice();
      pts[drag.vertex] = [drag.orig.points[drag.vertex][0] + dx, drag.orig.points[drag.vertex][1] + dy];
      setPreviewObj({ ...drag.orig, points: pts });
    } else {
      setPreviewObj(translateObj(drag.orig, dx, dy));
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const gesture = rowGesture.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      rowGesture.current = null;
      const end = toSvgCb(e);
      const moved = Math.hypot(e.clientX - gesture.clientX, e.clientY - gesture.clientY) >= 5;
      if (end && (gesture.dragged || moved)) onRowRelease(gesture.start, end);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const sg2 = seatGesture.current;
    if (sg2 && sg2.pointerId === e.pointerId) {
      seatGesture.current = null;
      const end = toSvgCb(e) ?? seatMarquee?.end ?? sg2.start;
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
        const inside = doc.objects
          .filter((o) => !focusId || o.id === focusId || o.sectionId === focusId || o.seats.some((s) => s.sectionId === focusId))
          .flatMap((o) => o.seats)
          .filter((s) => (!focusId || s.sectionId === focusId) && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1)
          .map((s) => s.id);
        if (sg2.additive) {
          const merged = new Set(selectedSeatIds);
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
    if (pan.current) { pan.current = null; return; }
    if (ghost) {
      const { a, b } = ghost;
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      if ((ghost.kind === 'rect' && w > 10 && h > 10) || (ghost.kind === 'circle' && Math.hypot(w, h) > 10)) {
        const x = Math.min(a[0], b[0]);
        const y = Math.min(a[1], b[1]);
        const r = Math.hypot(w, h) / 2;
        const cx = (a[0] + b[0]) / 2;
        const cy = (a[1] + b[1]) / 2;
        const d = ghost.kind === 'circle'
          ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
          : `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
        const obj: VenueObject = {
          id: uid('obj'), kind: 'vector', shape: ghost.kind === 'circle' ? 'circle' : 'rect',
          label: ghost.kind === 'circle' ? `Lingkaran ${doc.objects.length + 1}` : `Kotak ${doc.objects.length + 1}`,
          points: [], d, closed: true, width: 28, price: 0, rowParams: null, seats: [],
          vTransform: { tx: 0, ty: 0, scale: 1 }, svgFill: '#93c5fd',
          svgStroke: { color: '#3b82f6', width: 2 },
          source: { origin: 'canvas', confidence: 1 }, guess: null,
        };
        update((doc) => ({ ...doc, objects: [...doc.objects, obj] }));
        select(obj.id);
      } else if (ghost.kind === 'stage' && w > 10 && h > 10) {
        const x0 = Math.min(a[0], b[0]);
        const y0 = Math.min(a[1], b[1]);
        const obj: VenueObject = {
          id: uid('obj'), kind: 'stage', label: 'Panggung',
          points: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]],
          closed: true, width: 28, price: 0, rowParams: null, seats: [],
          source: { origin: 'canvas', confidence: 1 }, guess: null,
        };
        update((d) => ({ ...d, objects: [...d.objects, obj] }));
        select(obj.id);
      } else if (ghost.kind === 'aisle' && Math.hypot(w, h) > 10) {
        const obj: VenueObject = {
          id: uid('obj'), kind: 'aisle', label: 'Lorong',
          points: [a, b], closed: false, width: aisleWidth, price: 0, rowParams: null, seats: [],
          source: { origin: 'canvas', confidence: 1 }, guess: null,
        };
        update((d) => ({ ...d, objects: [...d.objects, obj] }));
        select(obj.id);
      }
      setGhost(null);
      return;
    }
    if (drag && previewObj) {
      const done = previewObj;
      update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === done.id ? done : o)) }));
    }
    if (scaleDrag && previewObj) {
      const done = previewObj;
      update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === done.id ? done : o)) }));
      setVecBox(null);
    }
    setDrag(null);
    setScaleDrag(null);
    setPreviewObj(null);
  };

  const ghostSeats = ghosts ?? [];

  const rendered = previewObj
    ? doc.objects.map((o) => (o.id === previewObj.id ? previewObj : o))
    : doc.objects;
  // Mode venue: JANGAN render kelompok baris/kursi sama sekali (bukan CSS hide).
  // Hanya section + objek venue relevan. Kursi section aktif dirender setelah masuk.
  const visible = focusId
    ? rendered.filter(o => o.id === focusId || o.sectionId === focusId || o.seats.some(s => s.sectionId === focusId))
    : rendered.filter(o => o.kind !== 'row-straight' && o.kind !== 'row-arc');

  const ptsStr = toPointsString;

  return (
    <>
    <svg
      onPointerLeave={() => { setCanvasHoverId(null); setHoverSeatId(null); }}
      ref={svgRef}
      viewBox={viewBoxStr(vb)}
      className={tool === 'hand' ? 'canvas hand-tool' : 'canvas'}
      aria-label={focusId ? 'Editor isi section' : 'Editor venue'}
      tabIndex={0}
      onKeyDown={e => {
        const steps: Record<string, [number, number]> = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
        const step = steps[e.key];
        if (rowGesture.current) return;
        if (step) { e.preventDefault(); setVb(v => ({ ...v, x:v.x + step[0]*v.w*0.1, y:v.y + step[1]*v.h*0.1 })); }
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
      onLostPointerCapture={() => { pan.current = null; if (rowGesture.current) { rowGesture.current = null; onCancelRowDrag(); } seatGesture.current = null; setSeatMarquee(null); }}
      onPointerCancel={() => { rowGesture.current = null; seatGesture.current = null; setSeatMarquee(null); onCancelRowDrag(); pan.current = null; setDrag(null); setGhost(null); setPreviewObj(null); }}
      onDoubleClick={() => {
        if (draft.length >= 3) commitPolygon(draft);
      }}
    >
      <style>{`.canvas .lbl { font-size: ${Math.min(15, vb.w / 70)}px; }`}</style>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e7eb" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#ffffff" />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#grid)" />
      {!focusId && showBg && doc.backgroundImage && (
        <image href={doc.backgroundImage} x={0} y={0} width={doc.width} height={doc.height} opacity={0.45} preserveAspectRatio="none" />
      )}

      {visible.map((o) => {
        const isSel = o.id === selectedId;
        const objectHoverEvents = {
          onPointerEnter: () => { if (tool === 'select' && !drag && !scaleDrag && !pan.current) setCanvasHoverId(o.id); },
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
            if (tool !== 'select' || e.button !== 0 || e.altKey) return;
            e.stopPropagation();
            select(o.id);
            if (o.id === focusId) return;
            svgRef.current?.setPointerCapture(e.pointerId);
            const svg = svgRef.current;
            if (!svg) return;
            const r = svg.getBoundingClientRect();
            const p: Pt = toWorld(e.clientX, e.clientY, r, vb);
            setDrag({ id: o.id, vertex: -1, orig: o, start: p });
          },
        };
        if (o.kind === 'vector' && o.d && o.vTransform) {
          const t = o.vTransform;
          const st = o.svgStroke ?? null;
          const selStyle = isSel ? { stroke: '#2563eb', strokeWidth: 2.5 / t.scale } : {};
          const secColor = o.isSection ? sectionColor(o.id) : null;
          return (
            <g key={o.id} {...sectionEvents} aria-label={o.label}>
              <g
                ref={isSel ? selVecRef : undefined}
                transform={`translate(${t.tx} ${t.ty}) scale(${t.scale})`}
              >
                <path
                  d={o.d}
                  fill={o.svgFill ?? 'black'}
                  fillOpacity={o.svgFillOpacity ?? undefined}
                  vectorEffect="non-scaling-stroke"
                  fillRule={o.svgFillRule ?? 'nonzero'}
                  stroke={st ? st.color : 'none'}
                  strokeWidth={st ? st.width : undefined}
                  strokeLinecap={st?.linecap as 'butt' | 'round' | 'square' | undefined}
                  strokeLinejoin={st?.linejoin as 'miter' | 'round' | 'bevel' | undefined}
                  strokeDasharray={st?.dash}
                  strokeDashoffset={st?.dashOffset}
                  strokeOpacity={st?.opacity}
                  {...selectDrag}
                  style={{ cursor: tool === 'select' ? 'move' : undefined }}
                />
                {isSel && (
                  <path d={o.d} fill="none" stroke="#2563eb" strokeWidth={2.5 / t.scale} pointerEvents="none" style={selStyle} />
                )}
                {secColor && (
                  <path d={o.d} fill={secColor} fillOpacity={0.25} fillRule={o.svgFillRule ?? 'nonzero'}
                    stroke={secColor} strokeWidth={1.5 / t.scale} strokeOpacity={0.9} pointerEvents="none" />
                )}
              </g>
            </g>
          );
        }
        const selStyle = isSel ? { stroke: '#2563eb', strokeWidth: 3 } : {};
        if (o.kind === 'aisle') {
          return (
            <g key={o.id} {...sectionEvents} aria-label={o.label}>
              <polyline points={ptsStr(o.points)} fill="none" stroke="#94a3b8" strokeWidth={o.width} strokeLinecap="round" opacity={0.8} {...selectDrag} style={selStyle} />
            </g>
          );
        }
        if (o.kind === 'row-straight' || o.kind === 'row-arc') {
          const seatInteractive = !!focusId && tool === 'seat';
          return (
            <g key={o.id} {...objectHoverEvents} {...(seatInteractive ? {} : selectDrag)} aria-label={`${o.label} (${o.seats.length} kursi)`}>
              {o.points[0] && <circle cx={o.points[0][0]} cy={o.points[0][1]} r={o.seats[0]?.radius ?? 8} fill="none" stroke={isSel ? '#2563eb' : '#64748b'} strokeWidth={(o.seats[0]?.radius ?? 8) / 4} strokeDasharray="4 3" />}
              {o.seats.map((s) => {
                const secId = s.sectionId ?? o.sectionId ?? focusId ?? '';
                const fill = s.invalid ? '#dc2626' : sectionColor(secId);
                const dimmed = !s.invalid && (s.status === 'taken' || s.status === 'book');
                return (
                <circle key={s.id} cx={s.x} cy={s.y} r={(s.radius ?? 8) * 0.875} fill={fill} opacity={dimmed ? 0.45 : 0.9}
                  onPointerEnter={() => { if (seatInteractive) setHoverSeatId(s.id); }}
                  onPointerLeave={() => setHoverSeatId(null)}
                  style={seatInteractive ? { cursor: 'pointer' } : undefined}
                  onPointerDown={seatInteractive ? (e) => {
                    if (e.button !== 0 || e.altKey) return;
                    e.stopPropagation();
                    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                    if (additive) {
                      const next = new Set(selectedSeatIds);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      selectSeats([...next]);
                    } else {
                      selectSeats([s.id]);
                    }
                    // cegah marquee mulai dari lingkaran kursi
                    seatGesture.current = null;
                    setSeatMarquee(null);
                  } : undefined}>
                  <title>{`${s.row}${s.number}`}</title>
                </circle>
                );
              })}
              {seatInteractive && o.seats.filter(s => s.id === hoverSeatId).map(s => (
                <circle key={`hover-${s.id}`} data-hover-seat={s.id} cx={s.x} cy={s.y} r={(s.radius ?? 8) * 1.25}
                  fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              ))}
              {o.seats.filter((s) => selectedSeatSet.has(s.id)).map((s) => (
                <circle key={`sel-${s.id}`} cx={s.x} cy={s.y} r={(s.radius ?? 8) * 1.25} fill="none"
                  stroke="#1d4ed8" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              ))}
            </g>
          );
        }
        const fill = o.isSection
          ? sectionColor(o.id)
          : o.kind === 'stage' ? '#cbd5e1' : o.kind === 'import-draft' ? 'rgba(251,191,36,0.35)' : 'rgba(147,197,253,0.35)';
        const fillOpacity = o.isSection ? 0.18 : undefined;
        const stroke = o.isSection ? sectionColor(o.id) : o.kind === 'import-draft' ? '#dc2626' : o.kind === 'stage' ? '#475569' : '#3b82f6';
        return (
          <g key={o.id} {...sectionEvents} aria-label={o.label}>
            <polygon vectorEffect="non-scaling-stroke" points={ptsStr(o.points)} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={isSel ? 3 : 2} strokeDasharray={o.kind === 'import-draft' && !o.isSection ? '10 6' : undefined} {...selectDrag} style={selStyle} />
          </g>
        );
      })}

      {(() => {
        const effectiveHoverId = tool === 'select' ? canvasHoverId ?? hoveredObjectId : hoveredObjectId;
        const hovered = visible.find(o => o.id === effectiveHoverId);
        if (!hovered) return null;
        // Jangan pernah munculkan kursi tersembunyi venue lewat highlight panel.
        if (!focusId && (hovered.kind === 'row-straight' || hovered.kind === 'row-arc')) return null;
        const style = { stroke: '#f59e0b', strokeWidth: 3, vectorEffect: 'non-scaling-stroke' as const };
        let outline;
        if (hovered.kind === 'vector' && hovered.d && hovered.vTransform) {
          outline = <path d={hovered.d} transform={`translate(${hovered.vTransform.tx} ${hovered.vTransform.ty}) scale(${hovered.vTransform.scale})`}
            fill="rgba(245,158,11,0.16)" fillRule={hovered.svgFillRule ?? 'nonzero'} {...style} />;
        } else if (hovered.kind === 'aisle') {
          outline = <polyline points={ptsStr(hovered.points)} fill="none" stroke="#f59e0b" strokeWidth={hovered.width + vb.w / 180} strokeLinecap="round" opacity={0.6} />;
        } else if (hovered.kind.startsWith('row')) {
          outline = hovered.seats.map(seat => <circle key={seat.id} cx={seat.x} cy={seat.y} r={(seat.radius ?? 8) * 1.2} fill="rgba(245,158,11,0.16)" {...style} />);
        } else {
          outline = <polygon points={ptsStr(hovered.points)} fill="rgba(245,158,11,0.16)" {...style} />;
        }
        return <g data-highlight-object={hovered.id} pointerEvents="none" aria-hidden="true">{outline}</g>;
      })()}

      {selected && selected.id !== focusId && visible.find((o) => o.id === selected.id) && (selected.kind !== 'row-straight' && selected.kind !== 'row-arc') && (
        <g>
          {(previewObj?.id === selected.id ? previewObj.points : selected.points).map((p, i) => (
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
                const sp: Pt = toWorld(e.clientX, e.clientY, r, vb);
                setDrag({ id: selected.id, vertex: i, orig: selected, start: sp });
              }}
            />
          ))}
        </g>
      )}

      {selected?.id !== focusId && selected?.kind === 'vector' && vecBox && tool === 'select' && (() => {
        // vecBox diukur sekali saat seleksi; saat shape digeser/di-scale (previewObj),
        // tampilkan kotak mengikuti transform preview agar garis putus-putus ikut gerak.
        const t0 = selected.vTransform;
        const t1 = previewObj?.id === selected.id ? previewObj.vTransform : t0;
        let dx = vecBox;
        if (t0 && t1 && (t1.tx !== t0.tx || t1.ty !== t0.ty || t1.scale !== t0.scale)) {
          const k = t0.scale !== 0 ? t1.scale / t0.scale : 1;
          dx = {
            x: t1.tx + (vecBox.x - t0.tx) * k,
            y: t1.ty + (vecBox.y - t0.ty) * k,
            w: vecBox.w * k,
            h: vecBox.h * k,
          };
        }
        const cx = dx.x + dx.w / 2;
        const cy = dx.y + dx.h / 2;
        const S = 12;
        const corners: Array<[number, number]> = [
          [dx.x, dx.y],
          [dx.x + dx.w, dx.y],
          [dx.x, dx.y + dx.h],
          [dx.x + dx.w, dx.y + dx.h],
        ];
        return (
          <g>
            <rect x={dx.x} y={dx.y} width={dx.w} height={dx.h} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />
            {corners.map(([px, py], i) => (
              <rect
                key={i}
                x={px - S / 2} y={py - S / 2} width={S} height={S} fill="#fff" stroke="#2563eb" strokeWidth={2} className="vh"
                style={{ cursor: 'nwse-resize' }}
                onPointerDown={(e) => {
                  if (!selected.vTransform) return;
                  e.stopPropagation();
                  const base = previewObj?.id === selected.id ? previewObj : selected;
                  setScaleDrag({ id: selected.id, orig: base, cx, cy, d0: Math.max(Math.hypot(px - cx, py - cy), 4) });
                }}
              />
            ))}
          </g>
        );
      })()}

      {/* Objek points (section/polygon/stage/aisle/draf) sengaja TANPA kotak bbox:
          seleksi hanya mengikuti shape polygon + vertex bulat agar tidak ganda. */}

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
        ghost.kind === 'circle'
          ? <circle cx={(ghost.a[0] + ghost.b[0]) / 2} cy={(ghost.a[1] + ghost.b[1]) / 2} r={Math.hypot(ghost.b[0] - ghost.a[0], ghost.b[1] - ghost.a[1]) / 2} fill="rgba(147,197,253,0.35)" stroke="#3b82f6" strokeDasharray="6 4" pointerEvents="none" />
          : ghost.kind === 'stage' || ghost.kind === 'rect'
          ? <rect x={Math.min(ghost.a[0], ghost.b[0])} y={Math.min(ghost.a[1], ghost.b[1])} width={Math.abs(ghost.b[0] - ghost.a[0])} height={Math.abs(ghost.b[1] - ghost.a[1])} fill={ghost.kind === 'stage' ? 'rgba(100,116,139,0.4)' : 'rgba(147,197,253,0.35)'} stroke={ghost.kind === 'stage' ? '#475569' : '#3b82f6'} strokeDasharray="6 4" />
          : <line x1={ghost.a[0]} y1={ghost.a[1]} x2={ghost.b[0]} y2={ghost.b[1]} stroke="#94a3b8" strokeWidth={aisleWidth} strokeLinecap="round" opacity={0.6} />
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

      {tool === 'row' && anchor && ghosts && focusId && (
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
    </svg>
    <div className="editor-camera" role="toolbar" aria-label="Navigasi kanvas">
      <button aria-label="Perbesar kanvas" title="Perbesar" onClick={() => zoom(0.8)}><Plus size={18} aria-hidden="true" /></button>
      <button aria-label="Perkecil kanvas" title="Perkecil" onClick={() => zoom(1.25)}><Minus size={18} aria-hidden="true" /></button>
      <button aria-label="Pas di layar" title="Pas di layar" onClick={fit}><Maximize size={18} aria-hidden="true" /></button>
    </div>
    </>
  );
}

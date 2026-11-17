import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, Maximize } from 'lucide-react';
import type { Pt, VenueObject } from '../lib/venue';
import { uid } from '../lib/venue';
import { fitViewBox, toWorld, viewBoxStr } from '../lib/camera';
import { getGridLevels, minorOpacity } from '../lib/grid';
import type { ViewBox } from '../lib/camera';
import { resolvedPoints, sectionGeomFor, shapeCenter, vectorCanvasCenter } from '../lib/contain';
import { categoryColorForSection } from '../lib/categories';
import { bboxOf, normalizeAngle, rotatePoints, rotateShapeBy, rotationOf, toPointsString, translatePoints } from '../lib/geometry';
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
      ...(o.vTransform.rotation ? { rotation: o.vTransform.rotation } : null),
    };
  }
  return moved;
}

export default function EditorCanvas({ hoveredObjectId, rowDrag, onRowDrag, onRowRelease, onRowHover, onRowTapCommit, onCancelRowDrag, focusId, onFocusSection, seatRadius, anchor, onAnchor, showBg, ghosts, aisleWidth }: Props) {
  const { state, update, select, selectSeats, setTool } = useStore();
  const { doc, tool, selectedId, selectedSeatIds } = state;
  const selectedSeatSet = useMemo(() => new Set(selectedSeatIds), [selectedSeatIds]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasHoverId, setCanvasHoverId] = useState<string | null>(null);
  const [hoverSeatId, setHoverSeatId] = useState<string | null>(null);
  const rowGesture = useRef<{ start: Pt; clientX: number; clientY: number; pointerId: number; dragged: boolean; hadAnchor: boolean } | null>(null);
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
  /** Drag gagang putar: putar preview terhadap (cx,cy); commit saat pointerup. */
  const [rotateDrag, setRotateDrag] = useState<{ id: string; orig: VenueObject; cx: number; cy: number; startAngle: number; delta: number } | null>(null);
  const [vecBox, setVecBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [seatMarquee, setSeatMarquee] = useState<{ start: Pt; end: Pt } | null>(null);
  const seatGesture = useRef<{ start: Pt; clientX: number; clientY: number; pointerId: number; additive: boolean } | null>(null);
  /** Tap terakhir di kursi (untuk bedakan klik tunggal vs ganda). */
  const seatTap = useRef<{ id: string; t: number } | null>(null);
  const selVecRef = useRef<SVGGElement>(null);
  // Kamera: viewBox mengikuti aspek kontainer (tak ada letterbox). World = unit doc.
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: doc.width, h: doc.height });
  const savedVenueView = useRef<ViewBox | null>(null);
  const previousFocus = useRef<string | null>(null);
  const pan = useRef<{ x: number; y: number; vb: ViewBox } | null>(null);
  const focused = doc.objects.find(o => o.id === focusId);
  const sectionColor = (id: string): string => categoryColorForSection(doc.objects, doc.categories, id);
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
    setDraft([]); setGhost(null); setDrag(null); setPreviewObj(null); setScaleDrag(null); setRotateDrag(null);
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

  // keyboard: Enter tutup polygon, Esc batal dulu lalu pindah ke Select (seperti V), Delete hapus (kursi dulu, baru objek)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === 'Enter' && draft.length >= 3) commitPolygon(draft);
      if (e.key === 'Escape') {
        const hadWork = draft.length > 0 || ghost !== null || drag !== null
          || previewObj !== null || scaleDrag !== null || rotateDrag !== null
          || seatMarquee !== null || rowGesture.current !== null || seatGesture.current !== null
          || rowDrag !== null || anchor !== null || selectedId !== null || selectedSeatIds.length > 0;
        rowGesture.current = null;
        seatGesture.current = null;
        setSeatMarquee(null);
        onCancelRowDrag();
        setDraft([]);
        setGhost(null);
        setRotateDrag(null);
        setPreviewObj(null);
        onAnchor(null);
        selectSeats([]);
        select(null);
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
      const hadAnchor = anchor !== null;
      rowGesture.current = { start:p, clientX:e.clientX, clientY:e.clientY, pointerId:e.pointerId, dragged:false, hadAnchor };
      // Klik pertama memasang jangkar; klik berikutnya (ada jangkar) diurus
      // saat pointerup: tap = commit, seret = mulai ulang dari titik tekan.
      if (!hadAnchor) onAnchor(p);
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
    // Hover preview baris tunggal: kursor tanpa tombol = ujung preview.
    if (tool === 'row' && focusId && e.buttons === 0 && !scaleDrag && !rotateDrag && !drag && !ghost) {
      onRowHover(p);
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
    const dx = p[0] - drag.start[0];
    const dy = p[1] - drag.start[1];
    if (drag.vertex >= 0) {
      // Vertex ditampilkan terputar; delta pointer (kanvas) diputar balik
      // agar tersimpan ke base points yang benar.
      const rot = rotationOf(drag.orig);
      let ddx = dx;
      let ddy = dy;
      if (rot !== 0) {
        const r = rotatePoints([[dx, dy]], -rot, 0, 0)[0];
        ddx = r[0];
        ddy = r[1];
      }
      const pts = drag.orig.points.slice();
      pts[drag.vertex] = [drag.orig.points[drag.vertex][0] + ddx, drag.orig.points[drag.vertex][1] + ddy];
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
      else if (end && gesture.hadAnchor) onRowTapCommit(end);
      // Tap pertama tanpa jangkar: jangkar sudah dipasang saat pointerdown,
      // biarkan terpasang untuk preview hover.
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
    // Rotate: commit hanya bila sudut berubah (delta 0 = tak ada undo baru).
    if (rotateDrag && previewObj && rotateDrag.delta !== 0) {
      const done = previewObj;
      update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === done.id ? done : o)) }));
      if (done.kind === 'vector') setVecBox(null);
    }
    setDrag(null);
    setScaleDrag(null);
    setRotateDrag(null);
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

  // Infinite grid ala Miro: major tegas + minor berbayang, bertukar peran saat zoom.
  // Level dihitung dari vb.w agar kerapatan layar selalu nyaman (~16..80px).
  const grid = useMemo(() => getGridLevels(vb.w), [vb.w]);
  const gridMinorOp = minorOpacity(grid.minorAlpha);

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
      onPointerCancel={() => { rowGesture.current = null; seatGesture.current = null; setSeatMarquee(null); onCancelRowDrag(); pan.current = null; setDrag(null); setScaleDrag(null); setRotateDrag(null); setGhost(null); setPreviewObj(null); }}
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
          const rot = t.rotation ?? 0;
          const rc = Number.isFinite(rot) && rot !== 0 ? (vectorCenters.get(o.id) ?? vectorCanvasCenter(o)) : null;
          // Section vector memakai bahasa visual yang sama dengan polygon
          // section: fill warna identitas + outline, bukan fill dekorasi solid.
          const fill = secColor ?? o.svgFill ?? 'black';
          const fillOpacity = secColor ? 0.18 : o.svgFillOpacity ?? undefined;
          const stroke = secColor ?? (st ? st.color : 'none');
          const strokeWidth = secColor ? 2 / t.scale : st ? st.width : undefined;
          return (
            <g key={o.id} {...sectionEvents} aria-label={o.label}>
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
                  {...selectDrag}
                  style={{ cursor: tool === 'select' ? 'move' : undefined }}
                />
                {isSel && (
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
          const seatInteractive = !!focusId && tool === 'seat';
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
                      seatTap.current = null;
                    } else {
                      // Klik tunggal = seluruh barisnya; klik ganda cepat = 1 kursi itu saja.
                      const now = Date.now();
                      const last = seatTap.current;
                      if (last && last.id === s.id && now - last.t < 400) {
                        seatTap.current = null;
                        selectSeats([s.id]);
                      } else {
                        seatTap.current = { id: s.id, t: now };
                        selectSeats(o.seats.map((x) => x.id));
                      }
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
        const prot = rotationOf(o);
        const prc = prot !== 0 ? shapeCenter(o) : null;
        return (
          <g key={o.id} {...sectionEvents} aria-label={o.label}
            transform={prc ? `rotate(${prot} ${prc[0]} ${prc[1]})` : undefined}>
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
                  const sp: Pt = toWorld(e.clientX, e.clientY, r, vb);
                  setDrag({ id: selected.id, vertex: i, orig: selected, start: sp });
                }}
              />
            ))}
          </g>
        );
      })()}

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
        // Saat ada rotasi, pusat skala = pusat rotasi (flatten) agar konsisten
        // dengan containment & preview; kotak seleksi ikut diputar.
        const baseForCenter = previewObj?.id === selected.id ? previewObj : selected;
        const rot1 = t1?.rotation ?? 0;
        const rc = Number.isFinite(rot1) && rot1 !== 0 ? vectorCanvasCenter(baseForCenter) : null;
        const cx = rc ? rc[0] : dx.x + dx.w / 2;
        const cy = rc ? rc[1] : dx.y + dx.h / 2;
        const S = 12;
        const corners: Array<[number, number]> = [
          [dx.x, dx.y],
          [dx.x + dx.w, dx.y],
          [dx.x, dx.y + dx.h],
          [dx.x + dx.w, dx.y + dx.h],
        ];
        return (
          <g transform={rc ? `rotate(${rot1} ${rc[0]} ${rc[1]})` : undefined}>
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

      {/* Gagang putar: lingkaran di atas pusat shape terpilih (tool select).
          Seret mengelilingi pusat untuk memutar; Shift = snap 15°; Esc batal. */}
      {selected && tool === 'select' && selected.id !== focusId
        && (selected.kind === 'stage' || selected.kind === 'section'
          || selected.kind === 'import-draft' || selected.kind === 'vector')
        && visible.find((o) => o.id === selected.id) && (() => {
        const target = previewObj?.id === selected.id ? previewObj : selected;
        const active = rotateDrag && rotateDrag.id === selected.id ? rotateDrag : null;
        let box: { x: number; y: number; w: number; h: number } | null = null;
        let cx = 0;
        let cy = 0;
        if (target.kind === 'vector') {
          if (!vecBox || !target.vTransform) return null;
          const t0 = selected.vTransform;
          const t1 = target.vTransform;
          let dx = vecBox;
          if (t0 && (t1.tx !== t0.tx || t1.ty !== t0.ty || t1.scale !== t0.scale)) {
            const k = t0.scale !== 0 ? t1.scale / t0.scale : 1;
            dx = {
              x: t1.tx + (vecBox.x - t0.tx) * k,
              y: t1.ty + (vecBox.y - t0.ty) * k,
              w: vecBox.w * k,
              h: vecBox.h * k,
            };
          }
          box = dx;
          const rc = vectorCenters.get(target.id) ?? vectorCanvasCenter(target);
          cx = rc ? rc[0] : dx.x + dx.w / 2;
          cy = rc ? rc[1] : dx.y + dx.h / 2;
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
                const sp: Pt = toWorld(e.clientX, e.clientY, r, vb);
                const sa = (Math.atan2(sp[1] - cy, sp[0] - cx) * 180) / Math.PI;
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

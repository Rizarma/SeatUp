import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeatStatus } from '../lib/venue';
import { useStore } from '../store';
import { fitViewBox, toWorld, viewBoxStr } from '../lib/camera';
import type { ViewBox } from '../lib/camera';
import { sectionGeomFor, shapeCenter, vectorCanvasCenter } from '../lib/contain';
import { categoryColorForSection, categoryById } from '../lib/categories';
import { bboxOf, rotationOf, toPointsString } from '../lib/geometry';
import { getDocIndex, queryBoxVisible, queryPoint, type SeatRef } from '../lib/docIndex';
import { cullMargin, lodFor, resizePreserveScale } from '../lib/viewTransform';
import SeatCanvas, { type SeatCanvasHandle } from './SeatCanvas';
import type { OverlaySpec, SeatDrawSpec } from '../lib/seatCanvas';
import { CANVAS_SEAT_THRESHOLD } from './EditorCanvas';
import { Plus, Minus, Maximize, ChevronDown, ChevronUp, X, ArrowLeft } from 'lucide-react';

const ORPHAN_ID = '__orphan__';
const ORPHAN_COLOR = '#94a3b3';
const money = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

interface EnrichedSeat {
  id: string;
  row: string;
  number: string;
  x: number;
  y: number;
  radius?: number;
  status: SeatStatus;
  price: number;
  invalid?: boolean;
  section: string;
  sectionId: string;
  color: string;
  categoryId: string | null;
  categoryName: string;
}

export default function Preview() {
  const { state } = useStore();
  const { doc } = state;
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [sim, setSim] = useState<Map<string, SeatStatus>>(new Map());
  const [legendOpen, setLegendOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean; rectW: number; rectH: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: doc.width, h: doc.height });
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const pendingVb = useRef<ViewBox | null>(null);
  const camRaf = useRef(0);
  const savedVenueView = useRef<ViewBox | null>(null);

  const applyVbSync = useCallback((next: ViewBox) => {
    pendingVb.current = null;
    if (camRaf.current !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(camRaf.current);
      camRaf.current = 0;
    }
    vbRef.current = next;
    setVb(next);
  }, []);
  /** Pan/zoom pointer: maksimal 1 setVb per frame, tanpa antrean callback. */
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
  useEffect(() => () => {
    if (camRaf.current !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(camRaf.current);
    if (hoverRaf.current !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(hoverRaf.current);
  }, []);

  // Indeks turunan doc: O(1) bila doc tak berubah (kamera/picks tak membangun ulang).
  const index = getDocIndex(doc);
  const sections = useMemo(() => doc.objects.filter((o) => o.isSection), [doc.objects]);
  const colorOf = (sectionId: string): string => {
    if (!sections.some((o) => o.id === sectionId)) return ORPHAN_COLOR;
    return categoryColorForSection(doc.objects, doc.categories, sectionId);
  };

  // Daftar seat diperkaya: O(seats) dengan lookup map (tanpa find per seat).
  const seats = useMemo<EnrichedSeat[]>(() => {
    const out: EnrichedSeat[] = [];
    for (const o of doc.objects) {
      if (o.seats.length === 0) continue;
      for (const s of o.seats) {
        const owner = (s.sectionId ? index.objectById.get(s.sectionId) : undefined) ?? o;
        const isSec = !!owner.isSection;
        const secId = isSec ? owner.id : ORPHAN_ID;
        out.push({
          ...s,
          section: isSec ? owner.label : 'Tanpa section',
          sectionId: secId,
          color: isSec ? index.sectionColor.get(owner.id) ?? ORPHAN_COLOR : ORPHAN_COLOR,
          categoryId: isSec ? owner.categoryId ?? null : null,
          categoryName: isSec ? (owner.categoryId ? categoryById(doc, owner.categoryId)?.name ?? owner.label : owner.label) : 'Tanpa section',
        });
      }
    }
    return out;
  }, [doc, index]);

  const orphanSeats = useMemo(() => seats.filter((s) => s.sectionId === ORPHAN_ID), [seats]);
  const activeSection = activeId && activeId !== ORPHAN_ID ? sections.find((o) => o.id === activeId) ?? null : null;
  const activeLabel = activeId === ORPHAN_ID ? 'Tanpa section' : activeSection?.label ?? null;
  const visibleSeats = useMemo(() => activeId ? seats.filter((s) => s.sectionId === activeId) : [], [seats, activeId]);
  const seatsAsCanvas = visibleSeats.length > CANVAS_SEAT_THRESHOLD;
  const seatMap = useMemo(() => new Map(visibleSeats.map((s) => [s.id, s])), [visibleSeats]);

  const hoverSeatRef = useRef<EnrichedSeat | null>(null);
  const focusSeatRef = useRef<EnrichedSeat | null>(null);
  // Revisi lapisan dasar kanvas: naik tiap doc/sim berubah.
  const prevBaseRef = useRef<{ doc: typeof doc; sim: Map<string, SeatStatus> } | null>(null);
  const baseRevRef = useRef(0);
  const prevBase = prevBaseRef.current;
  if (!prevBase || prevBase.doc !== doc || prevBase.sim !== sim) {
    prevBaseRef.current = { doc, sim };
    baseRevRef.current += 1;
    hoverSeatRef.current = null;
    focusSeatRef.current = null;
  }

  const hoverRaf = useRef(0);
  const hoverPending = useRef<{ x: number; y: number } | null>(null);
  const seatCanvasRef = useRef<SeatCanvasHandle>(null);
  const canvasTipRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const baseRefs = useRef<SeatRef[]>([]);
  const specPool = useRef<SeatDrawSpec[]>([]);
  // Ukuran CSS untuk LOD + preserve-scale resize (diperbarui saat resize).
  const [cssW, setCssW] = useState(1000);
  const [, setCssH] = useState(700);
  const cssRef = useRef({ w: 1000, h: 700 });
  const lod = lodFor(vb, cssW, 8);

  const picksRef = useRef(picks);
  picksRef.current = picks;
  const simRef = useRef(sim);
  simRef.current = sim;
  // Kait bench (?bench): paparkan picks + subtotal untuk verifikasi identitas preview.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bench')) {
      (window as unknown as { __seatupBenchPicks?: string[] }).__seatupBenchPicks = [...picks];
      const tot = [...picks].reduce((a, id) => a + (seatMap.get(id)?.price ?? 0), 0);
      (window as unknown as { __seatupBenchSubtotal?: number }).__seatupBenchSubtotal = tot;
    }
  }, [picks, seatMap]);

  const eff = useCallback((id: string, base: SeatStatus): SeatStatus => {
    if (picksRef.current.has(id)) return 'pick';
    return simRef.current.get(id) ?? base;
  }, []);

  const toggle = useCallback((id: string, base: SeatStatus, invalid: boolean) => {
    if (invalid || drag.current?.moved) return;
    setConfirmed(false);
    const cur = picksRef.current.has(id) ? 'pick' : simRef.current.get(id) ?? base;
    if (cur === 'available' || cur === 'pick') {
      setPicks((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    }
  }, []);

  const fitTo = useCallback((box: { x: number; y: number; w: number; h: number } | null) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cw = rect && rect.width > 0 ? rect.width : 1000;
    const ch = rect && rect.height > 0 ? rect.height : 700;
    cssRef.current = { w: cw, h: ch };
    setCssW(cw);
    setCssH(ch);
    if (!box) {
      applyVbSync(fitViewBox(cw, ch, doc.width, doc.height));
      return;
    }
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    applyVbSync(fitViewBox(cw, ch, Math.max(1, box.w * 1.35), Math.max(1, box.h * 1.35), cx, cy));
  }, [doc.width, doc.height, applyVbSync]);

  const geomBox = useCallback((sectionId: string): { x: number; y: number; w: number; h: number } | null => {
    const obj = index.objectById.get(sectionId);
    if (!obj) return null;
    const geom = sectionGeomFor(obj);
    if (!geom) return null;
    const box = bboxOf(geom.rings.flat());
    if (!box) return null;
    return { x: box.x, y: box.y, w: box.w, h: box.h };
  }, [index]);

  const enter = useCallback((id: string) => {
    if (!activeId) savedVenueView.current = vbRef.current;
    setActiveId(id);
    setConfirmed(false);
  }, [activeId]);
  useEffect(() => {
    if (activeId) fitTo(geomBox(activeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  const leave = () => {
    setActiveId(null);
    setConfirmed(false);
    if (savedVenueView.current) applyVbSync(savedVenueView.current);
    else fitTo(null);
  };

  useEffect(() => {
    // Dokumen berganti (load/impor/contoh): tutup section, kembalikan kamera venue.
    setActiveId(null);
    savedVenueView.current = null;
    setPicks(new Set());
    setSim(new Map());
    setConfirmed(false);
    fitTo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  useEffect(() => {
    if (activeId && !sections.some((o) => o.id === activeId) && activeId !== ORPHAN_ID) {
      setActiveId(null);
    }
  }, [sections, activeId]);

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
      // Satu definisi transform: pertahankan pusat + zoom agar SVG, Canvas,
      // dan hit-test tetap sejajar (termasuk perubahan tinggi saja / panel / orientasi).
      const next = resizePreserveScale(vbRef.current, prev.w, prev.h, nw, nh);
      if (next) applyVbSync(next);
      else if (!activeId) applyVbSync(fitViewBox(nw, nh, doc.width, doc.height));
      else fitTo(geomBox(activeId));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.width, doc.height, activeId, applyVbSync]);

  const resetView = () => {
    if (activeId) fitTo(geomBox(activeId));
    else fitTo(null);
  };
  const zoom = (factor: number) => {
    const current = vbRef.current;
    const width = Math.min(doc.width * 4, Math.max(2, current.w * factor));
    const height = current.h * width / current.w;
    applyVbSync({ x: current.x + (current.w - width) / 2, y: current.y + (current.h - height) / 2, w: width, h: height });
  };
  // Wheel-zoom ala Orion-FE: scroll di atas denah = zoom berjangkar kursor (bukan scroll halaman).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // Kurva ala Orion-FE (1.2^delta dinormalisasi, dibatasi), dibuat lebih bertenaga.
      // Skala viewBox berbanding terbalik dengan Orion: faktor > 1 = zoom out.
      const delta = (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) / 60;
      const bounded = Math.max(-2, Math.min(2, delta));
      const factor = Math.pow(1.2, bounded);
      const current = vbRef.current;
      const width = Math.min(doc.width * 4, Math.max(2, current.w * factor));
      if (width === current.w) return;
      const height = current.h * width / current.w;
      const rawMx = (e.clientX - rect.left) / rect.width;
      const rawMy = (e.clientY - rect.top) / rect.height;
      const mx = Number.isFinite(rawMx) ? rawMx : 0.5;
      const my = Number.isFinite(rawMy) ? rawMy : 0.5;
      applyVbSync({ x: current.x + (current.w - width) * mx, y: current.y + (current.h - height) * my, w: width, h: height });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.width, applyVbSync]);

  const processHover = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = toWorld(clientX, clientY, r, vbRef.current);
    const hit = queryPoint(index, w[0], w[1], 8);
    const inView = hit && activeId && hit.seat.sectionId === activeId
      ? seatMap.get(hit.seat.id) ?? null
      : null;
    const prevId = hoverSeatRef.current?.id ?? null;
    const nextId = inView?.id ?? null;
    if (prevId !== nextId) {
      hoverSeatRef.current = inView;
      const tip = canvasTipRef.current;
      if (tip) {
        if (inView) {
          const k = Math.max(1, r.width) / Math.max(1, vbRef.current.w);
          const wrap = tip.parentElement?.getBoundingClientRect();
          const sx = (inView.x - vbRef.current.x) * k + (wrap ? r.left - wrap.left : 0);
          const sy = (inView.y - vbRef.current.y) * k + (wrap ? r.top - wrap.top : 0);
          tip.style.display = 'block';
          tip.style.transform = `translate(${sx + 12}px, ${sy - 12}px)`;
          tip.textContent = `${inView.row}${inView.number} · Rp${inView.price.toLocaleString('id-ID')}`;
        } else {
          tip.style.display = 'none';
        }
      }
      const host = el.parentElement;
      if (host) host.style.cursor = inView ? 'pointer' : '';
      seatCanvasRef.current?.requestRedraw();
    }
  }, [index, activeId, seatMap]);

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

  const moveSeatFocus = useCallback((dx: number, dy: number) => {
    if (!activeId || visibleSeats.length === 0) return;
    const cur = focusSeatRef.current ?? hoverSeatRef.current;
    let best: EnrichedSeat | null = null;
    let bestScore = Infinity;
    const cx = cur ? cur.x : visibleSeats[0].x;
    const cy = cur ? cur.y : visibleSeats[0].y;
    for (const s of visibleSeats) {
      const vx = s.x - cx;
      const vy = s.y - cy;
      if (cur && vx === 0 && vy === 0) continue;
      const dot = vx * dx + vy * dy;
      if (dot <= 0) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      const score = perp * 4 + dot;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best && !cur) best = visibleSeats[0];
    if (best) {
      focusSeatRef.current = best;
      hoverSeatRef.current = best;
      if (liveRef.current) {
        const st = eff(best.id, best.status);
        liveRef.current.textContent = `Kursi ${best.row}${best.number}, ${best.section}, Rp${best.price.toLocaleString('id-ID')}, ${st === 'pick' ? 'dipilih' : st === 'available' ? 'tersedia' : 'tidak tersedia'}`;
      }
      seatCanvasRef.current?.requestRedraw();
    }
  }, [activeId, visibleSeats, eff]);

  const activateFocused = useCallback(() => {
    const cur = focusSeatRef.current ?? hoverSeatRef.current;
    if (!cur || cur.invalid) return;
    toggle(cur.id, cur.status, !!cur.invalid);
    if (liveRef.current) liveRef.current.textContent = `Kursi ${cur.row}${cur.number} dipilih`;
  }, [toggle]);

  const buildSeatBase = useCallback((out: SeatDrawSpec[]) => {
    out.length = 0;
    if (!activeId || !seatsAsCanvas) return;
    const v = vbRef.current;
    const m = cullMargin(v, 8);
    const refs = baseRefs.current;
    refs.length = 0;
    queryBoxVisible(index, v.x - m, v.y - m, v.x + v.w + m, v.y + v.h + m, refs);
    const pool = specPool.current;
    for (let i = 0; i < refs.length; i++) {
      const s = refs[i].seat;
      if (s.sectionId !== activeId) continue;
      const en = seatMap.get(s.id);
      if (!en) continue;
      const st = eff(s.id, s.status);
      const bad = !!s.invalid;
      const clickable = !bad && (st === 'available' || st === 'pick');
      let sp = pool[i];
      if (!sp) {
        sp = { x: 0, y: 0, r: 8, fill: '', alpha: 1, dimmed: false };
        pool[i] = sp;
      }
      sp.x = s.x;
      sp.y = s.y;
      sp.r = s.radius ?? 8;
      sp.fill = bad || !clickable ? '#DBDFE7' : en.color;
      sp.alpha = bad ? 0.5 : clickable ? 1 : 0.75;
      sp.dimmed = false;
      out.push(sp);
    }
  }, [index, activeId, seatsAsCanvas, seatMap, eff]);

  const buildSeatOverlay = useCallback((out: OverlaySpec[]) => {
    out.length = 0;
    if (!activeId || !seatsAsCanvas) return;
    for (const id of picksRef.current) {
      const s = seatMap.get(id);
      if (!s || s.sectionId !== activeId) continue;
      out.push({ x: s.x, y: s.y, r: s.radius ?? 8, kind: 'picked' });
    }
    const hov = hoverSeatRef.current;
    if (hov && hov.sectionId === activeId && !hov.invalid) {
      const st = eff(hov.id, hov.status);
      if (st === 'available' || st === 'pick') {
        out.push({ x: hov.x, y: hov.y, r: hov.radius ?? 8, kind: 'hover' });
      }
    }
    const foc = focusSeatRef.current;
    if (foc && foc.id !== hov?.id && foc.sectionId === activeId && !foc.invalid) {
      out.push({ x: foc.x, y: foc.y, r: foc.radius ?? 8, kind: 'hover' });
    }
  }, [activeId, seatsAsCanvas, seatMap, eff]);

  const simulate = () => {
    const m = new Map<string, SeatStatus>();
    let h = 42;
    const rnd = () => {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      return h / 0x7fffffff;
    };
    for (const s of seats) {
      const r = rnd();
      if (r < 0.08) m.set(s.id, 'taken');
      else if (r < 0.16) m.set(s.id, 'book');
    }
    setConfirmed(false);
    setSim(m);
    setPicks(new Set());
  };

  const picked = seats.filter((s) => picks.has(s.id));
  const total = picked.reduce((a, s) => a + s.price, 0);
  // Kelompok ala Orion-FE: per tipe tiket (bukan per section), urut kategori Editor.
  const ticketGroups = useMemo(() => {
    const groups: { key: string; ticketId: string | null; ticketType: string; ticketColor: string; seats: EnrichedSeat[]; count: number; sub: number }[] = [];
    for (const c of doc.categories) {
      const items = picked.filter((s) => s.categoryId === c.id);
      if (items.length === 0) continue;
      groups.push({
        key: c.id,
        ticketId: c.id,
        ticketType: c.name,
        ticketColor: c.color,
        seats: items,
        count: items.length,
        sub: items.reduce((a, s) => a + s.price, 0),
      });
    }
    const rest = picked.filter((s) => !s.categoryId || !doc.categories.some((c) => c.id === s.categoryId));
    if (rest.length > 0) {
      groups.push({
        key: ORPHAN_ID,
        ticketId: null,
        ticketType: 'Tanpa section',
        ticketColor: ORPHAN_COLOR,
        seats: rest,
        count: rest.length,
        sub: rest.reduce((a, s) => a + s.price, 0),
      });
    }
    return groups;
  }, [picked, doc.categories]);

  const activeCategory = activeSection?.categoryId ? categoryById(doc, activeSection.categoryId) : null;
  // Kartu tiket ala Orion-FE: satu kartu per kategori (urutan Editor),
  // klik kartu = zoom ke section pertama pemilik tiket itu (readOnly, pilih tetap via denah).
  const ticketCards = useMemo(() => doc.categories.map((c) => {
    const using = sections.filter((o) => o.categoryId === c.id);
    const seatCount = seats.filter((s) => s.categoryId === c.id).length;
    const meta = using.length === 1
      ? `${using[0].label} · ${seatCount} kursi`
      : using.length > 1
        ? `${using.length} section · ${seatCount} kursi`
        : `${seatCount} kursi · belum dipakai section`;
    return { id: c.id, name: c.name, price: c.price, color: c.color, meta, sectionId: using[0]?.id ?? null };
  }), [doc.categories, sections, seats]);
  const visibleTicketCards = activeCategory ? ticketCards.filter((t) => t.id === activeCategory.id) : activeId ? [] : ticketCards;
  const handleTicketClick = useCallback((ticketId: string) => {
    const target = sections.find((o) => o.categoryId === ticketId) ?? null;
    if (!target || target.id === activeId) return;
    enter(target.id);
  }, [sections, activeId, enter]);
  const legendSections = doc.categories.map((c) => ({ id: c.id, name: c.name, price: c.price, color: c.color }));
  if (orphanSeats.length > 0) legendSections.push({ id: ORPHAN_ID, name: 'Tanpa section', price: NaN, color: ORPHAN_COLOR });

  return (
    <div className="preview orion-preview">
      <style>{`.orion-map .seatclick:hover { stroke: #f59e0b; stroke-width: 3; }`}</style>
      <div className="orion-simulation-bar">
        <span>Preview pembeli <small>Simulasi pemilihan kursi</small></span>
        <div className="row"><button onClick={simulate}>Simulasi ketersediaan</button><button onClick={() => { setSim(new Map()); setPicks(new Set()); setConfirmed(false); resetView(); }}>Reset</button></div>
      </div>
      <div className="orion-layout">
        <aside className="orion-selection">
          <header><span className="orion-eyebrow">PILIH KURSI</span><h2>{doc.name}</h2><p>Pilih kursi yang kamu inginkan pada denah.</p></header>
          <section className="orion-categories" aria-label="Kategori tiket">
            {activeId && activeLabel ? (
              <div className="orion-ticket-filter">
                <p>Lihat section <span>{activeLabel}</span></p>
                <div className="orion-ticket-pill">
                  <span>{activeLabel}</span>
                  <button type="button" onClick={leave} aria-label="Hapus filter section">
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <h3>Pilih tiket</h3>
            )}
            {doc.categories.length === 0 ? (
              <p className="orion-cat-empty">Belum ada kategori tiket</p>
            ) : visibleTicketCards.length === 0 ? (
              <p className="orion-cat-empty">Tidak ada tiket untuk section ini.</p>
            ) : (
              <ul className="orion-ticket-list">
                {visibleTicketCards.map((t) => {
                  const selected = activeCategory?.id === t.id;
                  return (
                    <li key={t.id}>
                      <div
                        role={t.sectionId ? 'button' : undefined}
                        tabIndex={t.sectionId ? 0 : undefined}
                        aria-label={t.sectionId ? `Lihat section ${t.name}` : t.name}
                        aria-current={selected || undefined}
                        className={`orion-ticket-card${t.sectionId ? ' is-clickable' : ''}`}
                        onClick={t.sectionId ? () => handleTicketClick(t.id) : undefined}
                        onKeyDown={t.sectionId ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTicketClick(t.id); } } : undefined}
                      >
                        <span className="orion-ticket-accent" aria-hidden="true" style={{ background: t.color }} />
                        <div className="orion-ticket-body">
                          <h4>{t.name}</h4>
                          <p className="orion-ticket-meta">{t.meta}</p>
                          <div className="orion-ticket-foot">
                            <strong>{money(t.price)}</strong>
                            {t.sectionId && <span className="orion-ticket-cta">{selected ? 'Section aktif' : 'Lihat section'}</span>}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <div className="orion-picked" aria-live="polite">
            <h3>Kursi dipilih <span>{picked.length}</span></h3>
            {picked.length === 0 && <p className="orion-empty">Belum ada kursi dipilih.<br />Klik kursi yang tersedia untuk mulai memilih.</p>}
            {ticketGroups.map((group) => (
              <div className="orion-seat-group" key={group.key}>
                <span className="orion-seat-accent" aria-hidden="true" style={{ background: group.ticketColor }} />
                <div className="orion-seat-body">
                  <div className="orion-seat-head">
                    <div>
                      <h4>{group.ticketType}</h4>
                      <p>Kursi dipilih</p>
                    </div>
                    <button
                      type="button"
                      className="orion-group-remove"
                      onClick={() => {
                        setConfirmed(false);
                        setPicks((prev) => {
                          const n = new Set(prev);
                          for (const s of group.seats) n.delete(s.id);
                          return n;
                        });
                      }}
                      aria-label={`Hapus semua kursi ${group.ticketType}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="orion-seat-chips">{group.seats.map((seat) => <button key={seat.id} onClick={() => toggle(seat.id, seat.status, false)} aria-label={`Lepas kursi ${seat.row}${seat.number}`}>{seat.row}{seat.number}<X size={14} /></button>)}</div>
                  <div className="orion-seat-foot"><span>{group.count} kursi</span><strong>{money(group.sub)}</strong></div>
                </div>
              </div>
            ))}
          </div>
          <footer className="orion-checkout"><div><small>Subtotal ({picked.length} tiket)</small><strong>{money(total)}</strong><button type="button" className="orion-detail-link" disabled={picked.length === 0}>Lihat detail</button></div><button disabled={!picked.length} onClick={() => setConfirmed(true)}>Pesan Tiket</button></footer>
          {confirmed && <p className="orion-confirmation" role="status">Simulasi selesai: {picked.length} kursi dipilih. Tidak ada pesanan atau reservasi dibuat.</p>}
        </aside>
        <div className="orion-map">
        {activeId && (
          <div className="orion-sectionbar">
            <button data-testid="back-to-venue" onClick={leave} aria-label="Kembali ke venue">
              <ArrowLeft size={16} /> Kembali ke venue
            </button>
            <strong>{activeLabel}</strong>
            {activeCategory && <span>{activeCategory.name} · {money(activeCategory.price)}</span>}
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0 }}>
        <svg ref={svgRef} viewBox={viewBoxStr(vb)} className="canvas" aria-label={activeId ? `Denah section ${activeLabel}` : 'Denah venue'}
          tabIndex={seatsAsCanvas ? 0 : undefined}
          onKeyDown={seatsAsCanvas ? (event) => {
            const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const step = steps[event.key];
            if (step) { event.preventDefault(); moveSeatFocus(step[0], step[1]); }
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateFocused(); }
          } : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const rect = svgRef.current?.getBoundingClientRect();
            drag.current = {
              x: event.clientX, y: event.clientY, vb: vbRef.current, moved: false,
              rectW: Math.max(1, rect?.width ?? 1000), rectH: Math.max(1, rect?.height ?? 700),
            };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            // Hover kanvas-mode via indeks (tanpa setState).
            if (seatsAsCanvas && activeId && start && !start.moved) scheduleHover(event.clientX, event.clientY);
            else if (seatsAsCanvas && activeId && !start) scheduleHover(event.clientX, event.clientY);
            if (!start) return;
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) { start.moved = true; event.currentTarget.setPointerCapture(event.pointerId); }
            if (start.moved) scheduleVb({ ...start.vb, x: start.vb.x - dx * start.vb.w / start.rectW, y: start.vb.y - dy * start.vb.h / start.rectH });
          }}
          onPointerUp={(event) => {
            // Klik kanvas-mode: hit-test via indeks bila bukan pan.
            if (seatsAsCanvas && activeId && drag.current && !drag.current.moved) {
              const rect = svgRef.current?.getBoundingClientRect();
              if (rect) {
                const w = toWorld(event.clientX, event.clientY, rect, vbRef.current);
                const hit = queryPoint(index, w[0], w[1], 8);
                if (hit && hit.seat.sectionId === activeId) {
                  const en = seatMap.get(hit.seat.id);
                  if (en && !en.invalid) {
                    const st = eff(en.id, en.status);
                    if (st === 'available' || st === 'pick') {
                      focusSeatRef.current = en;
                      toggle(en.id, en.status, !!en.invalid);
                    }
                  }
                }
              }
            }
            setTimeout(() => { drag.current = null; }, 0);
          }}
          onPointerCancel={() => { drag.current = null; }}
          onPointerLeave={() => { hoverSeatRef.current = null; seatCanvasRef.current?.requestRedraw(); const tip = canvasTipRef.current; if (tip) tip.style.display = 'none'; }}>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#F5F7FA" />
          {doc.backgroundImage && (
            <image href={doc.backgroundImage} x={0} y={0} width={doc.width} height={doc.height} opacity={0.25} preserveAspectRatio="none" />
          )}
          {doc.objects.map((o) => {
            if (o.isSection) {
              const c = colorOf(o.id);
              const bounds = geomBox(o.id);
              const fallback = bboxOf(o.points);
              const cx = bounds ? bounds.x + bounds.w / 2 : fallback ? fallback.cx : 0;
              const cy = bounds ? bounds.y + bounds.h / 2 : fallback ? fallback.cy : 0;
              const dimmed = !!activeId && activeId !== o.id;
              return (
                <g key={o.id} className="preview-section" role="button" tabIndex={0} aria-label={activeId === o.id ? `Section aktif ${o.label}` : `Masuk section ${o.label}`}
                  aria-current={activeId === o.id ? true : undefined}
                  opacity={dimmed ? 0.55 : 1}
                  style={{ cursor: activeId === o.id ? 'default' : 'pointer' }}
                  onClick={() => { if (activeId !== o.id) enter(o.id); }}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && activeId !== o.id) { e.preventDefault(); enter(o.id); } }}>
                  {o.kind === 'vector' && o.d ? (
                    <g transform={o.vTransform?.rotation ? (() => {
                      const c = vectorCanvasCenter(o);
                      return c ? `rotate(${o.vTransform.rotation} ${c[0]} ${c[1]})` : undefined;
                    })() : undefined}>
                    <path className="preview-section-shape" d={o.d}
                      transform={o.vTransform ? `translate(${o.vTransform.tx} ${o.vTransform.ty}) scale(${o.vTransform.scale})` : undefined}
                      fillRule={o.svgFillRule ?? 'nonzero'} vectorEffect="non-scaling-stroke"
                      fill={c} fillOpacity={activeId === o.id ? 0.22 : 0.16} stroke={c} strokeWidth={activeId === o.id ? 3 : 2} />
                    </g>
                  ) : (
                    <polygon className="preview-section-shape" points={toPointsString(o.points)}
                      transform={(() => {
                        const sr = rotationOf(o);
                        const sc = sr !== 0 ? shapeCenter(o) : null;
                        return sc ? `rotate(${sr} ${sc[0]} ${sc[1]})` : undefined;
                      })()}
                      vectorEffect="non-scaling-stroke"
                      fill={c} fillOpacity={activeId === o.id ? 0.22 : 0.16} stroke={c} strokeWidth={activeId === o.id ? 3 : 2} />
                  )}
                  {activeId !== o.id && (
                    <text x={cx} y={cy} textAnchor="middle" className="lbl preview-hover-lbl" pointerEvents="none">{o.label}</text>
                  )}
                  {!activeId && <title>{`Masuk section ${o.label}`}</title>}
                </g>
              );
            }
            if (o.kind === 'vector' && o.d && o.vTransform) {
              const t = o.vTransform;
              const st = o.svgStroke ?? null;
              const prot = t.rotation ?? 0;
              const pc = Number.isFinite(prot) && prot !== 0 ? vectorCanvasCenter(o) : null;
              return (
                <g key={o.id} transform={pc ? `rotate(${prot} ${pc[0]} ${pc[1]})` : undefined}>
                <g transform={`translate(${t.tx} ${t.ty}) scale(${t.scale})`}>
                  <path
                    d={o.d}
                    fill={o.svgFill ?? 'black'}
                    fillOpacity={o.svgFillOpacity ?? undefined}
                    fillRule={o.svgFillRule ?? 'nonzero'}
                    stroke={st ? st.color : 'none'}
                    strokeWidth={st ? st.width : undefined}
                    strokeLinecap={st?.linecap as 'butt' | 'round' | 'square' | undefined}
                    strokeLinejoin={st?.linejoin as 'miter' | 'round' | 'bevel' | undefined}
                    strokeDasharray={st?.dash}
                    strokeDashoffset={st?.dashOffset}
                    strokeOpacity={st?.opacity}
                    pointerEvents="none"
                  />
                  {o.isSection && (
                    <path d={o.d} fill={colorOf(o.id)} fillOpacity={0.22} fillRule={o.svgFillRule ?? 'nonzero'}
                      stroke={colorOf(o.id)} strokeWidth={1.5 / t.scale} pointerEvents="none" />
                  )}
                </g>
                </g>
              );
            }
            if (o.kind === 'stage') {
              const box = bboxOf(o.points);
              const sx = box ? box.cx : 0;
              const sy = box ? box.cy : 0;
              const strot = rotationOf(o);
              const stc = strot !== 0 ? shapeCenter(o) : null;
              return (
                <g key={o.id}>
                  <polygon points={toPointsString(o.points)} fill="#cbd5e1" stroke="#475569"
                    transform={stc ? `rotate(${strot} ${stc[0]} ${stc[1]})` : undefined}>
                    <title>{o.label}</title>
                  </polygon>
                  <text x={sx} y={sy} textAnchor="middle" className="lbl preview-hover-lbl" pointerEvents="none">{o.label}</text>
                </g>
              );
            }
            if (o.kind === 'aisle') {
              const arot = rotationOf(o);
              const ac = arot !== 0 ? shapeCenter(o) : null;
              return <polyline key={o.id} points={toPointsString(o.points)} fill="none" stroke="#cbd5e1" strokeWidth={o.width} strokeLinecap="round"
                transform={ac ? `rotate(${arot} ${ac[0]} ${ac[1]})` : undefined} />;
            }

            return null;
          })}
          {activeId && !seatsAsCanvas && visibleSeats.map((s) => {
            const st = eff(s.id, s.status);
            const bad = !!s.invalid;
            const clickable = !bad && (st === 'available' || st === 'pick');
            return (
              <circle
                key={s.id} cx={s.x} cy={s.y} r={s.radius ?? 8} fill={bad || !clickable ? '#DBDFE7' : s.color}
                stroke={st === 'pick' ? '#0F172A' : 'transparent'} strokeWidth={st === 'pick' ? (s.radius ?? 8) * 0.35 : 0}
                role="button" tabIndex={clickable ? 0 : undefined} aria-disabled={!clickable} aria-pressed={st === 'pick'}
                aria-label={`${s.section}, kursi ${s.row}${s.number}, ${money(s.price)}, ${clickable ? st === 'pick' ? 'dipilih' : 'tersedia' : 'tidak tersedia'}`}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(s.id, s.status, bad); } }}
                opacity={bad ? 0.5 : clickable ? 1 : 0.75}
                className={clickable ? 'seatclick' : undefined}
                style={bad ? { cursor: 'not-allowed' } : undefined}
                onClick={() => toggle(s.id, s.status, bad)}
              >
                <title>{bad ? `${s.section} · ${s.row}${s.number} · DI LUAR SECTION — tidak dijual` : `${s.section} · ${s.row}${s.number} · Rp${s.price.toLocaleString('id-ID')} · ${st}`}</title>
              </circle>
            );
          })}
        </svg>
        {activeId && seatsAsCanvas && (
          <SeatCanvas ref={seatCanvasRef} vb={vb} baseRev={baseRevRef.current} overlayRev={picks}
            buildBase={buildSeatBase} buildOverlay={buildSeatOverlay}
            simpleDots={lod.level === 'dot'} label="preview" />
        )}
        <div ref={canvasTipRef} role="status"
          style={{ display: 'none', position: 'absolute', left: 0, top: 0, pointerEvents: 'none', background: '#0f172a', color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 6, zIndex: 5 }} />
        <div ref={liveRef} aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }} />
        </div>
        {!activeId && orphanSeats.length > 0 && (
          <div className="orion-venue-note">
            <button onClick={() => enter(ORPHAN_ID)}>Masuk Tanpa section</button>
          </div>
        )}
        <div className="orion-zoom"><button aria-label="Perbesar denah" onClick={() => zoom(0.75)}><Plus size={20} /></button><button aria-label="Perkecil denah" onClick={() => zoom(4 / 3)}><Minus size={20} /></button></div>
        <button className="orion-fit" aria-label="Tampilkan seluruh denah" onClick={resetView}><Maximize size={18} /></button>
        <div className="orion-legends">
          {legendOpen && <div className="orion-legend-content">
            {legendSections.map((seat) => (
              <div key={seat.id}>
                <i style={{ background: seat.color }} />
                <span className="orion-legend-text">
                  <strong>{seat.name}</strong>
                  {Number.isFinite(seat.price) && <small>{money(seat.price)}</small>}
                </span>
              </div>
            ))}
            <hr /><div><i style={{ background: '#DBDFE7' }} /><span className="orion-legend-text">Tidak tersedia</span></div><div><i className="orion-selected-marker" /><span className="orion-legend-text">Dipilih</span></div>
          </div>}
          <button onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen}>Legenda{legendOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
        </div>
        <span className="orion-map-hint">{activeId ? `Pilih kursi di ${activeLabel} · scroll untuk zoom` : sections.length ? 'Pilih section untuk melihat kursinya · scroll untuk zoom' : (seats.length ? 'Geser denah untuk melihat area lain · scroll untuk zoom' : 'Belum ada kursi. Buat baris di Editor.')}</span>
        </div>
      </div>
    </div>
  );
}

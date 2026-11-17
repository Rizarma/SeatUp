import { useEffect, useMemo, useRef, useState } from 'react';
import type { SeatStatus } from '../lib/venue';
import { useStore } from '../store';
import { fitViewBox, viewBoxStr } from '../lib/camera';
import type { ViewBox } from '../lib/camera';
import { sectionGeomFor, shapeCenter, vectorCanvasCenter } from '../lib/contain';
import { categoryColorForSection, categoryById } from '../lib/categories';
import { bboxOf, rotationOf, toPointsString } from '../lib/geometry';
import { Plus, Minus, Maximize, ChevronDown, X, ArrowLeft } from 'lucide-react';

const ORPHAN_ID = '__orphan__';
const ORPHAN_COLOR = '#94a3b3';
const money = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

export default function Preview() {
  const { state } = useStore();
  const { doc } = state;
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [sim, setSim] = useState<Map<string, SeatStatus>>(new Map());
  const [legendOpen, setLegendOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: doc.width, h: doc.height });
  const savedVenueView = useRef<ViewBox | null>(null);

  const sections = useMemo(() => doc.objects.filter((o) => o.isSection), [doc.objects]);
  const colorOf = (sectionId: string): string => {
    if (!sections.some((o) => o.id === sectionId)) return ORPHAN_COLOR;
    return categoryColorForSection(doc.objects, doc.categories, sectionId);
  };

  const seats = useMemo(() => doc.objects.flatMap((o) =>
    o.seats.map((s) => {
      const section = doc.objects.find((item) => item.id === (s.sectionId ?? o.sectionId)) ?? o;
      const isSec = !!section.isSection;
      return {
        ...s,
        section: isSec ? section.label : 'Tanpa section',
        sectionId: isSec ? section.id : ORPHAN_ID,
        color: isSec ? categoryColorForSection(doc.objects, doc.categories, section.id) : ORPHAN_COLOR,
        categoryName: isSec ? (section.categoryId ? categoryById(doc, section.categoryId)?.name ?? section.label : section.label) : 'Tanpa section',
      };
    })), [doc]);

  const orphanSeats = useMemo(() => seats.filter((s) => s.sectionId === ORPHAN_ID), [seats]);
  const activeSection = activeId && activeId !== ORPHAN_ID ? sections.find((o) => o.id === activeId) ?? null : null;
  const activeLabel = activeId === ORPHAN_ID ? 'Tanpa section' : activeSection?.label ?? null;
  const visibleSeats = activeId ? seats.filter((s) => s.sectionId === activeId) : [];

  const fitTo = (box: { x: number; y: number; w: number; h: number } | null) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cw = rect && rect.width > 0 ? rect.width : 1000;
    const ch = rect && rect.height > 0 ? rect.height : 700;
    if (!box) {
      setVb(fitViewBox(cw, ch, doc.width, doc.height));
      return;
    }
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    setVb(fitViewBox(cw, ch, Math.max(1, box.w * 1.35), Math.max(1, box.h * 1.35), cx, cy));
  };

  const geomBox = (sectionId: string): { x: number; y: number; w: number; h: number } | null => {
    const obj = doc.objects.find((o) => o.id === sectionId);
    if (!obj) return null;
    const geom = sectionGeomFor(obj);
    if (!geom) return null;
    const box = bboxOf(geom.rings.flat());
    if (!box) return null;
    return { x: box.x, y: box.y, w: box.w, h: box.h };
  };

  const enter = (id: string) => {
    if (!activeId) savedVenueView.current = vb;
    setActiveId(id);
    setConfirmed(false);
    fitTo(geomBox(id));
  };
  const leave = () => {
    setActiveId(null);
    setConfirmed(false);
    if (savedVenueView.current) setVb(savedVenueView.current);
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
      if (!activeId) {
        const r = el.getBoundingClientRect();
        setVb(fitViewBox(r.width, r.height, doc.width, doc.height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.width, doc.height, activeId]);

  const resetView = () => {
    if (activeId) fitTo(geomBox(activeId));
    else fitTo(null);
  };
  const zoom = (factor: number) => setVb((current) => {
    const width = Math.min(doc.width * 4, Math.max(2, current.w * factor));
    const height = current.h * width / current.w;
    return { x: current.x + (current.w - width) / 2, y: current.y + (current.h - height) / 2, w: width, h: height };
  });

  const eff = (id: string, base: SeatStatus): SeatStatus => {
    if (picks.has(id)) return 'pick';
    return sim.get(id) ?? base;
  };

  const toggle = (id: string, base: SeatStatus, invalid: boolean) => {
    if (invalid || drag.current?.moved) return;
    setConfirmed(false);
    const cur = eff(id, base);
    if (cur === 'available' || cur === 'pick') {
      setPicks((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    }
  };

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
  const bySection = new Map<string, { n: number; sub: number; price: number }>();
  for (const s of picked) {
    const e = bySection.get(s.section) ?? { n: 0, sub: 0, price: s.price };
    e.n++;
    e.sub += s.price;
    bySection.set(s.section, e);
  }

  const legendSections = doc.categories.map((c) => {
    const using = sections.filter((o) => o.categoryId === c.id);
    const label = using.length > 0 && using.every((o) => o.label === c.name) ? c.name : using.length === 1 ? `${c.name} (${using[0].label}) · Rp${c.price.toLocaleString('id-ID')}` : `${c.name} · Rp${c.price.toLocaleString('id-ID')}`;
    return { id: c.id, label, color: c.color };
  });
  if (orphanSeats.length > 0) legendSections.push({ id: ORPHAN_ID, label: 'Tanpa section', color: ORPHAN_COLOR });

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
          <div className="orion-picked" aria-live="polite">
            <h3>Kursi dipilih <span>{picked.length}</span></h3>
            {picked.length === 0 && <p className="orion-empty">Belum ada kursi dipilih.<br />Klik kursi yang tersedia untuk mulai memilih.</p>}
            {[...bySection.entries()].map(([section, group]) => (
              <div className="orion-seat-group" key={section}>
                <h4><i style={{ background: picked.find((seat) => seat.section === section)?.color }} />{section}<span>{money(group.sub)}</span></h4>
                <div className="orion-seat-chips">{picked.filter((seat) => seat.section === section).map((seat) => <button key={seat.id} onClick={() => toggle(seat.id, seat.status, false)} aria-label={`Lepas kursi ${seat.row}${seat.number}`}>{seat.row}{seat.number}<X size={14} /></button>)}</div>
              </div>
            ))}
          </div>
          <footer className="orion-checkout"><div><small>Subtotal ({picked.length} tiket)</small><strong>{money(total)}</strong></div><button disabled={!picked.length} onClick={() => setConfirmed(true)}>Pesan Tiket</button></footer>
          {confirmed && <p className="orion-confirmation" role="status">Simulasi selesai: {picked.length} kursi dipilih. Tidak ada pesanan atau reservasi dibuat.</p>}
        </aside>
        <div className="orion-map">
        {activeId && (
          <div className="orion-sectionbar">
            <button data-testid="back-to-venue" onClick={leave} aria-label="Kembali ke venue">
              <ArrowLeft size={16} /> Kembali ke venue
            </button>
            <strong>{activeLabel}</strong>
          </div>
        )}
        <svg ref={svgRef} viewBox={viewBoxStr(vb)} className="canvas" aria-label={activeId ? `Denah section ${activeLabel}` : 'Denah venue'}
          onPointerDown={(event) => { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, vb, moved: false }; }}
          onPointerMove={(event) => {
            const start = drag.current;
            const rect = svgRef.current?.getBoundingClientRect();
            if (!start || !rect) return;
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) { start.moved = true; event.currentTarget.setPointerCapture(event.pointerId); }
            if (start.moved) setVb({ ...start.vb, x: start.vb.x - dx * start.vb.w / rect.width, y: start.vb.y - dy * start.vb.h / rect.height });
          }}
          onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
          onPointerCancel={() => { drag.current = null; }}>
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
          {activeId && visibleSeats.map((s) => {
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
        {!activeId && orphanSeats.length > 0 && (
          <div className="orion-venue-note">
            <button onClick={() => enter(ORPHAN_ID)}>Masuk Tanpa section</button>
          </div>
        )}
        <div className="orion-zoom"><button aria-label="Perbesar denah" onClick={() => zoom(0.8)}><Plus size={20} /></button><button aria-label="Perkecil denah" onClick={() => zoom(1.25)}><Minus size={20} /></button></div>
        <button className="orion-fit" aria-label="Tampilkan seluruh denah" onClick={resetView}><Maximize size={18} /></button>
        <div className="orion-legends">
          {legendOpen && <div className="orion-legend-content">
            {legendSections.map((seat) => <div key={seat.id}><i style={{ background: seat.color }} /><span>{seat.label}</span></div>)}
            <hr /><div><i style={{ background: '#DBDFE7' }} />Tidak tersedia</div><div><i className="orion-selected-marker" />Dipilih</div>
          </div>}
          <button onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen}>Legenda<ChevronDown size={16} /></button>
        </div>
        <span className="orion-map-hint">{activeId ? `Pilih kursi di ${activeLabel}` : sections.length ? 'Pilih section untuk melihat kursinya' : (seats.length ? 'Geser denah untuk melihat area lain' : 'Belum ada kursi. Buat baris di Editor.')}</span>
        </div>
      </div>
    </div>
  );
}

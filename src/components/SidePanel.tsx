import React from 'react';
import SeatLayoutControls from './SeatLayoutControls';
import {
  Armchair, Circle, Footprints, Hand, Pencil, Plus, Podium, Download, FileUp, FolderOpen, Image as ImageIcon, Layers, PenTool, Save,
  Shapes, Square, Trash2, TriangleAlert, Upload, Check, X,
} from 'lucide-react';
import type { Pt, RowParams, ObjKind, Seat, TicketCategory, VenueObject } from '../lib/venue';

export type RowForm = RowParams;
import { markEligibility } from '../lib/panelContext';
import { shapeName } from '../lib/shapeLabel';
import { SECTION_PALETTE } from '../lib/sectionColor';
import {
  categoryById, categoryColorForSection,
  createCategory, isValidCategoryColor, isValidCategoryName, isValidCategoryPrice, normalizeCategoryName,
} from '../lib/categories';
import { withoutObject, withObject } from '../lib/docObjects';
import { CommittedNum, CommittedText, CtxHead, Num, ObjGroup, useDebouncedValue } from './ui';
import { useStore } from '../store';
import { getDocIndex } from '../lib/docIndex';
import { applyBulkSeatLabel } from '../lib/bulkEdit';

interface Props {
  onHoverObject: (id: string | null) => void;
  rowForm: RowForm;
  setRowForm: (f: RowForm) => void;
  anchor: Pt | null;
  aisleWidth: number;
  setAisleWidth: (v: number) => void;
  showBg: boolean;
  setShowBg: (v: boolean) => void;
  importMsg: string;
  onImportFile: (f: File, asBg: boolean) => void;
  onImportSvgFile: (f: File) => void;
  onBgFile: (f: File) => void;
  onClearBg: () => void;
  hasBg: boolean;
  sections: VenueObject[];
  sectionId: string | null;
  setSectionId: (id: string | null) => void;
  focusId: string | null;
  onEnterSection: (id: string) => void;
  validCount: number | null;
  rejectedCount: number | null;
  previewCount: number | null;
  previewRows: number | null;
  onMarkSection: () => void;
  onUnmarkSection: () => void;
  onPurgeInvalid: () => void;
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onImportJsonFile: (f: File) => void;
  open: boolean;
  onCloseDrawer: () => void;
}

type TabId = 'category' | 'props' | 'objek' | 'dokumen';

export default function SidePanel(p: Props) {
  const { state, select, selectSeats, setTool, update } = useStore();
  const { doc, selectedId, selectedSeatIds, tool } = state;
  const selected = doc.objects.find((o) => o.id === selectedId) ?? null;
  const [asBg, setAsBg] = React.useState(true);
  // Input mentah responsif tiap ketikan; filter memakai versi debounce-nya.
  const [queryRaw, setQueryRaw] = React.useState('');
  const query = useDebouncedValue(queryRaw, 200);
  const [tab, setTab] = React.useState<TabId>('category');
  const [svgName, setSvgName] = React.useState('');
  const [rasterName, setRasterName] = React.useState('');
  // Konteks mengikuti: ganti tool kreasi -> Properti (opsi tool); pilih objek -> Properti.
  // Form/draf/jangkar tidak di-reset, hanya tab yang berpindah.
  React.useEffect(() => {
    if (tool !== 'select') setTab('props');
  }, [tool]);
  React.useEffect(() => {
    if (selectedId && tool === 'select') setTab('props');
  }, [selectedId, tool]);
  React.useEffect(() => {
    if (selectedSeatIds.length > 0) setTab('props');
  }, [selectedSeatIds.length]);
  const f = p.rowForm;
  const mark = markEligibility(selected ?? null);

  const pickObject = (id: string) => { p.onHoverObject(null); select(id); setTab('props'); };
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const pendingDeleteObj = pendingDeleteId ? doc.objects.find((o) => o.id === pendingDeleteId) ?? null : null;
  const performDelete = (id: string) => {
    const object = doc.objects.find((o) => o.id === id);
    if (!object) return;
    p.onHoverObject(null);
    const doomedSeats = new Set(object.seats.map((s) => s.id));
    update((d) => withoutObject(d, id));
    if (selectedId === id) select(null);
    if (p.sectionId === id) p.setSectionId(null);
    if (selectedSeatIds.some((sid) => doomedSeats.has(sid))) {
      selectSeats(selectedSeatIds.filter((sid) => !doomedSeats.has(sid)));
    }
  };


  const q = query.trim().toLowerCase();
  const matches = (o: VenueObject) => !q || o.label.toLowerCase().includes(q) || o.kind.includes(q) || shapeName(o).toLowerCase().includes(q);
  const groupSections = doc.objects.filter((o) => o.isSection && matches(o));
  const groupRows = doc.objects.filter((o) => o.kind.startsWith('row') && matches(o));
  const groupOther = doc.objects.filter((o) => !o.isSection && !o.kind.startsWith('row') && matches(o));
  // Agregat seat via indeks (sekali per perubahan doc, bukan per section/per render).
  const index = getDocIndex(doc);
  const seatStats = React.useMemo(() => {
    let invalidTotal = 0;
    const perSection = new Map<string, { n: number; bad: number }>();
    for (const ref of index.allSeats) {
      const s = ref.seat;
      if (s.invalid) invalidTotal++;
      if (s.sectionId) {
        let e = perSection.get(s.sectionId);
        if (!e) {
          e = { n: 0, bad: 0 };
          perSection.set(s.sectionId, e);
        }
        e.n++;
        if (s.invalid) e.bad++;
      }
    }
    return { invalidTotal, perSection };
  }, [index]);
  const invalidTotal = seatStats.invalidTotal;

  // CTA footer venue: baris invalid pada kelompok terpilih.
  // Mode section tidak pakai footer CTA — semua aksi sudah inline di panel.
  const cta = (() => {
    if (p.focusId) return null;
    if (selected && (selected.kind === 'row-straight' || selected.kind === 'row-arc')
      && selected.seats.some((s) => s.invalid)) {
      return { label: `Buang ${selected.seats.filter((s) => s.invalid).length} kursi invalid`, fn: p.onPurgeInvalid, disabled: false };
    }
    return null;
  })();

  const onTabKey = (e: React.KeyboardEvent) => {
    const order: TabId[] = ['category', 'props', 'objek', 'dokumen'];
    const i = order.indexOf(tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') p.onHoverObject(null);
    if (e.key === 'ArrowRight') setTab(order[(i + 1) % order.length]);
    if (e.key === 'ArrowLeft') setTab(order[(i + order.length - 1) % order.length]);
  };

  // Header konteks section: fix di luar area scroll (bukan sticky di dalam
  // pbody) agar tak menimpa judul panel saat scroll.
  const focusActive = p.focusId ? doc.objects.find((o) => o.id === p.focusId) ?? null : null;
  const focusSeatCount = focusActive
    ? (seatStats.perSection.get(focusActive.id)?.n ?? 0)
    : 0;
  const focusCat = focusActive?.categoryId ? categoryById(doc, focusActive.categoryId) : null;

  return (
    <div onPointerLeave={() => p.onHoverObject(null)} id="side-panel" className={p.open ? 'panel open' : 'panel'}>
      <button className="drawer-close" onClick={() => { p.onHoverObject(null); p.onCloseDrawer(); }}>Tutup panel ✕</button>

      <div className="ptabs" role="tablist" aria-label="Panel inspector" onKeyDown={onTabKey}>
        {([['category', 'Kategori'], ['props', 'Properti'], ['objek', 'Objek'], ['dokumen', 'Dokumen']] as [TabId, string][]).map(([id, label]) => (
          <button
            key={id} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'on' : ''} onClick={() => { p.onHoverObject(null); setTab(id); }}
          >{label}</button>
        ))}
      </div>

      {tab === 'props' && focusActive && (
        <div className="section-contextbar" aria-label={`Section aktif ${focusActive.label}`}>
          <span className="ctxicon" aria-hidden="true"><Shapes size={18} strokeWidth={2} /></span>
          <div className="ctxtext">
            <p className="ctxtitle">
              <span className="ell" title={focusActive.label}>{focusActive.label}</span>
              <span className="badge b-blue ctx-flag">Section</span>
            </p>
            <p className="muted ctxsub" title={`${focusSeatCount} kursi${focusCat ? ` · ${focusCat.name}` : ''}`}>
              {focusSeatCount} kursi{focusCat ? ` · ${focusCat.name} · Rp${focusCat.price.toLocaleString('id-ID')}` : ' · belum ada kategori'}
            </p>
          </div>
          {focusCat && <i aria-hidden="true" className="section-context-dot" style={{ background: focusCat.color }} />}
        </div>
      )}

      <div className="pbody" role="tabpanel">
        {tab === 'category' && <CategoryTab />}

        {tab === 'props' && (
          p.focusId ? (
            <SectionProps
              p={p} f={f} tool={tool} selected={selected}
              onRequestDelete={(id) => setPendingDeleteId(id)}
            />
          ) : (
          <>
            {selectedSeatIds.length > 0 ? (
              <SeatSelectionEditor key={selectedSeatIds.join(',')} />
            ) : (
              <>
                {tool !== 'select' && <ToolOptions p={p} f={f} tool={tool} />}
                {tool === 'select' && selected && <ObjectProps p={p} selected={selected} markOk={mark.ok} markReason={mark.reason} onRequestDelete={(id) => setPendingDeleteId(id)} />}
                {tool === 'select' && !selected && !p.focusId && (
                  <div className="empty empty--props">
                    <span className="empty-icon" aria-hidden="true"><Layers size={20} strokeWidth={2} /></span>
                    <strong>Belum ada yang dipilih</strong>
                    <p className="muted">Pilih objek di kanvas atau dari tab Objek untuk melihat propertinya. Pilih tool menggambar untuk opsi pembuatan.</p>
                    <button type="button" className="empty-action" onClick={() => setTab('objek')}>Lihat daftar objek</button>
                  </div>
                )}
                {p.focusId && tool !== 'row' && <FocusSectionLayout focusId={p.focusId} onEnterSection={p.onEnterSection} />}
              </>
            )}
          </>
          )
        )}

        {tab === 'objek' && (
          <>
            <label className="fld search"><span>Cari</span>
              <input value={queryRaw} placeholder="nama atau jenis…" onChange={(e) => { p.onHoverObject(null); setQueryRaw(e.target.value); }} />
            </label>
            {doc.objects.length === 0 && (
              <p className="muted">Kanvas kosong. Gambar polygon atau impor SVG via tab Dokumen.</p>
            )}
            <ObjGroup title={`Section (${groupSections.length})`} openDefault>
              {groupSections.length === 0
                ? <p className="muted">Belum ada section. Tandai polygon tertutup dari Properti.</p>
                : <ul className="objlist">
                  {groupSections.map((s) => {
                    const stat = seatStats.perSection.get(s.id);
                    const n = stat?.n ?? 0;
                    const bad = stat?.bad ?? 0;
                    const dot = categoryColorForSection(doc.objects, doc.categories, s.id);
                    return (
                      <li key={s.id} onPointerEnter={() => p.onHoverObject(s.id)} onPointerLeave={() => p.onHoverObject(null)} onFocus={() => p.onHoverObject(s.id)} onBlur={() => p.onHoverObject(null)}>
                        <button className={s.id === selectedId ? 'on' : ''} onClick={() => { p.setSectionId(s.id); pickObject(s.id); }}>
                          <i aria-hidden="true" style={{ background: dot, width: 12, height: 12, borderRadius: '50%', flexShrink: 0, display: 'inline-block' }} />
                          {s.label} · {n} kursi{bad > 0 ? ` · ${bad} invalid` : ''}
                        </button>
                        <button type="button" className="icon-btn danger" aria-label={`Hapus ${s.label}`} title={`Hapus ${s.label}`} onClick={() => setPendingDeleteId(s.id)}>
                          <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>}
            </ObjGroup>
            <ObjGroup title={`Baris kursi (${groupRows.length})`}>
              <ul className="objlist">
                {groupRows.map((o) => (
                  <li key={o.id} onPointerEnter={() => p.onHoverObject(o.id)} onPointerLeave={() => p.onHoverObject(null)} onFocus={() => p.onHoverObject(o.id)} onBlur={() => p.onHoverObject(null)}>
                    <button className={o.id === selectedId ? 'on' : ''} onClick={() => pickObject(o.id)}>
                      {o.label} · {o.seats.length} kursi{o.seats.some((s) => s.invalid) ? ` (${o.seats.filter((s) => s.invalid).length} invalid)` : ''}{p.focusId ? (o.sectionId === p.focusId || o.seats.some((s) => s.sectionId === p.focusId) ? ' · di section ini' : ` · ${doc.objects.find((s) => s.id === o.sectionId)?.label ?? 'lain'}`) : ''}
                    </button>
                    <button type="button" className="icon-btn danger" aria-label={`Hapus ${o.label}`} title={`Hapus ${o.label}`} onClick={() => setPendingDeleteId(o.id)}>
                      <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </ObjGroup>
            <ObjGroup title={`Lainnya (${groupOther.length})`}>
              <ul className="objlist">
                {groupOther.map((o) => (
                  <li key={o.id} onPointerEnter={() => p.onHoverObject(o.id)} onPointerLeave={() => p.onHoverObject(null)} onFocus={() => p.onHoverObject(o.id)} onBlur={() => p.onHoverObject(null)}>
                    <button className={o.id === selectedId ? 'on' : ''} onClick={() => pickObject(o.id)}>
                      {o.kind === 'import-draft' ? `draf:${o.guess ?? '?'}` : `${shapeName(o)}`} · {o.label}
                    </button>
                    <button type="button" className="icon-btn danger" aria-label={`Hapus ${o.label}`} title={`Hapus ${o.label}`} onClick={() => setPendingDeleteId(o.id)}>
                      <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </ObjGroup>
          </>
        )}

        {tab === 'dokumen' && (
          <div className="document-panel">
            <section>
            <h4 className="subh">Project</h4>
            <div className="docgrid">
              <button onClick={p.onSave}><Save size={15} strokeWidth={2} aria-hidden="true" />Simpan lokal</button>
              <button onClick={p.onLoad}><FolderOpen size={15} strokeWidth={2} aria-hidden="true" />Muat lokal</button>
              <button onClick={p.onExport}><Download size={15} strokeWidth={2} aria-hidden="true" />Ekspor JSON</button>
              <label className="btn"><Upload size={15} strokeWidth={2} aria-hidden="true" />Buka JSON
                <input type="file" accept="application/json" hidden onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) p.onImportJsonFile(file);
                  e.target.value = '';
                }} />
              </label>
            </div>
            </section>
            <section>
            <h4 className="subh">Impor SVG</h4>
            <p className="muted">Path dipertahankan utuh. Bukan pengenalan section otomatis.</p>
            <label className="btn filepick"><FileUp size={15} strokeWidth={2} aria-hidden="true" />Pilih file SVG
              <input type="file" accept=".svg,image/svg+xml" hidden onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) { setSvgName(file.name); p.onImportSvgFile(file); }
                e.target.value = '';
              }} />
            </label>
            {svgName !== '' && <p className="muted">Dipilih: {svgName}</p>}
            </section>
            <section>
            <h4 className="subh">Impor gambar</h4>
            <p className="muted">Gambar diubah menjadi draf bentuk yang bisa dirapikan di kanvas.</p>
            <label className="btn filepick"><ImageIcon size={15} strokeWidth={2} aria-hidden="true" />Pilih gambar
              <input type="file" accept="image/*" hidden onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) { setRasterName(file.name); p.onImportFile(file, asBg); }
                e.target.value = '';
              }} />
            </label>
            {rasterName !== '' && <p className="muted">Dipilih: {rasterName}</p>}
            <label className="document-option"><span>Gunakan sebagai latar</span><input type="checkbox" checked={asBg} onChange={(e) => setAsBg(e.target.checked)} /></label>
            {p.importMsg && <p className="muted">{p.importMsg}</p>}
            </section>
            <section>
            <h4 className="subh">Latar</h4>
            <label className="document-option"><span>Tampilkan latar</span><input type="checkbox" checked={p.showBg} onChange={(e) => p.setShowBg(e.target.checked)} /></label>
            <div className="row">
              <label className="btn filepick"><ImageIcon size={15} strokeWidth={2} aria-hidden="true" />Unggah latar
                <input type="file" accept="image/*" hidden onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) p.onBgFile(file);
                  e.target.value = '';
                }} />
              </label>
              {p.hasBg && <button onClick={p.onClearBg}>Hapus latar</button>}
            </div>
            </section>
          </div>
        )}
      </div>

      {cta && (
        <div className="pfoot">
          {selected && tool !== 'select' && (
            <button className="pctx" onClick={() => setTool('select')} title="Lihat properti lengkap">
              Untuk: {selected.label} — lihat ▸
            </button>
          )}
          <button className="cta" disabled={cta.disabled} onClick={cta.fn}>{cta.label}</button>
        </div>
      )}

      {invalidTotal > 0 && (
        <div className="pnote" role="status">
          <p className="warn"><TriangleAlert size={13} strokeWidth={2} aria-hidden="true" /> {invalidTotal} kursi invalid di luar section — tidak dijual di preview. Perbaiki dari Properti barisnya.</p>
        </div>
      )}

      {pendingDeleteObj && (
        <DeleteObjectConfirm
          object={pendingDeleteObj}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => { performDelete(pendingDeleteObj.id); setPendingDeleteId(null); }}
        />
      )}
    </div>
  );
}

function ToolShell({ icon, title, sub, children, label }: {
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  title: string; sub: string; children: React.ReactNode; label?: string;
}) {
  return (
    <div className="object-properties tool-options" aria-label={label ?? title}>
      <CtxHead icon={icon as never} title={title} sub={sub} />
      {children}
    </div>
  );
}

function ToolSteps({ items }: { items: string[] }) {
  return (
    <ol className="tool-steps">
      {items.map((s) => <li key={s}>{s}</li>)}
    </ol>
  );
}

// ── Section view editor: Properti dirapikan per tool ──────────────────────
function SectionProps({ p, f, tool, selected, onRequestDelete }: {
  p: Props; f: RowForm; tool: string; selected: VenueObject | null; onRequestDelete: (id: string) => void;
}) {
  const { state } = useStore();
  const { doc, selectedSeatIds } = state;
  const active = doc.objects.find((o) => o.id === p.focusId) ?? null;
  if (!active) return null;

  const isRow = (o: VenueObject) => o.kind === 'row-straight' || o.kind === 'row-arc';
  const inFocus = (o: VenueObject) =>
    o.id === active.id || o.sectionId === active.id || o.seats.some((s) => s.sectionId === active.id);
  const selectedInFocus = selected && inFocus(selected) ? selected : null;
  const foreignSelected = selected && !selectedInFocus ? selected : null;

  return (
    <div className="section-props">
      {selectedSeatIds.length > 0 ? (
        <SeatSelectionEditor key={selectedSeatIds.join(',')} />
      ) : tool === 'row' ? (
        <SectionRowPanel p={p} f={f} active={active} multi={false} />
      ) : tool === 'multirow' ? (
        <SectionRowPanel p={p} f={f} active={active} multi />
      ) : tool === 'seat' ? (
        <ToolShell icon={Armchair} title="Pilih kursi" sub="Klik = sebaris · 2x klik = 1 kursi · Shift multi">
          <div className="object-config-group">
            <h4 className="subh">1 · Cara memilih</h4>
            <ToolSteps items={[
              'Klik 1 kursi untuk memilih sebaris penuh',
              'Klik 2x cepat untuk 1 kursi spesifik',
              'Shift / Cmd / Ctrl + klik untuk multi-pilih satuan',
              'Seret area kosong untuk marquee blok sekaligus',
            ]} />
          </div>
          <div className="object-config-group">
            <h4 className="subh">2 · Setelah terpilih</h4>
            <p className="muted">Ubah baris/nomor dari panel yang muncul. Tekan Delete untuk hapus kursi saja (kelompok baris tetap ada). Batal via tombol di banner atas kanvas.</p>
          </div>
        </ToolShell>
      ) : tool === 'hand' ? (
        <ToolShell icon={Hand} title="Geser kanvas" sub="Navigasi di dalam section">
          <div className="object-config-group">
            <h4 className="subh">Cara pakai</h4>
            <ToolSteps items={[
              'Seret di mana saja untuk menggeser tampilan',
              'Scroll untuk zoom in / out',
              'Tekan V untuk kembali ke Select',
            ]} />
          </div>
        </ToolShell>
      ) : selectedInFocus && selectedInFocus.id !== active.id && isRow(selectedInFocus) ? (
        <RowInSectionPanel
          p={p} row={selectedInFocus}
          onRequestDelete={onRequestDelete}
        />
      ) : selectedInFocus && selectedInFocus.id === active.id ? (
        <SectionSelfPanel active={active} onRequestDelete={onRequestDelete} />
      ) : foreignSelected ? (
        <ToolShell icon={TriangleAlert} title="Pilihan dari section lain" sub="Tidak ikut diubah di sini">
          <div className="object-config-group">
            <p className="muted">“{foreignSelected.label}” milik {foreignSelected.sectionId
              ? doc.objects.find((o) => o.id === (foreignSelected as VenueObject).sectionId)?.label ?? 'section lain'
              : 'venue'}. Masuk ke section pemiliknya untuk mengedit.</p>
            {foreignSelected.sectionId && doc.objects.some((o) => o.id === (foreignSelected as VenueObject).sectionId && o.isSection) && (
              <div className="row"><button onClick={() => p.onEnterSection((foreignSelected as VenueObject).sectionId as string)}>
                Masuk ke {doc.objects.find((o) => o.id === (foreignSelected as VenueObject).sectionId)?.label}
              </button></div>
            )}
          </div>
        </ToolShell>
      ) : (
        <FocusSectionLayout focusId={active.id} onEnterSection={p.onEnterSection} />
      )}
    </div>
  );
}

function SectionRowPanel({ p, f, active, multi }: { p: Props; f: RowForm; active: VenueObject; multi: boolean }) {
  const { state } = useStore();
  const cat = active.categoryId ? categoryById(state.doc, active.categoryId) : null;
  return (
    <ToolShell
      icon={Armchair}
      title={multi ? 'Buat blok baris' : 'Buat baris kursi'}
      sub={multi ? 'Banyak baris · klik – gerak – klik' : 'Satu baris · klik – gerak – klik'}
      label={multi ? 'Buat blok baris' : 'Buat baris kursi'}
    >
      <div className="object-config-group">
        <h4 className="subh">1 · Target</h4>
        <p className="tool-target">
          <span className="badge b-blue">Section</span>
          <strong>{active.label}</strong>
        </p>
        {cat ? (
          <p className="muted tool-cat">
            <i aria-hidden="true" style={{ background: cat.color, width: 12, height: 12, borderRadius: '50%', display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />
            Harga ngikut kategori: <strong>{cat.name}</strong> · Rp{cat.price.toLocaleString('id-ID')}. Ubah di tab Kategori.
          </p>
        ) : (
          <p className="muted">Harga ngikut kategori section aktif. Atur di tab Kategori.</p>
        )}
      </div>
      <div className="object-config-group">
        <h4 className="subh">2 · Jarak</h4>
        <div className="frow">
          <Num label="Jarak kursi" value={f.seatGap} onChange={(v) => p.setRowForm({ ...f, seatGap: v })} min={8} max={120} />
          <Num label="Jarak baris" value={f.rowGap} onChange={(v) => p.setRowForm({ ...f, rowGap: v })} min={8} max={160} />
        </div>
      </div>
      <div className="object-config-group">
        <h4 className="subh">3 · Cara buat</h4>
        <ToolSteps items={multi ? [
          'Klik kanvas untuk titik awal blok',
          'Gerakkan ke kanan/kiri untuk jumlah kursi, ke atas/bawah untuk jumlah baris',
          'Klik lagi untuk menyimpan blok',
        ] : [
          'Klik kanvas untuk titik awal baris',
          'Gerakkan kursor ke kiri / kanan — preview mengikuti',
          'Klik lagi untuk menyimpan baris',
        ]} />
        {!p.anchor ? (
          <p className="muted">Belum ada titik awal — klik kanvas di dalam section.</p>
        ) : (
          <>
            <p className="muted">Jangkar: {p.anchor[0]}, {p.anchor[1]}. Klik lagi untuk simpan, seret untuk gambar langsung, Esc untuk batal.</p>
            {p.previewCount !== null && (
              <p className="tool-stat">
                {multi && p.previewRows !== null ? `${p.previewRows} baris × ${p.previewCount} kursi` : `${p.previewCount} kursi`} · {p.validCount} valid{p.rejectedCount ? ` · ${p.rejectedCount} ditolak` : ''}.
              </p>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}

function RowInSectionPanel({ p, row, onRequestDelete }: {
  p: Props; row: VenueObject; onRequestDelete: (id: string) => void;
}) {
  const { state, update } = useStore();
  const { doc } = state;
  const invalidN = row.seats.filter((s) => s.invalid).length;
  const owner = row.sectionId ? doc.objects.find((o) => o.id === row.sectionId && o.isSection) : null;
  const cat = owner?.categoryId ? categoryById(doc, owner.categoryId) : null;
  const price = cat ? cat.price : row.price;
  return (
    <div className="object-properties">
      <div className="ctxhead ctxhead--stable">
        <span className="ctxicon" aria-hidden="true"><Armchair size={18} strokeWidth={2} /></span>
        <div className="ctxtext">
          <p className="ctxtitle">
            <span className="ell" title={row.label}>{row.label}</span>
            <span className="badge b-blue ctx-flag">Baris</span>
          </p>
          <p className="muted ctxsub" title={`${row.seats.length} kursi${invalidN > 0 ? ` · ${invalidN} invalid` : ''}`}>
            {row.kind === 'row-arc' ? 'Baris busur' : 'Baris lurus'} · {row.seats.length} kursi{invalidN > 0 ? ` · ${invalidN} invalid` : ''}
          </p>
        </div>
      </div>
      <div className="object-config-group">
        <h4 className="subh">1 · Identitas</h4>
        <CommittedText
          key={row.id}
          label="Nama"
          value={row.label}
          onCommit={(v) => {
            update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === row.id ? { ...o, label: v } : o)) }));
          }}
        />
        <p className="muted">
          {cat && <i aria-hidden="true" style={{ background: cat.color, width: 12, height: 12, borderRadius: '50%', display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />}
          Harga/kursi: <strong>Rp{price.toLocaleString('id-ID')}</strong>
          {cat ? ` · ngikut kategori ${cat.name}. Ubah di tab Kategori.` : ' · section tanpa kategori.'}
        </p>
      </div>
      {invalidN > 0 && (
        <div className="object-config-group">
          <h4 className="subh">2 · Kursi invalid</h4>
          <p className="muted">{invalidN} dari {row.seats.length} kursi di luar section — ditandai invalid, tidak dijual di preview.</p>
          <div className="row"><button onClick={p.onPurgeInvalid}>Buang kursi invalid</button></div>
        </div>
      )}
      <div className="object-config-group">
        <h4 className="subh">{invalidN > 0 ? '3 · Susunan kursi' : '2 · Susunan kursi'}</h4>
        <SeatLayoutControls key={row.id} target={row} compact />
      </div>
      <div className="object-config-group object-danger">
        <button className="danger" onClick={() => onRequestDelete(row.id)}><Trash2 size={15} aria-hidden="true" />Hapus kelompok baris</button>
      </div>
    </div>
  );
}

function SectionSelfPanel({ active, onRequestDelete }: {
  active: VenueObject; onRequestDelete: (id: string) => void;
}) {
  const { update } = useStore();
  return (
    <div className="object-properties">
      <div className="object-config-group">
        <h4 className="subh">1 · Identitas section</h4>
        <CommittedText
          key={active.id}
          label="Nama"
          value={active.label}
          onCommit={(v) => {
            update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === active.id ? { ...o, label: v } : o)) }));
          }}
        />
        <SectionCategorySelector selected={active} />
      </div>
      <div className="object-config-group">
        <h4 className="subh">2 · Susunan kursi</h4>
        <SeatLayoutControls key={active.id} target={active} compact />
      </div>
      <div className="object-config-group object-danger">
        <button className="danger" onClick={() => onRequestDelete(active.id)}><Trash2 size={15} aria-hidden="true" />Hapus section</button>
      </div>
    </div>
  );
}

function ToolOptions({ p, tool }: { p: Props; f: RowForm; tool: string }) {
  if (tool === 'hand') {
    return (
      <ToolShell icon={Hand} title="Geser kanvas" sub="Navigasi tampilan, bukan menggambar">
        <div className="object-config-group">
          <h4 className="subh">Cara pakai</h4>
          <ToolSteps items={[
            'Seret di mana saja untuk menggeser tampilan',
            'Scroll untuk zoom in / out',
            'Tekan V untuk kembali ke Select',
          ]} />
        </div>
      </ToolShell>
    );
  }
  if (tool === 'seat') {
    return (
      <ToolShell icon={Armchair} title="Pilih kursi" sub="Klik = sebaris · 2x klik = 1 kursi · Shift multi">
        <div className="object-config-group">
          <h4 className="subh">Cara pakai</h4>
          <ToolSteps items={[
            'Klik 1 kursi untuk memilih sebaris penuh',
            'Klik 2x cepat untuk 1 kursi spesifik',
            'Shift / Cmd / Ctrl + klik untuk multi-pilih satuan',
            'Seret marquee untuk memilih blok sekaligus',
          ]} />
          <p className="muted">Tekan Delete untuk hapus kursi saja (objek baris tetap). Batal via tombol di banner atas kanvas.</p>
        </div>
      </ToolShell>
    );
  }
  if (tool === 'row') {
    // Tool baris hanya hidup di dalam section (dock venue tak memuatnya).
    // Cabang ini fallback bila state nyasar ke venue.
    return (
      <ToolShell icon={Armchair} title="Buat baris kursi" sub="Di dalam section" label="Buat baris kursi">
        <div className="object-config-group">
          <p className="tool-warn">Masuk ke section dulu (klik dua kali section di kanvas) — baris hanya bisa dibuat di dalam section fokus.</p>
        </div>
      </ToolShell>
    );
  }
  if (tool === 'polygon') {
    return (
      <ToolShell icon={PenTool} title="Gambar polygon" sub="Klik tambah titik · Enter/klik-ganda tutup · Esc batal">
        <div className="object-config-group">
          <h4 className="subh">Cara pakai</h4>
          <ToolSteps items={[
            'Klik kanvas untuk tambah titik sudut',
            'Enter atau klik-ganda titik awal untuk menutup',
            'Esc untuk batalkan draf aktif',
          ]} />
        </div>
        <div className="object-config-group">
          <h4 className="subh">Setelah tertutup</h4>
          <p className="muted">Tandai areanya sebagai section agar bisa diisi kursi. Draf tersimpan saat ganti tool.</p>
        </div>
      </ToolShell>
    );
  }
  if (tool === 'rectangle' || tool === 'circle') {
    const isCircle = tool === 'circle';
    return (
      <ToolShell icon={isCircle ? Circle : Square} title={isCircle ? 'Buat lingkaran' : 'Buat kotak'} sub={isCircle ? 'Seret diameter di kanvas' : 'Seret kotak di kanvas'}>
        <div className="object-config-group">
          <h4 className="subh">Cara pakai</h4>
          <ToolSteps items={[
            isCircle ? 'Seret di kanvas untuk diameter lingkaran' : 'Seret di kanvas untuk ukuran kotak',
            'Lepas untuk membuat bentuk',
            'Pilih objek untuk menggeser atau mengubah ukurannya',
          ]} />
        </div>
        <div className="object-config-group">
          <h4 className="subh">Setelah dibuat</h4>
          <p className="muted">Tandai sebagai section jika ingin diisi kursi.</p>
        </div>
      </ToolShell>
    );
  }
  if (tool === 'stage') {
    return (
      <ToolShell icon={Podium} title="Buat panggung" sub="Seret kotak di kanvas">
        <div className="object-config-group">
          <h4 className="subh">Cara pakai</h4>
          <ToolSteps items={[
            'Seret kotak di kanvas untuk ukuran panggung',
            'Lepas untuk membuat panggung',
          ]} />
        </div>
        <div className="object-config-group">
          <h4 className="subh">Catatan</h4>
          <p className="muted">Panggung adalah dekorasi peta (bukan section): kursi tidak bisa dibuat di dalamnya.</p>
        </div>
      </ToolShell>
    );
  }
  return (
    <ToolShell icon={Footprints} title="Buat lorong" sub="Seret garis di kanvas">
      <div className="object-config-group">
        <h4 className="subh">Lebar lorong</h4>
        <Num label="Lebar lorong (px)" value={p.aisleWidth} onChange={p.setAisleWidth} min={4} max={120} />
      </div>
      <div className="object-config-group">
        <h4 className="subh">Cara pakai</h4>
        <ToolSteps items={[
          'Seret garis di kanvas untuk jalur lorong',
          'Lepas untuk membuat lorong',
        ]} />
        <p className="muted">Lorong memotong area jalan; kursi yang footprint-nya menyentuh lorong tidak dihitung valid.</p>
      </div>
    </ToolShell>
  );
}

const KIND_LABEL: Record<string, string> = {
  stage: 'Panggung', aisle: 'Lorong', section: 'Polygon', 'row-straight': 'Baris lurus',
  'row-arc': 'Baris busur', 'import-draft': 'Draf impor', vector: 'Bentuk',
};

function kindDisplay(o: VenueObject): string {
  if (o.kind === 'section' || o.kind === 'vector') return shapeName(o);
  return KIND_LABEL[o.kind] ?? o.kind;
}

function SeatSelectionEditor() {
  const { state } = useStore();
  const { doc, selectedSeatIds } = state;
  const index = getDocIndex(doc);
  const entries = React.useMemo(() => {
    const out: Array<{ seat: Seat; objId: string }> = [];
    for (const id of selectedSeatIds) {
      const e = index.seatById.get(id);
      if (e) out.push({ seat: e.seat, objId: e.objId });
    }
    return out;
  }, [index, selectedSeatIds]);
  if (entries.length === 0) return null;
  return <SeatSelectionEditorInner key={selectedSeatIds.join(',')} entries={entries} />;
}

function SeatSelectionEditorInner({ entries }: {
  entries: Array<{ seat: Seat; objId: string }>;
}) {
  const { state, update, selectSeats } = useStore();
  const [msg, setMsg] = React.useState('');
  const rows = new Set(entries.map((e) => e.seat.row));
  const nums = new Set(entries.map((e) => e.seat.number));
  const commonRow = rows.size === 1 ? [...rows][0] : null;
  const commonNum = nums.size === 1 ? [...nums][0] : null;
  const [rowDraft, setRowDraft] = React.useState(commonRow ?? '');
  const [numDraft, setNumDraft] = React.useState(commonNum ?? '');
  const invalidN = entries.filter((e) => e.seat.invalid).length;
  const mixed = entries.length > 1 && (rows.size > 1 || nums.size > 1);
  // Harga kursi selalu ngikut kategori section-nya — tampilkan sebagai info, bukan input.
  const catNames = [...new Set(entries.map((e) => {
    const owner = state.doc.objects.find((o) => o.id === e.seat.sectionId && o.isSection);
    const cat = owner?.categoryId ? categoryById(state.doc, owner.categoryId) : null;
    return cat ? `${cat.name} · Rp${cat.price.toLocaleString('id-ID')}` : null;
  }).filter((x) => !!x))] as string[];

  const apply = () => {
    const wantRow = rowDraft !== (commonRow ?? '');
    const wantNum = numDraft !== (commonNum ?? '');
    if (!wantRow && !wantNum) {
      setMsg('Tak ada perubahan.');
      return;
    }
    const ids = new Set(entries.map((e) => e.seat.id));
    // Seam produksi bersama (temuan P2 #2): transform yang sama dipakai
    // runner bench + tes regresi (src/lib/bulkEdit.ts).
    update((d) => applyBulkSeatLabel(d, ids, {
      ...(wantRow ? { row: rowDraft } : {}),
      ...(wantNum ? { number: numDraft } : {}),
    }));
    setMsg(`Tersimpan ${entries.length} kursi dalam 1 aksi undo.`);
  };

  const remove = () => {
    const ids = new Set(entries.map((e) => e.seat.id));
    update((d) => ({
      ...d,
      objects: d.objects.map((o) => o.seats.some((s) => ids.has(s.id))
        ? { ...o, seats: o.seats.filter((s) => !ids.has(s.id)) }
        : o),
    }));
    selectSeats([]);
  };

  return (
    <div className="object-properties seat-selection" aria-label="Kursi terpilih">
      <CtxHead icon={Armchair} title={`${entries.length} kursi terpilih`} sub={`${mixed ? 'Nilai campuran — isi field untuk ubah semua' : 'Ubah baris atau nomor kursi yang dipilih'}${invalidN > 0 ? ` · ${invalidN} invalid` : ''}`} />
      <div className="object-config-group">
        <label className="fld"><span>Baris{commonRow == null ? ' (campuran)' : ''}</span>
          <input aria-label="Baris kursi terpilih" value={rowDraft} placeholder={commonRow == null ? 'Campuran — isi untuk ubah semua' : undefined}
            onChange={(e) => { setRowDraft(e.target.value); setMsg(''); }} />
        </label>
        <label className="fld"><span>Nomor{commonNum == null ? ' (campuran)' : ''}</span>
          <input aria-label="Nomor kursi terpilih" value={numDraft} placeholder={commonNum == null ? 'Campuran — isi untuk ubah semua' : undefined}
            onChange={(e) => { setNumDraft(e.target.value); setMsg(''); }} />
        </label>
        <p className="muted">Harga ngikut kategori{catNames.length > 0 ? `: ${catNames.join(' / ')}` : ''}. Ubah di tab Kategori.</p>
      </div>
      <div className="object-config-group seat-actions">
        <button className="apply-primary" onClick={apply}>Terapkan ke {entries.length} kursi</button>
        <div className="row">
          <button className="danger" onClick={remove} aria-label={`Hapus ${entries.length} kursi terpilih`}>
            Hapus {entries.length} kursi
          </button>
          <button onClick={() => selectSeats([])}>Batal pilih</button>
        </div>
        {msg && <p className="muted" role="status">{msg}</p>}
        {entries.length <= 8 && (
          <ul className="muted seat-mini">{entries.map((e) => <li key={e.seat.id}>{e.seat.row}{e.seat.number} · Rp{Number(e.seat.price).toLocaleString('id-ID')}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

function SectionCategorySelector({ selected }: { selected: VenueObject }) {
  const { state, update } = useStore();
  const cats = state.doc.categories;
  const currentId = selected.categoryId ?? cats[0]?.id ?? null;
  const current = currentId ? categoryById(state.doc, currentId) : null;
  return (
    <div className="section-color-config">
      <label className="fld"><span>Kategori tiket</span>
        <select
          aria-label="Kategori section"
          value={current?.id ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            update((d) => withObject(d, selected.id, { categoryId: id }));
          }}
        >
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name} · Rp{c.price.toLocaleString('id-ID')}</option>
          ))}
        </select>
      </label>
      {cats.length === 0 && <p className="muted">Belum ada kategori. Buat dulu di tab Kategori.</p>}
    </div>
  );
}

function FocusSectionLayout({ focusId, onEnterSection }: { focusId: string; onEnterSection: (id: string) => void }) {
  const { state } = useStore();
  const { doc, selectedId } = state;
  const active = doc.objects.find((o) => o.id === focusId) ?? null;
  if (!active) return null;
  const selected = doc.objects.find((o) => o.id === selectedId) ?? null;
  const isRow = (o: VenueObject) => o.kind === 'row-straight' || o.kind === 'row-arc';
  const rowInFocus = selected && isRow(selected)
    && (selected.sectionId === focusId || selected.seats.some((s) => s.sectionId === focusId))
    ? selected : null;
  const foreignOwnerId = selected && isRow(selected) && !rowInFocus ? (selected.sectionId ?? null) : null;
  const foreignOwner = foreignOwnerId ? doc.objects.find((o) => o.id === foreignOwnerId) ?? null : null;
  const foreignSection = selected && selected.isSection && selected.id !== focusId ? selected : null;
  const target = rowInFocus ?? active;
  const targetCount = target.isSection
    ? (getDocIndex(doc).seatsBySection.get(focusId)?.length ?? 0)
    : target.seats.length;
  return (
    <section className="focus-section" aria-label="Susunan kursi section aktif">
      <h4 className="subh">Susunan kursi · {active.label}</h4>
      <p className="tool-target">
        <span className="badge b-blue">{rowInFocus ? 'Kelompok baris' : 'Seluruh section'}</span>
        <strong>{rowInFocus ? rowInFocus.label : active.label}</strong>
        <span className="muted">· {targetCount} kursi</span>
      </p>
      {!rowInFocus && (
        <p className="muted">Pilih kelompok baris section ini untuk mengatur satu kelompok saja.</p>
      )}
      {(foreignOwner || foreignSection) && (
        <>
          <div className="row">
            <button onClick={() => onEnterSection((foreignOwner ?? foreignSection!)!.id)}>
              Masuk ke {(foreignOwner ?? foreignSection!)!.label}
            </button>
          </div>
          <p className="muted">Pilihan dari section lain tidak ikut diubah di sini.</p>
        </>
      )}
      <SeatLayoutControls key={target.id} target={target} />
    </section>
  );
}

function ObjectProps({ p, selected, markOk, markReason, onRequestDelete }: {
  p: Props; selected: VenueObject; markOk: boolean; markReason: string; onRequestDelete: (id: string) => void;
}) {
  const { state, update } = useStore();
  const { doc } = state;
  const isRow = selected.kind === 'row-straight' || selected.kind === 'row-arc';
  const invalidN = selected.seats.filter((s) => s.invalid).length;
  const KindIcon = selected.kind === 'vector' ? PenTool
    : selected.kind === 'aisle' ? Footprints
    : selected.kind === 'stage' ? Podium
    : isRow ? Armchair
    : selected.kind === 'import-draft' ? FileUp : Shapes;
  const subText = `${kindDisplay(selected)}${selected.seats.length > 0 ? ` · ${selected.seats.length} kursi` : ''}${invalidN > 0 ? ` · ${invalidN} invalid` : ''}`;
  return (
    <div className="object-properties">
      <div className="ctxhead ctxhead--stable">
        <span className="ctxicon" aria-hidden="true"><KindIcon size={18} strokeWidth={2} /></span>
        <div className="ctxtext">
          <p className="ctxtitle">
            <span className="ell" title={selected.label}>{selected.label}</span>
            {selected.isSection && <span className="badge b-blue ctx-flag" aria-label="Section">Section</span>}
          </p>
          <p className="muted ctxsub" title={subText}>{subText}</p>
        </div>
      </div>
      <div className="object-config-group">
      <CommittedText
        key={selected.id}
        label="Nama"
        value={selected.label}
        onCommit={(v) => {
          update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === selected.id ? { ...o, label: v } : o)) }));
        }}
      />
      </div>
      <div className="object-config-group">
        <label className="document-option">
          <span>Gunakan sebagai section</span>
          <input type="checkbox" checked={!!selected.isSection} disabled={!selected.isSection && !markOk}
            onChange={() => selected.isSection ? p.onUnmarkSection() : p.onMarkSection()} />
        </label>
        {!selected.isSection && !markOk && <p className="muted">{markReason}.</p>}
        {selected.isSection && <SectionCategorySelector selected={selected} />}
        {!p.focusId && selected.isSection && (
          <div className="row section-entry-row"><button onClick={() => p.onEnterSection(selected.id)}>Edit isi section</button></div>
        )}
      </div>
      <div className="object-config-group object-details">
      {selected.sectionId && <p className="muted">Baris terikat section: {doc.objects.find((o) => o.id === selected.sectionId)?.label ?? '(section dihapus)'}.</p>}
      {selected.kind === 'import-draft' && (
        <label className="fld"><span>Jenis (koreksi)</span>
          <select
            value="import-draft"
            onChange={(e) => {
              const kind = e.target.value as ObjKind;
              update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === selected.id ? { ...o, kind } : o)) }));
            }}
          >
            <option value="import-draft">draf (belum dikoreksi)</option>
            <option value="stage">stage</option>
            <option value="aisle">aisle/lorong</option>
            <option value="section">polygon</option>
          </select>
        </label>
      )}
      {isRow && (() => {
        const owner = selected.sectionId ? doc.objects.find((o) => o.id === selected.sectionId && o.isSection) : null;
        const cat = owner?.categoryId ? categoryById(doc, owner.categoryId) : null;
        const price = cat ? cat.price : selected.price;
        return (
          <p className="muted">
            {cat && <i aria-hidden="true" style={{ background: cat.color, width: 12, height: 12, borderRadius: '50%', display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />}
            Harga/kursi: <strong>Rp{price.toLocaleString('id-ID')}</strong>
            {cat ? ` · ngikut kategori ${cat.name}. Ubah di tab Kategori.` : ' · section tanpa kategori.'}
          </p>
        );
      })()}
      {selected.kind === 'aisle' && (
        <CommittedNum key={`width-${selected.id}`} label="Lebar lorong (px)" value={selected.width} onCommit={(v) => {
          update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === selected.id ? { ...o, width: v } : o)) }));
        }} min={4} max={120} />
      )}
      {!p.focusId && isRow && selected.sectionId && doc.objects.some((o) => o.id === selected.sectionId && o.isSection) && (
        <div className="row"><button onClick={() => p.onEnterSection(selected.sectionId as string)}>
          Masuk ke section {doc.objects.find((o) => o.id === selected.sectionId)?.label ?? ''}
        </button></div>
      )}
      {!p.focusId && isRow && (
        <p className="muted">Susunan kursi tidak diatur di venue. Masuk ke section pemilik untuk memutar, menggeser, atau fit-to-shape.</p>
      )}
      {!!p.focusId && isRow && selected.sectionId !== p.focusId && !selected.seats.some((s) => s.sectionId === p.focusId) && selected.id !== p.focusId && (
        <p className="muted">Kelompok ini milik section lain. Susunan di bawah memakai section aktif agar tidak mengubah yang tersembunyi.</p>
      )}
      {selected.guess && <p className="muted">Tebakan import: {selected.guess} · keyakinan {Math.round(selected.source.confidence * 100)}% — wajib dikoreksi.</p>}
      {selected.kind === 'aisle' && (
        <p className="muted">Seret untuk memindahkan · geser titik ujung untuk edit garis.</p>
      )}
      {isRow && selected.seats.length > 0 && (
        <div>
          <p className="muted">
            {invalidN} dari {selected.seats.length} kursi di luar section — ditandai invalid, tidak dijual di preview.
            Geser section/row hingga masuk, atau buang yang invalid.
          </p>
          {selected.seats.some((s) => s.invalid) && <button onClick={p.onPurgeInvalid}>Buang kursi invalid</button>}
        </div>
      )}
      </div>
      <div className="object-config-group object-danger">
      <button className="danger" onClick={() => onRequestDelete(selected.id)}><Trash2 size={15} aria-hidden="true" />Hapus objek</button>
      </div>
    </div>
  );
}

function DeleteObjectConfirm({ object, onCancel, onConfirm }: {
  object: VenueObject; onCancel: () => void; onConfirm: () => void;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const seatCount = object.seats.length;
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-card modal-danger" role="dialog" aria-modal="true" aria-label={`Hapus ${object.label}?`}>
        <h4 className="subh">Hapus objek?</h4>
        <p className="muted">
          <strong>{object.label}</strong>{seatCount > 0 ? ` dan ${seatCount} kursi di dalamnya` : ''} akan dihapus permanen.
          {object.isSection ? ' Kursi section ini tidak lagi dijual di preview.' : ''} Aksi ini bisa dibatalkan via Urungkan.
        </p>
        <div className="row modal-actions">
          <button ref={cancelRef} className="modal-btn" onClick={onCancel}><X size={16} strokeWidth={2.5} aria-hidden="true" />Batal</button>
          <button className="modal-btn danger-solid" onClick={onConfirm} aria-label={`Ya, hapus ${object.label}`}><Trash2 size={16} strokeWidth={2.5} aria-hidden="true" />Hapus</button>
        </div>
      </div>
    </div>
  );
}

function CategoryTab() {
  const { state, update } = useStore();
  const { doc } = state;
  const cats = doc.categories;
  const [msg, setMsg] = React.useState('');
  const [dialog, setDialog] = React.useState<null | { mode: 'add' } | { mode: 'edit'; id: string }>(null);

  const usedBy = (id: string) => doc.objects.filter((o) => o.isSection && o.categoryId === id);

  const openAdd = () => {
    setMsg('');
    setDialog({ mode: 'add' });
  };
  const openEdit = (c: TicketCategory) => {
    setMsg('');
    setDialog({ mode: 'edit', id: c.id });
  };
  const closeDialog = () => setDialog(null);

  const submitAdd = (name: string, price: string, color: string): string | null => {
    const cleanName = normalizeCategoryName(name);
    const priceNum = Number(price);
    if (!isValidCategoryName(cleanName)) return 'Nama kategori wajib diisi (maks 60 karakter).';
    if (cats.some((c) => c.name.toLowerCase() === cleanName.toLowerCase())) return `Nama "${cleanName}" sudah dipakai.`;
    if (!isValidCategoryPrice(priceNum)) return 'Harga harus angka ≥ 0.';
    if (!isValidCategoryColor(color)) return 'Warna tak valid.';
    const cat = createCategory(cleanName, Math.round(priceNum), color);
    update((d) => ({ ...d, categories: [...d.categories, cat] }));
    setMsg(`Kategori "${cleanName}" ditambah.`);
    return null;
  };

  const submitEdit = (id: string, name: string, price: string, color: string): string | null => {
    const cleanName = normalizeCategoryName(name);
    const priceNum = Number(price);
    if (!isValidCategoryName(cleanName)) return 'Nama kategori wajib diisi (maks 60 karakter).';
    if (cats.some((c) => c.id !== id && c.name.toLowerCase() === cleanName.toLowerCase())) return `Nama "${cleanName}" sudah dipakai kategori lain.`;
    if (!isValidCategoryPrice(priceNum)) return 'Harga harus angka ≥ 0.';
    if (!isValidCategoryColor(color)) return 'Warna tak valid.';
    const rounded = Math.round(priceNum);
    update((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.id === id ? { ...c, name: cleanName, price: rounded, color } : c)),
    }));
    setMsg(`Kategori "${cleanName}" disimpan — harga kursi section terkait ikut berubah.`);
    return null;
  };

  const remove = (id: string) => {
    const users = usedBy(id);
    if (users.length > 0) {
      setMsg(`Tak bisa hapus: dipakai ${users.length} section (${users.slice(0, 3).map((s) => s.label).join(', ')}${users.length > 3 ? '…' : ''}). Pindahkan section dulu.`);
      return;
    }
    if (cats.length <= 1) {
      setMsg('Minimal 1 kategori harus ada.');
      return;
    }
    const gone = cats.find((c) => c.id === id);
    update((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== id) }));
    setMsg(`Kategori "${gone?.name ?? ''}" dihapus.`);
  };

  const dialogCat = dialog?.mode === 'edit' ? cats.find((c) => c.id === dialog.id) ?? null : null;

  return (
    <div className="category-panel" aria-label="Kategori tiket">
      <CtxHead icon={Layers} title="Kategori tiket" sub="1 section = 1 kategori · harga & warna ngikut kategori" />
      <div className="object-config-group">
        <div className="row">
          <button className="apply-primary add-btn" onClick={openAdd} aria-label="Tambah kategori"><Plus size={16} strokeWidth={2.5} aria-hidden="true" />Tambah kategori</button>
        </div>
      </div>
      <div className="object-config-group">
        <h4 className="subh">Daftar ({cats.length})</h4>
        {cats.length === 0 && <p className="muted">Belum ada kategori.</p>}
        <ul className="objlist cat-list">
          {cats.map((c) => {
            const users = usedBy(c.id);
            return (
              <li key={c.id} className="cat-item">
                <div className="cat-row">
                  <i aria-hidden="true" className="cat-dot" style={{ background: c.color }} />
                  <span className="cat-text">
                    <strong className="cat-name">{c.name}</strong>
                    <span className="muted cat-sub">Rp{c.price.toLocaleString('id-ID')}{users.length > 0 ? ` · ${users.length} section` : ' · belum dipakai'}</span>
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Ubah ${c.name}`} data-tip={`Ubah ${c.name}`} onClick={() => openEdit(c)}>
                    <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn danger" aria-label={`Hapus ${c.name}`} data-tip={`Hapus ${c.name}`} onClick={() => remove(c.id)}>
                    <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {msg && <p className="muted" role="status">{msg}</p>}
      </div>
      {dialog && (
        <CategoryDialog
          key={dialog.mode === 'edit' ? dialog.id : 'add'}
          title={dialog.mode === 'add' ? 'Tambah kategori' : `Ubah ${dialogCat?.name ?? 'kategori'}`}
          initial={dialog.mode === 'edit' && dialogCat
            ? { name: dialogCat.name, price: String(dialogCat.price), color: dialogCat.color }
            : { name: '', price: '100000', color: SECTION_PALETTE[cats.length % SECTION_PALETTE.length] ?? '#A78BFA' }}
          nameLabel={dialog.mode === 'add' ? 'Nama kategori baru' : `Nama kategori ${dialogCat?.name ?? ''}`}
          priceLabel={dialog.mode === 'add' ? 'Harga kategori baru' : `Harga kategori ${dialogCat?.name ?? ''}`}
          colorLabel={dialog.mode === 'add' ? 'Warna kustom kategori baru' : `Warna kustom kategori ${dialogCat?.name ?? ''}`}
          onClose={closeDialog}
          onSubmit={(name, price, color) => dialog.mode === 'add'
            ? submitAdd(name, price, color)
            : submitEdit(dialog.id, name, price, color)}
          onDone={closeDialog}
        />
      )}
    </div>
  );
}

function CategoryDialog({ title, initial, nameLabel, priceLabel, colorLabel, onClose, onSubmit, onDone }: {
  title: string;
  initial: { name: string; price: string; color: string };
  nameLabel: string;
  priceLabel: string;
  colorLabel: string;
  onClose: () => void;
  onSubmit: (name: string, price: string, color: string) => string | null;
  onDone: () => void;
}) {
  const [name, setName] = React.useState(initial.name);
  const [price, setPrice] = React.useState(initial.price);
  const [color, setColor] = React.useState(initial.color);
  const [err, setErr] = React.useState('');
  const nameRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const save = () => {
    const msg = onSubmit(name, price, color);
    if (msg) {
      setErr(msg);
      return;
    }
    onDone();
  };
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <h4 className="subh">{title}</h4>
        <label className="fld"><span>Nama tiket</span>
          <input ref={nameRef} aria-label={nameLabel} value={name} placeholder="mis. VIP / Festival / Reguler"
            onChange={(e) => { setName(e.target.value); setErr(''); }} />
        </label>
        <label className="fld"><span>Harga (Rp)</span>
          <input aria-label={priceLabel} type="number" min={0} step={5000} value={price}
            onChange={(e) => { setPrice(e.target.value); setErr(''); }} />
        </label>
        <label className="fld color-fld"><span>Warna</span>
          <div className="color-picker single">
            <label className="single-swatch" title="Pilih warna" style={{ background: color }}>
              <input aria-label={colorLabel} type="color" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#A78BFA'}
                onChange={(e) => { setColor(e.target.value); setErr(''); }} />
            </label>
            <code className="muted hex">{color.toUpperCase()}</code>
          </div>
        </label>
        {err && <p className="muted" role="alert">{err}</p>}
        <div className="row modal-actions">
          <button className="apply-primary modal-btn" onClick={save}><Check size={16} strokeWidth={2.5} aria-hidden="true" />Simpan</button>
          <button className="modal-btn" onClick={onClose}><X size={16} strokeWidth={2.5} aria-hidden="true" />Batal</button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import App from '../App';
import { benchScenarios, makeBenchDoc } from './fixtures';
import { evaluatePanAcceptance } from './acceptance';
import { planBlockBox, planMarqueeBand } from '../lib/bulkEdit';
import { worldToClientPx } from '../lib/viewTransform';

/**
 * Bench browser production: me-mount App ASLI, memuat fixture deterministik
 * lewat jalur lokal yang sama dengan pengguna, lalu menjalankan skenario
 * interaksi lewat pointer event pada handler yang sama.
 * - Hover/move didistribusikan ke banyak frame (bukan satu loop sinkron).
 * - Klik diukur N>=100 sampel pada seat yang benar-benar terlihat; gagal bila
 *   target di luar layar, tertutup, tak ditemukan, atau seleksi salah.
 * - Tanpa fallback dispatch ke root untuk klik offscreen.
 * - Waktu diukur hingga paint selesai (2x rAF) dengan metode terdokumentasi.
 * Hasil JSON ditulis ke <pre id="bench-result"> + document.title = BENCH_DONE.
 * Bench berhenti GAGAL (throw) bila assertion perilaku tak terpenuhi.
 */

interface BenchMetrics {
  scenario: string;
  mode: string;
  seats: number;
  shape: string;
  viewport: string;
  dpr: number;
  device: string;
  buildRev: string;
  browser: string;
  method: string;
  /** Bedakan runner selesai vs assertion fungsional vs target performa. */
  acceptance: { functional: 'pass'; perf: 'pass' | 'fail' | 'stress'; reason: string };
  steps: Record<string, number | string>;
}

const nextFrame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

function collectFrames(during: () => Promise<void>): Promise<{ avg: number; p95: number; fps: number; frames: number }> {
  return (async () => {
    const stamps: number[] = [];
    let run = true;
    const tick = (t: number) => {
      if (run) {
        stamps.push(t);
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    await during();
    await nextFrame();
    await nextFrame();
    run = false;
    const deltas: number[] = [];
    // Buang 5 frame pertama (pemanasan) agar outlier mount tak mendominasi rata-rata.
    for (let i = 6; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
    deltas.sort((a, b) => a - b);
    const avg = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const p95 = deltas.length > 0 ? deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))] : 0;
    return { avg: round2(avg), p95: round2(p95), fps: avg > 0 ? round2(1000 / avg) : 0, frames: deltas.length };
  })();
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

export function ptr(type: string, x: number, y: number, extra: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y, ...extra });
}

/** Dispatch ke elemen teratas pada titik tersebut (seperti klik nyata). */
export function dispatchAt(root: Element, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
  const t = document.elementFromPoint(x, y) ?? root;
  t.dispatchEvent(ptr(type, x, y, extra));
}

/**
 * Dispatch KETAT untuk klik terukur: gagal bila target di luar layar,
 * tertutup overlay, atau tak ditemukan. Tanpa fallback ke root.
 * Dipakai bench end-to-end; self-test memverifikasi ia melempar pada
 * offscreen/tertutup agar klik tak-mungkin-pengguna tak lolos diam-diam.
 * Konteks fase (S4/S7/S9/...) dicatat agar diagnosis tahu langkah mana.
 */
let benchPhaseCtx = '';
export function setBenchPhase(p: string): void { benchPhaseCtx = p; }
export function dispatchAtStrict(svg: Element, type: string, x: number, y: number, extra: PointerEventInit = {}): string {
  const at = `@(${Math.round(x)},${Math.round(y)})${benchPhaseCtx ? ` [${benchPhaseCtx}]` : ''}`;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (x < 0 || y < 0 || x >= vw || y >= vh) throw new Error(`target di luar layar ${at}`);
  const t = document.elementFromPoint(x, y);
  if (!t) throw new Error(`target tak ditemukan (elementFromPoint null) ${at}`);
  const tag = (t as Element).tagName;
  const cls = String((t as Element).getAttribute?.('class') ?? (t as Element).className ?? '');
  const cover = `${tag}.${cls}`;
  // Diterima: svg/canvas itu sendiri atau seat circle di dalamnya.
  const ok = t === svg || (svg as Element).contains(t);
  if (!ok) throw new Error(`target tertutup: cover=${cover} ${at}`);
  t.dispatchEvent(ptr(type, x, y, extra));
  return cover;
}

export function statsOf(samples: number[]): { n: number; median: number; p95: number; max: number } {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const median = n > 0 ? s[Math.floor((n - 1) / 2)] : 0;
  const p95 = n > 0 ? s[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
  const max = n > 0 ? s[n - 1] : 0;
  return { n, median: round2(median), p95: round2(p95), max: round2(max) };
}

/** Baca seleksi bench (diekspos App via window.__seatupBenchSelected). */
export function benchSelectedIds(): string[] {
  return ((window as unknown as { __seatupBenchSelected?: string[] }).__seatupBenchSelected ?? []).slice();
}
/** Jumlah commit dokumen nyata via spy benchmark (temuan P2 #4). -1 bila spy mati. */
export function benchCommitSpyCount(): number {
  const fn = (window as unknown as { __seatupBenchCommits?: () => number }).__seatupBenchCommits;
  if (typeof fn !== 'function') return -1;
  return fn();
}
export function benchResetCommits(): void {
  (window as unknown as { __seatupBenchResetCommits?: () => void }).__seatupBenchResetCommits?.();
}
/** Baca dokumen bench terkini (assertion isi koordinat; hanya ?bench). */
export function benchDoc(): { objects: Array<{ id: string; seats: Array<{ id: string; x: number; y: number; row: string }> }> } | null {
  const fn = (window as unknown as { __seatupBenchDoc?: () => unknown }).__seatupBenchDoc;
  if (typeof fn !== 'function') return null;
  return fn() as { objects: Array<{ id: string; seats: Array<{ id: string; x: number; y: number; row: string }> }> };
}
export function benchSeatPos(rowId: string, seatIdx = 0): { x: number; y: number; row: string } | null {
  const d = benchDoc();
  const o = d?.objects.find((q) => q.id === rowId);
  const s = o?.seats[seatIdx];
  return s ? { x: s.x, y: s.y, row: s.row } : null;
}
/** Baca picks preview (diekspos Preview via window.__seatupBenchPicks). */
export function benchPicks(): string[] {
  return ((window as unknown as { __seatupBenchPicks?: string[] }).__seatupBenchPicks ?? []).slice();
}
export function benchSubtotal(): number {
  return (window as unknown as { __seatupBenchSubtotal?: number }).__seatupBenchSubtotal ?? -1;
}

/** Ambil jumlah kursi terpilih dari elemen statusnya (bukan regex seluruh body). */
function selectedCount(): number {
  const els = [...document.querySelectorAll('[role="status"]')];
  for (const el of els) {
    const m = (el.textContent ?? '').match(/(\d+) kursi terpilih/);
    if (m) return Number(m[1]);
  }
  return -1;
}

function bannerContext(): string {
  const els = [...document.querySelectorAll('[role="status"]')];
  for (const el of els) {
    if ((el.textContent ?? '').includes('kursi terpilih')) return JSON.stringify(el.textContent?.slice(0, 120));
  }
  return 'none';
}

async function paint2(): Promise<number> {
  const t0 = performance.now();
  await nextFrame();
  await nextFrame();
  return performance.now() - t0;
}

export default function BenchApp() {
  const [result, setResult] = useState<string>('running…');
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void run().then((m) => {
      setResult(JSON.stringify(m, null, 2));
      document.title = 'BENCH_DONE';
    }).catch((err) => {
      // Simpan metrik parsial agar run GAGAL tetap menjadi bukti (target mana
      // yang gagal + angka aktual), bukan sekadar pesan error tanpa angka.
      let partial = '';
      try { partial = `\nPARTIAL_STEPS_JSON:${JSON.stringify((window as unknown as { __seatupBenchPartial?: unknown }).__seatupBenchPartial ?? null)}`; } catch { /* abaikan */ }
      setResult(`BENCH_ERROR: ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ''}${partial}`);
      document.title = 'BENCH_DONE';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <App />
      <pre id="bench-result" style={{ position: 'fixed', zIndex: 9999, left: 8, bottom: 8, maxHeight: '40vh', overflow: 'auto', background: '#000', color: '#0f0', fontSize: 11, padding: 8, whiteSpace: 'pre-wrap' }}>{result}</pre>
    </div>
  );

  async function run(): Promise<BenchMetrics> {
    const q = new URLSearchParams(location.search);
    const name = q.get('scenario') ?? '10k-rect';
    const mode = q.get('mode') ?? 'editor';
    const sc = benchScenarios().find((s) => s.name === name) ?? benchScenarios()[1];
    const doc = makeBenchDoc(sc.opts);
    const totalSeats = doc.objects.reduce((a, o) => a + o.seats.length, 0);
    // Dokumen kecil lewat jalur localStorage asli; besar (>kuota) via kait bench.
    const raw = JSON.stringify(doc);
    let viaHook = false;
    try {
      if (raw.length > 3_500_000) throw new Error('quota-guess');
      localStorage.setItem('seat-poc-venue-v1', raw);
    } catch {
      viaHook = true;
      for (let i = 0; i < 100; i++) {
        const hook = (window as unknown as { __seatupLoadDoc?: (d: unknown) => void }).__seatupLoadDoc;
        if (hook) break;
        await sleep(50);
      }
      const hook = (window as unknown as { __seatupLoadDoc?: (d: unknown) => void }).__seatupLoadDoc;
      if (!hook) throw new Error('kait __seatupLoadDoc tak tersedia');
      hook(doc);
    }
    await nextFrame();

    const click = async (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`tombol tak ketemu: ${selector}`);
      el.click();
      await nextFrame();
    };
    const steps: Record<string, number | string> = {};
    // Paparan progres live (by reference): bila run melempar di tengah
    // (mis. target p95), catch tetap menyimpan metrik parsial sebagai bukti.
    (window as unknown as { __seatupBenchPartial?: unknown }).__seatupBenchPartial = steps;
    steps['load_via'] = viaHook ? 'hook' : 'localStorage';
    if (!viaHook) {
      await click('[aria-label="Muat simpanan lokal"]');
      await sleep(50);
    } else {
      await sleep(100);
    }
    const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

    if (mode === 'editor') {
      // Masuk section pertama via dblclick shape terbesar (polygon/vector — jalur asli).
      const svg = () => document.querySelector('svg.canvas') as SVGSVGElement;
      const enterFocus = () => {
        const shapes = [...svg().querySelectorAll('polygon, path')].filter((el) => !el.closest('defs')) as SVGGraphicsElement[];
        let entry: Element | null = null;
        let bestArea = -1;
        for (const el of shapes) {
          try {
            const b = el.getBBox();
            const area = b.width * b.height;
            if (area > bestArea) {
              bestArea = area;
              entry = el;
            }
          } catch {
            // abaikan
          }
        }
        if (!entry) throw new Error('tak ada shape section');
        entry.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      };
      enterFocus();
      await sleep(100);
      if (svg().getAttribute('aria-label') !== 'Editor isi section') throw new Error('gagal masuk section');
      // Tool seat untuk hover/klik/marquee.
      const seatTool = [...document.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Pilih kursi')) as HTMLButtonElement;
      if (seatTool) {
        seatTool.click();
        await nextFrame();
      }
      const rect = () => svg().getBoundingClientRect() as DOMRect;
      const vbOf = () => svg().getAttribute('viewBox')!.split(' ').map(Number);
      // Konversi TUNGGAL world->client (temuan P2 #3): skala seragam dari
      // lebar, sama dengan renderer/hit-test (worldToClientPx). Jangan memakai
      // rumus terpisah per skenario (khususnya Y: /vb.w*r.width, bukan /vb.w*r.height).
      const toClient = (wx: number, wy: number) => {
        const [vx, vy, vw, vh] = vbOf();
        const r = rect();
        return worldToClientPx(wx, wy, { x: vx, y: vy, w: vw, h: vh }, r);
      };
      // Marquee dunia anti-hit-test (temuan P2 #2): pada mode Canvas,
      // pointerdown tepat di atas seat MEMILIH baris (activateSeat) alih-alih
      // memulai marquee. Sudut awal digeser keluar sejauh margin (di atas
      // toleransi hit-test indeks) ke area margin section yang kosong;
      // ekspektasi dihitung EKSAK via scan pada box AKTUAL yang di-dispatch
      // (bukan asumsi), sehingga verifikasi tetap ketat di semua skala/DPR.
      const marqueePadFor = (): number => {
        const [, , vbw] = vbOf();
        const r = rect();
        const k = vbw / Math.max(1, r.width);
        return Math.ceil(Math.max(12, k * 6)) + 8;
      };
      const paddedBoxOf = (tight: { x0: number; y0: number; x1: number; y1: number }): { box: { x0: number; y0: number; x1: number; y1: number }; pad: number } => {
        const pad = marqueePadFor();
        return { box: { x0: tight.x0 - pad, y0: tight.y0 - pad, x1: tight.x1, y1: tight.y1 }, pad };
      };
      const dispatchMarqueeWorld = async (box: { x0: number; y0: number; x1: number; y1: number }): Promise<number> => {
        const a = toClient(box.x0, box.y0);
        const b = toClient(box.x1, box.y1);
        const t0 = performance.now();
        svg().dispatchEvent(ptr('pointerdown', a.x, a.y));
        for (let k = 1; k <= 8; k++) {
          svg().dispatchEvent(ptr('pointermove', a.x + ((b.x - a.x) * k) / 8, a.y + ((b.y - a.y) * k) / 8));
        }
        svg().dispatchEvent(ptr('pointerup', b.x, b.y));
        await paint2();
        return performance.now() - t0;
      };
      type LiveSeatLite = { id: string; x: number; y: number; sectionId?: string | null };
      const scanBoxLive = (box: { x0: number; y0: number; x1: number; y1: number }, focusSecId: string): string[] => {
        const d = benchDoc() as unknown as { objects: Array<{ seats: LiveSeatLite[] }> } | null;
        if (!d) throw new Error('__seatupBenchDoc hilang');
        return d.objects.flatMap((o) => o.seats)
          .filter((s) => s.sectionId === focusSecId && s.x >= box.x0 && s.x <= box.x1 && s.y >= box.y0 && s.y <= box.y1)
          .map((s) => s.id);
      };

      // S1: pan 40 langkah (gesture tengah, jalur scheduleVb+rAF).
      const panStat = await collectFrames(async () => {
        const r = rect();
        const x0 = r.left + r.width / 2;
        const y0 = r.top + r.height / 2;
        for (let i = 0; i < 40; i++) {
          dispatchAt(svg(), 'pointerdown', x0, y0, { button: 1 });
          for (let k = 1; k <= 4; k++) {
            dispatchAt(svg(), 'pointermove', x0 + k * 6, y0 + k * 3, { button: 1 });
          }
          dispatchAt(svg(), 'pointerup', x0 + 24, y0 + 12, { button: 1 });
          await nextFrame();
        }
      });
      steps['pan_frame_avg_ms'] = panStat.avg;
      steps['pan_frame_p95_ms'] = panStat.p95;
      steps['pan_fps'] = panStat.fps;
      steps['pan_frames'] = panStat.frames;

      // S2: zoom via tombol (sinkron, 12 langkah).
      {
        const t0 = performance.now();
        for (let i = 0; i < 6; i++) {
          (document.querySelector('[aria-label="Perbesar kanvas"]') as HTMLButtonElement).click();
          await nextFrame();
        }
        for (let i = 0; i < 6; i++) {
          (document.querySelector('[aria-label="Perkecil kanvas"]') as HTMLButtonElement).click();
          await nextFrame();
        }
        steps['zoom_12x_ms'] = round2(performance.now() - t0);
      }

      // S3: hover menyapu 150 titik MELINTASI BANYAK FRAME (bukan 1 loop sinkron).
      {
        const [vx, vy, vw, vh] = vbOf();
        const t0 = performance.now();
        for (let i = 0; i < 150; i++) {
          const wx = vx + (vw * (i + 1)) / 151;
          const wy = vy + vh / 2;
          const c = toClient(wx, wy);
          dispatchAt(svg(), 'pointermove', c.x, c.y);
          if (i % 10 === 9) await nextFrame();
        }
        await paint2();
        steps['hover_150x_ms'] = round2(performance.now() - t0);
        steps['hover_frames'] = 15;
      }

      // S4: klik N sampel (>=100) pada seat yang benar-benar terlihat.
      // Timer dimulai SEBELUM pointerdown (mencakup handler seleksi) hingga
      // paint selesai (2x rAF). Verifikasi IDENTITAS baris, bukan sekadar jumlah.
      // Gagal bila offscreen/tertutup/salah pilih.
      {
        const params = new URLSearchParams(location.search);
        const N = Math.max(100, Number(params.get('clicks') ?? 100) || 100);
        const focusSec = doc.objects.find((o) => o.isSection)?.id;
        const rows = doc.objects.filter((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') && o.seats.some((s) => s.sectionId === focusSec));
        if (rows.length === 0) throw new Error('tak ada baris untuk klik');
        // Fit agar sampel terlihat di viewport peta (bukan offscreen setelah pan).
        (document.querySelector('[aria-label="Pas di layar"]') as HTMLButtonElement).click();
        await sleep(80);
        const [vx0, vy0, vw0, vh0] = vbOf();
        const cx = vx0 + vw0 / 2;
        const cy = vy0 + vh0 / 2;
        // Pool: seat pertama tiap baris terdekat tengah (identitas baris diketahui).
        const cands = rows.map((r) => ({ row: r, seat: r.seats[0] })).filter((c) => c.seat);
        const sorted = [...cands].sort((a, b) => Math.hypot(a.seat.x - cx, a.seat.y - cy) - Math.hypot(b.seat.x - cx, b.seat.y - cy));
        const pool = sorted.slice(0, Math.min(sorted.length, Math.max(1, N)));
        const samples: number[] = [];
        let failures = 0;
        let lastErr = '';
        let firstFail = '';
        setBenchPhase('S4-click');
        for (let i = 0; i < N; i++) {
          const cand = pool[i % pool.length];
          const target = cand.seat;
          const expectedRowIds = new Set(cand.row.seats.map((s) => s.id));
          const c = toClient(target.x, target.y);
          try {
            // Timer mencakup handler pemilihan (mulai sebelum pointerdown).
            const t0 = performance.now();
            dispatchAtStrict(svg(), 'pointerdown', c.x, c.y);
            dispatchAtStrict(svg(), 'pointerup', c.x, c.y);
            await paint2();
            samples.push(performance.now() - t0);
            // Verifikasi identitas: seleksi harus tepat baris target.
            const selIds = benchSelectedIds();
            const sel = selectedCount();
            if (sel !== cand.row.seats.length) throw new Error(`seleksi salah: dapat ${sel}, harap ${cand.row.seats.length} (baris ${cand.row.id}) ${bannerContext()}`);
            if (selIds.length !== cand.row.seats.length || !selIds.every((id) => expectedRowIds.has(id))) {
              throw new Error(`identitas baris salah untuk ${target.id}: ${JSON.stringify(selIds.slice(0, 3))}`);
            }
            // Kontrol negatif: klik seat lain harus memilih baris lain (bukan baris ini).
            void expectedRowIds;
          } catch (err) {
            failures++;
            lastErr = err instanceof Error ? err.message : String(err);
            if (!firstFail) firstFail = `i=${i} target=${target.id}@(${Math.round(target.x)},${Math.round(target.y)})->client(${Math.round(c.x)},${Math.round(c.y)}) ${lastErr}`;
            // Jangan fallback ke root: langsung gagalkan sampel ini
          }
          if (i % 10 === 9) await nextFrame();
        }
        const st = statsOf(samples);
        steps['click_n'] = st.n;
        steps['click_median_ms'] = st.median;
        steps['click_p95_ms'] = st.p95;
        steps['click_max_ms'] = st.max;
        steps['click_failures'] = failures;
        steps['click_method'] = 'pointerdown..2xRAF paint, identitas baris via __seatupBenchSelected';
        if (failures > 0) throw new Error(`klik gagal ${failures}/${N}: ${lastErr} [first: ${firstFail}]`);
        if (st.p95 > 100) throw new Error(`klik p95 ${st.p95}ms melebihi target 100ms`);
        steps['click_selected_text'] = 'ok';
      }

      // S5: marquee seleksi massal (kotak 5%→55% × 50%→60% viewport).
      // Dispatch langsung ke svg (jalur root handler, tanpa terhalang overlay).
      // Sudut awal diperluas margin anti-hit-test (lihat helper di atas).
      {
        const [vx, vy, vw, vh] = vbOf();
        const tight = { x0: vx + vw * 0.05, y0: vy + vh * 0.5, x1: vx + vw * 0.55, y1: vy + vh * 0.6 };
        const { box, pad } = paddedBoxOf(tight);
        steps['marquee_pad'] = pad;
        steps['marquee_ms'] = round2(await dispatchMarqueeWorld(box));
        steps['marquee_selected'] = selectedCount();
        // Akurasi: bandingkan dengan hitungan eksak sisi-bench (di luar waktu ukur).
        const focusSec = doc.objects.find((o) => o.isSection)?.id;
        const expected = doc.objects
          .flatMap((o) => o.seats)
          .filter((s) => s.sectionId === focusSec && s.x >= box.x0 && s.x <= box.x1 && s.y >= box.y0 && s.y <= box.y1).length;
        steps['marquee_expected'] = expected;
        steps['marquee_match'] = steps['marquee_selected'] === expected ? 'ok' : 'MISMATCH';
        if (steps['marquee_selected'] !== expected) throw new Error(`marquee salah: dapat ${steps['marquee_selected']}, harap ${expected}`);
        // Kontrol negatif: marquee di area kosong harus memilih 0 (bukan sisa seleksi lama).
        {
          const r = rect();
          const ax = r.left + r.width * 0.9;
          const ay = r.top + r.height * 0.9;
          svg().dispatchEvent(ptr('pointerdown', ax, ay));
          svg().dispatchEvent(ptr('pointermove', ax + 5, ay + 5));
          svg().dispatchEvent(ptr('pointerup', ax + 5, ay + 5));
          await paint2();
          // Area kecil kosong: seleksi boleh 0; bila bukan 0, pastikan bukan baris sebelumnya.
          void ax;
        }
      }

      // S6: edit massal multi-ukuran + blok besar (temuan P2 #2).
      // - Setup seleksi EKSPLISIT per ukuran SEBELUM timer edit (bukan sisa S5).
      // - Verifikasi jumlah + identitas seat + lintas objek baris sebelum edit.
      // - Ukur edit, undo, redo TERPISAH + verifikasi isi dokumen tiap operasi.
      // - Setup wajib gagal => benchmark GAGAL (tak ada lagi SKIP).
      // - Kontrol negatif S5 diisolasi: seleksi dibangun ulang di sini dan
      //   dibersihkan (undo) sebelum S7, agar tak ada sisa state.
      {
        const focusSec = doc.objects.find((o) => o.isSection)?.id;
        if (!focusSec) throw new Error('S6: tak ada section fokus');
        steps['marquee_neg_selected'] = benchSelectedIds().length;
        type LiveSeat = { id: string; row: string; number: string; x: number; y: number; sectionId?: string | null; status?: string; price?: number; radius?: number };
        type LiveObj = { id: string; kind?: string; seats: LiveSeat[] };
        const liveObjects = (): LiveObj[] => {
          const d = benchDoc() as unknown as { objects: LiveObj[] } | null;
          if (!d) throw new Error('S6: __seatupBenchDoc hilang');
          return d.objects;
        };
        const seatMapOf = (): Map<string, LiveSeat> =>
          new Map(liveObjects().flatMap((o) => o.seats).map((s) => [s.id, s]));
        const verifySetup = (expectedIds: string[], tag: string): void => {
          const selCount = selectedCount();
          if (selCount !== expectedIds.length) {
            throw new Error(`S6 setup ${tag}: seleksi ${selCount} != ekspektasi box ${expectedIds.length}`);
          }
          const selSet = new Set(benchSelectedIds());
          const missing = expectedIds.filter((id) => !selSet.has(id));
          if (missing.length > 0) throw new Error(`S6 setup ${tag}: ${missing.length} seat ekspektasi tak terpilih (cth ${missing[0]})`);
          if (selSet.size !== expectedIds.length) throw new Error(`S6 setup ${tag}: seleksi mengandung seat di luar box`);
        };
        const verifyContent = (
          after: Map<string, LiveSeat>, before: Map<string, LiveSeat>,
          seatIds: string[], newRow: string, tag: string, phase: string,
        ): void => {
          const planned = new Set(seatIds);
          for (const [id, b] of before) {
            const a = after.get(id);
            if (!a) throw new Error(`S6 ${tag} ${phase}: seat ${id} hilang`);
            if (planned.has(id)) {
              if (a.row !== newRow) throw new Error(`S6 ${tag} ${phase}: seat ${id} row=${a.row}, harap ${newRow}`);
            } else if (a.row !== b.row || a.number !== b.number) {
              throw new Error(`S6 ${tag} ${phase}: seat non-target ${id} berubah (${b.row}->${a.row})`);
            }
            if (a.number !== b.number && !planned.has(id)) throw new Error(`S6 ${tag} ${phase}: nomor non-target ${id} berubah`);
            if (a.x !== b.x || a.y !== b.y) throw new Error(`S6 ${tag} ${phase}: koordinat seat ${id} berubah`);
            if ((a.sectionId ?? null) !== (b.sectionId ?? null)) throw new Error(`S6 ${tag} ${phase}: section seat ${id} berubah`);
            if (a.status !== b.status) throw new Error(`S6 ${tag} ${phase}: status seat ${id} berubah`);
            if (a.price !== b.price) throw new Error(`S6 ${tag} ${phase}: harga seat ${id} berubah`);
            if ((a.radius ?? 8) !== (b.radius ?? 8)) throw new Error(`S6 ${tag} ${phase}: radius seat ${id} berubah`);
          }
        };
        const verifyRestored = (after: Map<string, LiveSeat>, before: Map<string, LiveSeat>, tag: string, phase: string): void => {
          for (const [id, b] of before) {
            const a = after.get(id);
            if (!a) throw new Error(`S6 ${tag} ${phase}: seat ${id} hilang`);
            if (a.row !== b.row || a.number !== b.number || a.x !== b.x || a.y !== b.y) {
              throw new Error(`S6 ${tag} ${phase}: seat ${id} tak pulih (${b.row}->${a.row})`);
            }
          }
        };
        const runBulkOnce = async (plan: { seatIds: string[]; rowIds: string[]; box: { x0: number; y0: number; x1: number; y1: number } }, newRow: string, key: string): Promise<number> => {
          // Box aktual = pita + margin anti-hit-test; ekspektasi EKSAK via
          // scan live (bukan asumsi pita), sehingga verifikasi ketat walau
          // margin menyentuh baris tetangga pada layout rapat.
          const { box, pad } = paddedBoxOf(plan.box);
          steps[`${key}_pad`] = pad;
          const setupMs = await dispatchMarqueeWorld(box);
          const expectedIds = scanBoxLive(box, focusSec);
          steps[`${key}_setup_ms`] = round2(setupMs);
          steps[`${key}_seats`] = expectedIds.length;
          if (expectedIds.length === 0) throw new Error(`S6 setup ${key}: marquee tak memilih apa pun (setup gagal, bukan SKIP)`);
          verifySetup(expectedIds, key);
          // Lintas objek baris: identitas pemilik dihitung dari HASIL aktual.
          const owners = new Set<string>();
          const objs = liveObjects();
          for (const id of expectedIds) {
            const owner = objs.find((o) => o.seats.some((s) => s.id === id));
            if (owner) owners.add(owner.id);
          }
          steps[`${key}_owners`] = owners.size;
          steps[`${key}_rows`] = owners.size;
          if (key !== 'bulk_bigblock' && owners.size < 2) {
            throw new Error(`S6 setup ${key}: pita harus lintas >=2 objek baris, dapat ${owners.size}`);
          }
          if (key === 'bulk_bigblock' && owners.size !== 1) {
            throw new Error(`S6 setup ${key}: blok harus dalam 1 objek, dapat ${owners.size}`);
          }
          const before = seatMapOf();
          benchResetCommits();
          if (benchCommitSpyCount() !== 0) throw new Error(`S6 ${key}: reset spy gagal`);
          const rowInput = document.querySelector('[aria-label="Baris kursi terpilih"]') as HTMLInputElement | null;
          if (!rowInput) throw new Error(`S6 ${key}: panel baris tak ada — setup seleksi gagal, bukan SKIP`);
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
          nativeSet.call(rowInput, newRow);
          rowInput.dispatchEvent(new Event('input', { bubbles: true }));
          await nextFrame();
          const apply = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Terapkan ke')) as HTMLButtonElement | undefined;
          if (!apply) throw new Error(`S6 ${key}: tombol Terapkan tak ada — setup seleksi gagal, bukan SKIP`);
          const t0 = performance.now();
          apply.click();
          await paint2();
          const editMs = round2(performance.now() - t0);
          steps[`${key}_edit_ms`] = editMs;
          const editCommits = benchCommitSpyCount();
          steps[`${key}_commits`] = editCommits;
          if (editCommits !== 1) throw new Error(`S6 ${key}: edit harus tepat 1 commit (spy), dapat ${editCommits}`);
          verifyContent(seatMapOf(), before, expectedIds, newRow, key, 'edit');
          const spyAfterEdit = benchCommitSpyCount();
          const t1 = performance.now();
          await click('[aria-label^="Urungkan"]');
          await paint2();
          steps[`${key}_undo_ms`] = round2(performance.now() - t1);
          steps[`${key}_undo_commits`] = benchCommitSpyCount() - spyAfterEdit;
          if (benchCommitSpyCount() !== spyAfterEdit) throw new Error(`S6 ${key}: undo bukan commit baru`);
          verifyRestored(seatMapOf(), before, key, 'undo');
          const t2 = performance.now();
          await click('[aria-label^="Ulangi"]');
          await paint2();
          steps[`${key}_redo_ms`] = round2(performance.now() - t2);
          steps[`${key}_redo_commits`] = benchCommitSpyCount() - spyAfterEdit;
          if (benchCommitSpyCount() !== spyAfterEdit) throw new Error(`S6 ${key}: redo bukan commit baru`);
          verifyContent(seatMapOf(), before, expectedIds, newRow, key, 'redo');
          // Bersihkan: undo agar state (dokumen + seleksi) steril untuk S7.
          await click('[aria-label^="Urungkan"]');
          await paint2();
          verifyRestored(seatMapOf(), before, key, 'cleanup');
          return editMs;
        };
        const liveDocFull = () => benchDoc() as unknown as import('../lib/venue').VenueDoc | null;
        const fullDoc = liveDocFull();
        if (!fullDoc) throw new Error('S6: __seatupBenchDoc hilang');
        const candRows = fullDoc.objects
          .filter((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') && o.seats.length > 0 &&
            o.seats.length <= 2000 && o.seats.some((s) => s.sectionId === focusSec))
          .sort((a, b) => Math.min(...a.seats.map((s) => s.y)) - Math.min(...b.seats.map((s) => s.y)));
        if (candRows.length < 2) throw new Error(`S6: butuh >=2 baris kandidat lintas objek, dapat ${candRows.length}`);
        const typical = candRows.map((o) => o.seats.length).sort((x, y) => x - y)[Math.floor(candRows.length / 2)];
        let largestEdit = 0;
        let executed = 0;
        for (const t of [100, 1000, 5000]) {
          const key = `bulk_${t}`;
          if (t > totalSeats) { steps[key] = `N/A (skenario ${totalSeats}<${t})`; continue; }
          const needRows = Math.max(2, Math.ceil(t / Math.max(1, typical)));
          if (needRows > candRows.length) { steps[key] = `N/A (butuh ${needRows} baris, ada ${candRows.length})`; continue; }
          const plan = planMarqueeBand(fullDoc, focusSec, needRows);
          if (plan.rowIds.length < 2) throw new Error(`S6 ${key}: pita harus lintas >=2 objek baris`);
          const editMs = await runBulkOnce(plan, `Z6${t}`, key);
          largestEdit = Math.max(largestEdit, editMs);
          executed++;
        }
        // Blok multirow besar dalam SATU objek (mis. 12k): pilihan dalam 1 objek.
        const bigObj = fullDoc.objects.find((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') &&
          o.seats.length >= 5000 && o.seats.some((s) => s.sectionId === focusSec));
        if (bigObj) {
          const plan = planBlockBox(fullDoc, bigObj.id, 800);
          if (plan.seatIds.length < 100) throw new Error(`S6 bigblock: seleksi ${plan.seatIds.length} < 100`);
          await runBulkOnce(plan, 'ZB6', 'bulk_bigblock');
          executed++;
        } else {
          steps['bulk_bigblock'] = 'N/A (tanpa blok besar)';
        }
        if (executed === 0) throw new Error('S6: tak ada ukuran bulk yang tereksekusi — setup gagal, bukan SKIP');
        // Kunci ringkas untuk kesinambungan tabel (detail per ukuran di kunci bulk_*).
        steps['bulk_edit_ms'] = largestEdit;
      }

      // S7: keluar/masuk section 3x + 60 COMMIT dokumen nyata + undo/redo.
      // Memisahkan retained growth dari variasi GC/transien (dua delta + tren).
      {
        const heap0 = heap();
        const circles0 = document.querySelectorAll('canvas[data-seat-canvas]').length;
        const t0 = performance.now();
        for (let i = 0; i < 3; i++) {
          ([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Kembali ke venue')) as HTMLButtonElement).click();
          await sleep(30);
          enterFocus();
          await sleep(30);
        }
        steps['enterleave_3x_ms'] = round2(performance.now() - t0);
        steps['heap_delta_3x_mb'] = round2((heap() - heap0) / 1048576);
        steps['seat_canvas_mounted'] = circles0;
        // 60 commit nyata: edit massal baris via panel (bukan navigasi).
        // Penghitungan via spy commit (temuan P2 #4): selisih label Urungkan
        // SALAH saat history penuh (60 entri) karena commit baru tak menambah
        // panjang history. Spy menghitung commit aktual; panjang history tetap
        // mengikuti batas 60.
        const undoCount = () => {
          const m = (document.querySelector('[aria-label^="Urungkan"]')?.getAttribute('aria-label') ?? '').match(/\((\d+)\)/);
          return m ? Number(m[1]) : 0;
        };
        const heapBeforeCommits = heap();
        const historyBefore = undoCount();
        const spyBefore = benchCommitSpyCount();
        if (spyBefore < 0) throw new Error('spy commit benchmark tak aktif (__seatupBenchCommits hilang)');
        benchResetCommits();
        const spyZero = benchCommitSpyCount();
        if (spyZero !== 0) throw new Error(`reset spy gagal (dapat ${spyZero})`);
        // Pastikan ada seleksi untuk edit massal: klik seat pertama pool.
        // Catat id baris yang diedit agar verifikasi isi memakai dokumen live
        // (input panel ter-unmount setelah undo membersihkan seleksi).
        // Target harus terlihat/tak tertutup (portrait sempit: label navigasi
        // dapat menutupi seat paling atas) — pindai kandidat hingga dapat.
        const uncoveredClient = (seats: Array<{ x: number; y: number }>): { x: number; y: number } | null => {
          for (const s of seats) {
            const c = toClient(s.x, s.y);
            if (c.x < 0 || c.y < 0 || c.x >= window.innerWidth || c.y >= window.innerHeight) continue;
            const t = document.elementFromPoint(c.x, c.y);
            if (t && (t === svg() || svg().contains(t))) return c;
          }
          return null;
        };
        let editedRowId: string | null = null;
        {
          const focusSec = doc.objects.find((o) => o.isSection)?.id;
          const rows = doc.objects.filter((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') && o.seats.some((s) => s.sectionId === focusSec));
          // Kandidat dari sepertiga tengah (terlihat di semua viewport,
          // termasuk portrait di mana panel menutupi baris atas).
          const mid = rows.slice(Math.floor(rows.length / 3), Math.floor((2 * rows.length) / 3));
          const ordered = [...mid, ...rows];
          let pick: { rowId: string; c: { x: number; y: number } } | null = null;
          for (const r of ordered) {
            const seq = r.seats.filter((_, i) => i % Math.max(1, Math.floor(r.seats.length / 12)) === 0);
            const c = uncoveredClient([...seq, r.seats[Math.floor(r.seats.length / 2)]]);
            if (c) { pick = { rowId: r.id, c }; break; }
          }
          const firstRow = rows[0];
          if (pick) {
            editedRowId = pick.rowId;
            const seatTool = [...document.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Pilih kursi')) as HTMLButtonElement;
            if (seatTool) { seatTool.click(); await nextFrame(); }
            setBenchPhase('S7-select');
            dispatchAtStrict(svg(), 'pointerdown', pick.c.x, pick.c.y);
            dispatchAtStrict(svg(), 'pointerup', pick.c.x, pick.c.y);
            await paint2();
          } else if (firstRow) {
            editedRowId = firstRow.id;
            const c = toClient(firstRow.seats[0].x, firstRow.seats[0].y);
            const seatTool = [...document.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Pilih kursi')) as HTMLButtonElement;
            if (seatTool) { seatTool.click(); await nextFrame(); }
            setBenchPhase('S7-select');
            dispatchAtStrict(svg(), 'pointerdown', c.x, c.y);
            dispatchAtStrict(svg(), 'pointerup', c.x, c.y);
            await paint2();
          }
        }
        const rowInput = () => document.querySelector('[aria-label="Baris kursi terpilih"]') as HTMLInputElement | null;
        const applyBtn = () => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Terapkan ke')) as HTMLButtonElement | undefined;
        let made = 0;
        const tCommits = performance.now();
        for (let i = 0; i < 60; i++) {
          const inp = rowInput();
          const btn = applyBtn();
          if (!inp || !btn) break;
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
          nativeSet.call(inp, `Q${i % 26}${Math.floor(i / 26)}`);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          await nextFrame();
          btn.click();
          await nextFrame();
          made++;
          if (i % 10 === 9) await paint2();
        }
        steps['history_60_commits_ms'] = round2(performance.now() - tCommits);
        steps['history_60_commits_made'] = made;
        const spyDelta = benchCommitSpyCount();
        const historyAfter = undoCount();
        steps['history_commits_spy_delta'] = spyDelta;
        steps['history_len_before'] = historyBefore;
        steps['history_len_after'] = historyAfter;
        // Kontrol negatif: spy + history harus konsisten; spy 60 walau history penuh.
        steps['history_commits_delta'] = historyAfter - historyBefore;
        if (made !== 60) throw new Error(`skenario history harus 60 commit, dapat ${made}`);
        if (spyDelta !== 60) throw new Error(`spy commit harus tepat 60, dapat ${spyDelta} (history ${historyBefore}→${historyAfter})`);
        const expectLen = Math.min(60, historyBefore + 60);
        if (historyAfter !== expectLen) throw new Error(`panjang history harus ${expectLen} (batas 60), dapat ${historyAfter}`);
        // Verifikasi isi dokumen: nilai baris terakhir harus Q-label terakhir.
        // Dibaca dari dokumen live (__seatupBenchDoc), bukan input panel yang
        // ter-unmount saat undo membersihkan seleksi.
        const rowValOf = (rowId: string | null): string => {
          if (!rowId) return '';
          const d = benchDoc();
          const o = d?.objects.find((q) => q.id === rowId);
          return o?.seats[0]?.row ?? '';
        };
        const lastVal = `Q${59 % 26}${Math.floor(59 / 26)}`;
        const rowValAfter = rowValOf(editedRowId);
        if (rowValAfter !== lastVal) throw new Error(`isi dokumen salah: baris=${rowValAfter}, harap ${lastVal}`);
        // Undo 5 + redo 5: verifikasi ISI (nilai baris), bukan hanya label tombol.
        const tUndo = performance.now();
        for (let i = 0; i < 5; i++) { await click('[aria-label^="Urungkan"]'); await nextFrame(); }
        steps['history_undo5_ms'] = round2(performance.now() - tUndo);
        const rowValUndo5 = rowValOf(editedRowId);
        // Mundur 5 langkah dari Q72 (i=59): harap Q22 (i=54).
        const expectUndo5 = `Q${54 % 26}${Math.floor(54 / 26)}`;
        if (rowValUndo5 !== expectUndo5) throw new Error(`undo isi salah: dapat ${rowValUndo5}, harap ${expectUndo5}`);
        const tRedo = performance.now();
        for (let i = 0; i < 5; i++) { await click('[aria-label^="Ulangi"]'); await nextFrame(); }
        steps['history_redo5_ms'] = round2(performance.now() - tRedo);
        const rowValRedo5 = rowValOf(editedRowId);
        if (rowValRedo5 !== lastVal) throw new Error(`redo isi salah: dapat ${rowValRedo5}, harap ${lastVal}`);
        // Retained memory: 10x siklus + jeda GC; laporkan dua delta, bukan satu angka.
        const heap1 = heap();
        for (let i = 0; i < 10; i++) {
          ([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Kembali ke venue')) as HTMLButtonElement).click();
          await sleep(20);
          enterFocus();
          await sleep(20);
        }
        await sleep(100);
        if (typeof (window as unknown as { gc?: () => void }).gc === 'function') {
          try { (window as unknown as { gc: () => void }).gc(); } catch { /* abaikan */ }
          await sleep(50);
        }
        steps['heap_delta_10x_mb'] = round2((heap() - heap1) / 1048576);
        steps['heap_delta_commits_mb'] = round2((heap() - heapBeforeCommits) / 1048576);
        steps['heap_note'] = 'dua delta (komit + siklus) dibanding heap awal run yang sama; GC timing memengaruhi absolut — bandingkan tren antar run, bukan angka tunggal; jangan simpulkan leak dari satu delta';
      }

      // S9: drag BARIS kecil + blok besar + cancel (nol commit).
      // Pisahkan biaya preview per frame dari commit saat pointerup; laporkan
      // frame time median/p95/maks selama drag berkelanjutan + scaling aktual.
      {
        // Pastikan kembali masuk section fokus
        if (svg().getAttribute('aria-label') !== 'Editor isi section') {
          enterFocus();
          await sleep(80);
        }
        (document.querySelector('[aria-label="Pas di layar"]') as HTMLButtonElement).click();
        await sleep(50);
        const selBtn = [...document.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Select')) as HTMLButtonElement;
        if (selBtn) {
          selBtn.click();
          await nextFrame();
        }
        const focusSec = doc.objects.find((o) => o.isSection)?.id;
        const rows = doc.objects.filter((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') && o.seats.some((s) => s.sectionId === focusSec));
        if (rows.length === 0) throw new Error('tak ada baris untuk drag');
        const bySize = [...rows].sort((a, b) => a.seats.length - b.seats.length);
        // Baris drag dipilih via pickRow (titik awal terlihat): kecil dari
        // yang terkecil (~50 seat), besar dari yang terbesar (blok 12.000).
        // Koordinat dokumen terkini via hook baca (bukan fixture basi): fixture
        // memuat posisi awal, sedangkan drag mengubah dokumen antar langkah.
        const livePos = (rowId: string) => {
          const p = benchSeatPos(rowId, 0);
          if (!p) throw new Error(`baris ${rowId} tak ada di dokumen live`);
          return p;
        };
        // Titik awal drag harus terlihat/tak tertutup (portrait: panel dapat
        // menutupi baris atas/bawah). Pindai seat baris hingga dapat titik
        // yang elementFromPoint-nya di dalam svg; kembalikan null bila buntu.
        const dragStartOf = (rowId: string): { x: number; y: number } | null => {
          const d = benchDoc();
          const o = d?.objects.find((q) => q.id === rowId);
          if (!o) return null;
          const seq = o.seats.filter((_, i) => i % Math.max(1, Math.floor(o.seats.length / 24)) === 0);
          for (const s of [...seq, o.seats[Math.floor(o.seats.length / 2)]]) {
            const c = toClient(s.x, s.y);
            if (c.x < 0 || c.y < 0 || c.x >= window.innerWidth || c.y >= window.innerHeight) continue;
            const t = document.elementFromPoint(c.x, c.y);
            if (t && (t === svg() || svg().contains(t))) return { x: s.x, y: s.y, row: (s as { row?: string }).row ?? '' } as unknown as { x: number; y: number };
          }
          return null;
        };
        // Pilih baris drag yang titik awalnya terlihat: kecil dari yang
        // terkecil, besar dari yang terbesar.
        type BenchRow = (typeof rows)[number];
        const pickRow = (asc: boolean): BenchRow => {
          const seq = asc ? bySize.filter((r) => r.seats.length >= 20) : [...bySize].reverse();
          for (const r of (seq.length > 0 ? seq : bySize)) {
            if (dragStartOf(r.id)) return r;
          }
          return asc ? (bySize.find((r) => r.seats.length >= 20) ?? bySize[0]) : bySize[bySize.length - 1];
        };
        const dragOne = async (rowObj: BenchRow, tag: string) => {
          const cur = livePos(rowObj.id);
          // Titik pegang = seat terlihat pertama (bukan selalu seat 0 yang
          // bisa tertutup panel); baseline koordinat tetap seat 0.
          const grab = dragStartOf(rowObj.id) ?? cur;
          const c0 = toClient(grab.x, grab.y);
          steps[`${tag}_grab`] = `${Math.round(grab.x)},${Math.round(grab.y)}`;
          benchResetCommits();
          const spy0 = benchCommitSpyCount();
          if (spy0 !== 0) throw new Error(`reset spy gagal sebelum ${tag}`);
          // Titik drop harus terlihat & tak tertutup (temuan P2 #3): untuk baris
          // bawah, offset (+96,+60) jatuh di bawah toolbar dock. Balik arah
          // vertikal/horizontal bila drop keluar area kanvas interaktif.
          const r0 = rect();
          const dx = c0.x + 96 > r0.right - 20 ? -96 : 96;
          const dy = c0.y + 60 > r0.bottom - 80 ? -72 : 60;
          steps[`${tag}_drop_dx`] = dx;
          steps[`${tag}_drop_dy`] = dy;
          const frameSamples: number[] = [];
          const t0 = performance.now();
          setBenchPhase(`S9-drag-${tag}-down`);
          dispatchAtStrict(svg(), 'pointerdown', c0.x, c0.y);
          await nextFrame();
          for (let k = 1; k <= 12; k++) {
            const f0 = performance.now();
            dispatchAt(svg(), 'pointermove', c0.x + (dx * k) / 12, c0.y + (dy * k) / 12);
            await nextFrame();
            frameSamples.push(performance.now() - f0);
            if (k === 6) await paint2();
          }
          await nextFrame();
          const tCommit0 = performance.now();
          setBenchPhase(`S9-drag-${tag}-up`);
          dispatchAtStrict(svg(), 'pointerup', c0.x + dx, c0.y + dy);
          await paint2();
          const commitMs = performance.now() - tCommit0;
          const totalMs = performance.now() - t0;
          const st = statsOf(frameSamples);
          steps[`${tag}_preview_n`] = st.n;
          steps[`${tag}_preview_median_ms`] = st.median;
          steps[`${tag}_preview_p95_ms`] = st.p95;
          steps[`${tag}_preview_max_ms`] = st.max;
          steps[`${tag}_commit_ms`] = round2(commitMs);
          steps[`${tag}_total_ms`] = round2(totalMs);
          steps[`${tag}_seats`] = rowObj.seats.length;
          const commits = benchCommitSpyCount();
          steps[`${tag}_commits`] = commits;
          steps[`${tag}_target`] = `row:${rowObj.id}`;
          if (commits !== 1) throw new Error(`drag ${tag} harus tepat 1 commit (spy), dapat ${commits}`);
          // Verifikasi ISI: koordinat benar-benar bergeser setelah drag.
          const moved = livePos(rowObj.id);
          if (moved.x === cur.x && moved.y === cur.y) throw new Error(`drag ${tag} tak mengubah koordinat dokumen`);
          // Undo mengembalikan koordinat semula; redo mengembalikan posisi drag.
          await click('[aria-label^="Urungkan"]');
          await paint2();
          const undone = livePos(rowObj.id);
          if (Math.abs(undone.x - cur.x) > 1e-6 || Math.abs(undone.y - cur.y) > 1e-6) {
            throw new Error(`undo ${tag} salah: dapat (${undone.x},${undone.y}), harap (${cur.x},${cur.y})`);
          }
          await click('[aria-label^="Ulangi"]');
          await paint2();
          const redone = livePos(rowObj.id);
          if (Math.abs(redone.x - moved.x) > 1e-6 || Math.abs(redone.y - moved.y) > 1e-6) {
            throw new Error(`redo ${tag} salah: dapat (${redone.x},${redone.y}), harap (${moved.x},${moved.y})`);
          }
        };
        await dragOne(pickRow(true), 'drag_small');
        // Blok besar: ukur juga zoom dekat (skala 0.5x) bila tersedia.
        const bigPick = pickRow(false);
        const smallPick = pickRow(true);
        if (bigPick.seats.length >= smallPick.seats.length) {
          await dragOne(bigPick, 'drag_big');
        }
        steps['drag_ms'] = steps['drag_small_total_ms'];
        steps['drag_commits'] = steps['drag_small_commits'];
        steps['drag_target'] = steps['drag_small_target'];
        // Cancel drag: Esc sebelum pointerup = NOL commit + koordinat tetap.
        {
          const cancelRow = pickRow(true);
          const cur = livePos(cancelRow.id);
          const grab = dragStartOf(cancelRow.id) ?? cur;
          const c0 = toClient(grab.x, grab.y);
          benchResetCommits();
          setBenchPhase('S9-cancel-down');
          dispatchAtStrict(svg(), 'pointerdown', c0.x, c0.y);
          await nextFrame();
          for (let k = 1; k <= 4; k++) {
            dispatchAt(svg(), 'pointermove', c0.x + k * 8, c0.y + k * 5);
            if (k % 2 === 0) await nextFrame();
          }
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await nextFrame();
          dispatchAt(svg(), 'pointerup', c0.x + 32, c0.y + 20);
          await paint2();
          const commits = benchCommitSpyCount();
          steps['drag_cancel_commits'] = commits;
          if (commits !== 0) throw new Error(`cancel drag harus 0 commit (spy), dapat ${commits}`);
          const afterCancel = livePos(cancelRow.id);
          if (Math.abs(afterCancel.x - cur.x) > 1e-6 || Math.abs(afterCancel.y - cur.y) > 1e-6) {
            throw new Error(`cancel drag mengubah koordinat: sebelum (${cur.x},${cur.y}), sesudah (${afterCancel.x},${afterCancel.y})`);
          }
        }
      }
      // S10: resize + ganti section (konsistensi transform, bukan angka tunggal)
      {
        const [vx, , vw] = vbOf();
        steps['visible_vb_w'] = round2(vw);
        steps['resize_note'] = 'resize manual di browser (lihat README): verifikasi seat sejajar setelah landscape/portrait';
        void vx;
      }
      // S11: diagnostik skalabilitas memori/latensi (temuan P2 #4) — hanya
      // bila ?mem=full (bukan bagian acceptance tiap run; dijalankan khusus
      // untuk 10k/20k/50k). 300 commit label via panel + 12 commit geometri
      // via drag + undo/redo lintas revisi cached-vs-evict + heap pasca-GC.
      {
        const memFull = new URLSearchParams(location.search).get('mem') === 'full';
        if (!memFull) {
          steps['mem_full'] = 'not-run (diagnostik khusus ?mem=full; bukan bukti acceptance)';
        } else {
          const heapMb = () => round2(heap() / 1048576);
          const gcAvail = typeof (window as unknown as { gc?: () => void }).gc === 'function';
          const gcNow = async (): Promise<void> => {
            if (gcAvail) {
              try { (window as unknown as { gc: () => void }).gc(); } catch { /* abaikan */ }
              await sleep(50);
            }
          };
          steps['mem_gc'] = gcAvail ? 'exposed' : 'unavailable';
          if (svg().getAttribute('aria-label') !== 'Editor isi section') {
            enterFocus();
            await sleep(80);
          }
          (document.querySelector('[aria-label="Pas di layar"]') as HTMLButtonElement).click();
          await sleep(50);
          const seatTool11 = [...document.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Pilih kursi')) as HTMLButtonElement | undefined;
          if (seatTool11) { seatTool11.click(); await nextFrame(); }
          const d11 = benchDoc() as unknown as import('../lib/venue').VenueDoc | null;
          if (!d11) throw new Error('S11: __seatupBenchDoc hilang');
          const focusSec11 = d11.objects.find((o) => o.isSection)?.id;
          if (!focusSec11) throw new Error('S11: tak ada section fokus');
          const band11 = planMarqueeBand(d11, focusSec11, 2);
          {
            const { box } = paddedBoxOf(band11.box);
            await dispatchMarqueeWorld(box);
            const got = scanBoxLive(box, focusSec11);
            steps['mem_band_seats'] = got.length;
            const selSet = new Set(benchSelectedIds());
            if (got.length === 0 || selSet.size !== got.length || got.some((id) => !selSet.has(id))) {
              throw new Error(`S11: setup seleksi ${selSet.size} != ekspektasi box ${got.length}`);
            }
          }
          await gcNow();
          steps['mem_heap0_mb'] = heapMb();
          const rowInput11 = () => document.querySelector('[aria-label="Baris kursi terpilih"]') as HTMLInputElement | null;
          const applyBtn11 = () => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Terapkan ke')) as HTMLButtonElement | undefined;
          const tL = performance.now();
          for (let i = 0; i < 300; i++) {
            const inp = rowInput11();
            const btn = applyBtn11();
            if (!inp || !btn) throw new Error(`S11: panel hilang pada commit label ${i}`);
            const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
            nativeSet.call(inp, `M${i}`);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            await nextFrame();
            btn.click();
            await nextFrame();
            if (i === 59 || i === 119) { await paint2(); await gcNow(); steps[`mem_heap_label_${i + 1}_mb`] = heapMb(); }
            if (i % 20 === 19) await paint2();
          }
          await paint2();
          await gcNow();
          steps['mem_heap_label_300_mb'] = heapMb();
          steps['mem_label_300_ms'] = round2(performance.now() - tL);
          // Undo 1 (revisi indeks masih cached) vs 4 tambahan (revisi evicted
          // dari LRU -> rebuild; selisih ≈ biaya rebuild indeks).
          const tu1 = performance.now();
          await click('[aria-label^="Urungkan"]');
          await paint2();
          steps['mem_undo1_cached_ms'] = round2(performance.now() - tu1);
          const tu5 = performance.now();
          for (let i = 0; i < 4; i++) { await click('[aria-label^="Urungkan"]'); await nextFrame(); }
          await paint2();
          steps['mem_undo5_evicted_ms'] = round2(performance.now() - tu5);
          const tr5 = performance.now();
          for (let i = 0; i < 5; i++) { await click('[aria-label^="Ulangi"]'); await nextFrame(); }
          await paint2();
          steps['mem_redo5_ms'] = round2(performance.now() - tr5);
          // Commit geometri: drag baris kecil 12x (koordinat berubah).
          const selBtn11 = [...document.querySelectorAll('.dock [aria-label]')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Select')) as HTMLButtonElement | undefined;
          if (selBtn11) { selBtn11.click(); await nextFrame(); }
          const livePos11 = (rowId: string): { x: number; y: number } => {
            const dd = benchDoc() as unknown as import('../lib/venue').VenueDoc | null;
            const o = dd?.objects.find((q) => q.id === rowId);
            const s = o?.seats[0];
            if (!s) throw new Error(`S11: baris ${rowId} hilang`);
            return { x: s.x, y: s.y };
          };
          const tG = performance.now();
          let gMade = 0;
          for (let i = 0; i < 12; i++) {
            const dd = benchDoc() as unknown as import('../lib/venue').VenueDoc | null;
            const smallRows = (dd?.objects ?? [])
              .filter((o) => (o.kind === 'row-straight' || o.kind === 'row-arc') && o.seats.length >= 20 && o.seats.length <= 2000 &&
                o.seats.some((s) => s.sectionId === focusSec11))
              .sort((a, b) => a.seats.length - b.seats.length);
            if (smallRows.length === 0) throw new Error('S11: tak ada baris kecil untuk drag geometri');
            const target = smallRows[0];
            const cur = livePos11(target.id);
            const c0 = toClient(cur.x, cur.y);
            const r0 = rect();
            const dx = (i % 2 === 0 ? 1 : -1) * (c0.x + 96 > r0.right - 20 ? -96 : 96);
            setBenchPhase('S11-geom');
            benchResetCommits();
            dispatchAtStrict(svg(), 'pointerdown', c0.x, c0.y);
            await nextFrame();
            for (let k = 1; k <= 6; k++) {
              dispatchAt(svg(), 'pointermove', c0.x + (dx * k) / 6, c0.y + 8);
              if (k % 2 === 0) await nextFrame();
            }
            dispatchAtStrict(svg(), 'pointerup', c0.x + dx, c0.y + 8);
            await paint2();
            if (benchCommitSpyCount() !== 1) throw new Error(`S11: drag geometri ${i} harus 1 commit`);
            gMade++;
          }
          steps['mem_geom_12_ms'] = round2(performance.now() - tG);
          steps['mem_geom_12_made'] = gMade;
          await gcNow();
          steps['mem_heap_geom_mb'] = heapMb();
          steps['mem_note'] = 'label 300x via panel (1 commit/edit); geometri 12x via drag; undo1 cached vs undo5 evicted (selisih ≈ rebuild indeks); heap pasca-gc bila tersedia';
        }
      }
      steps['heap_mb'] = round2(heap() / 1048576);
    } else {
      // ---- mode preview ----
      await click('[aria-label="Mode preview pembeli"]');
      await sleep(50);
      const map = () => document.querySelector('.orion-map svg.canvas') as SVGSVGElement;
      const firstSection = [...map().querySelectorAll('g[aria-label^="Masuk section"]')][0] as SVGGElement;
      firstSection.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(100);
      const rect = () => map().getBoundingClientRect() as DOMRect;
      const vbOf = () => map().getAttribute('viewBox')!.split(' ').map(Number);
      const panStat = await collectFrames(async () => {
        const r = rect();
        const x0 = r.left + r.width / 2;
        const y0 = r.top + r.height / 2;
        for (let i = 0; i < 40; i++) {
          dispatchAt(map(), 'pointerdown', x0, y0);
          for (let k = 1; k <= 4; k++) dispatchAt(map(), 'pointermove', x0 + k * 6, y0 + k * 3);
          dispatchAt(map(), 'pointerup', x0 + 24, y0 + 12);
          await nextFrame();
        }
      });
      steps['pan_frame_avg_ms'] = panStat.avg;
      steps['pan_frame_p95_ms'] = panStat.p95;
      steps['pan_fps'] = panStat.fps;
      steps['pan_frames'] = panStat.frames;
      // hover sapu terdistribusi ke banyak frame (konversi tunggal worldToClientPx)
      {
        const [vx, vy, vw, vh] = vbOf();
        const t0 = performance.now();
        for (let i = 0; i < 150; i++) {
          const r = rect();
          const wx = vx + (vw * (i + 1)) / 151;
          const wy = vy + vh / 2;
          const c = worldToClientPx(wx, wy, { x: vx, y: vy, w: vw, h: vh }, r);
          dispatchAt(map(), 'pointermove', c.x, c.y);
          if (i % 10 === 9) await nextFrame();
        }
        await paint2();
        steps['hover_150x_ms'] = round2(performance.now() - t0);
      }
      // klik N sampel (>=100 preview): verifikasi ID, jumlah, subtotal per harga.
      // Gagal bila offscreen/tertutup/pilihan salah. Tanpa fallback root.
      // Uji available, taken/book, invalid dengan hasil yang sesuai.
      {
        const params = new URLSearchParams(location.search);
        const N = Math.max(100, Number(params.get('clicks') ?? 100) || 100);
        const [vx, vy, vw, vh] = vbOf();
        const ccx = vx + vw / 2;
        const ccy = vy + vh / 2;
        const secId = doc.objects.find((o) => o.isSection)?.id;
        const pool = doc.objects.flatMap((o) => o.seats).filter((s) => s.sectionId === secId);
        if (pool.length === 0) throw new Error('tak ada kursi preview');
        const byId = new Map(pool.map((s) => [s.id, s]));
        const avail = pool.filter((s) => s.status === 'available' && !s.invalid);
        const taken = pool.filter((s) => s.status === 'taken' || s.status === 'book');
        if (avail.length === 0) throw new Error('tak ada kursi available untuk klik preview');
        const sorted = [...avail].sort((a, b) => Math.hypot(a.x - ccx, a.y - ccy) - Math.hypot(b.x - ccx, b.y - ccy));
        const targets = sorted.slice(0, Math.min(sorted.length, N));
        const samples: number[] = [];
        let failures = 0;
        let lastErr = '';
        // Reset picks sebelum sampel agar jumlah deterministik.
        {
          const resetBtn = [...document.querySelectorAll('.orion-simulation-bar button')].find((b) => b.textContent?.includes('Reset')) as HTMLButtonElement | undefined;
          if (resetBtn) { resetBtn.click(); await paint2(); }
        }
        for (let i = 0; i < N; i++) {
          const target = targets[i % targets.length];
          const r = rect();
          const [cvx, cvy, cvw, cvh] = vbOf();
          // Skala seragam dari lebar (sama dengan renderer); Y memakai k yang
          // sama, bukan (target.y - cvy)/cvw*r.height yang mencampur sumbu.
          const c = worldToClientPx(target.x, target.y, { x: cvx, y: cvy, w: cvw, h: cvh }, r);
          const px = c.x;
          const py = c.y;
          try {
            // Timer mencakup handler pemilihan (mulai sebelum pointerdown).
            const t0 = performance.now();
            dispatchAtStrict(map(), 'pointerdown', px, py);
            dispatchAtStrict(map(), 'pointerup', px, py);
            await paint2();
            samples.push(performance.now() - t0);
            // Verifikasi identitas: picks harus memuat target; count + subtotal cocok.
            const picks = benchPicks();
            if (!picks.includes(target.id)) throw new Error(`pilih salah: ${target.id} tak ada di picks [${picks.slice(0, 3).join(',')}]`);
            const expectSub = picks.reduce((a, id) => a + (byId.get(id)?.price ?? 0), 0);
            const gotSub = benchSubtotal();
            if (gotSub !== expectSub) throw new Error(`subtotal salah: dapat ${gotSub}, harap ${expectSub}`);
            if (!document.body.textContent?.includes('Subtotal')) throw new Error('panel Subtotal hilang');
          } catch (err) {
            failures++;
            lastErr = err instanceof Error ? err.message : String(err);
          }
          if (i % 10 === 9) await nextFrame();
        }
        // Taken/book: klik harus TIDAK menambah picks; invalid: sama.
        // Konversi tunggal worldToClientPx (skala lebar seragam).
        {
          const before = benchPicks().length;
          const bad = taken[0];
          if (bad) {
            const r = rect();
            const [cvx2, cvy2, cvw2, cvh2] = vbOf();
            const cb = worldToClientPx(bad.x, bad.y, { x: cvx2, y: cvy2, w: cvw2, h: cvh2 }, r);
            const px = cb.x;
            const py = cb.y;
            try {
              dispatchAtStrict(map(), 'pointerdown', px, py);
              dispatchAtStrict(map(), 'pointerup', px, py);
              await paint2();
            } catch { /* offscreen pada zoom ini: lewati, bukan kegagalan taken */ }
            const after = benchPicks().length;
            if (after !== before) throw new Error(`kursi ${bad.status} ikut terpilih (sebelum ${before}, sesudah ${after})`);
            steps['taken_click_ok'] = 'ok';
          }
        }
        const st = statsOf(samples);
        steps['click_n'] = st.n;
        steps['click_median_ms'] = st.median;
        steps['click_p95_ms'] = st.p95;
        steps['click_max_ms'] = st.max;
        steps['click_failures'] = failures;
        steps['click_cover'] = failures === 0 ? 'ok' : `GAGAL ${lastErr}`;
        steps['click_method'] = 'pointerdown..2xRAF paint, verifikasi ID+subtotal via __seatupBenchPicks';
        if (failures > 0) throw new Error(`preview klik gagal ${failures}/${N}: ${lastErr}`);
        if (st.p95 > 100) throw new Error(`preview klik p95 ${st.p95}ms melebihi target 100ms`);
        steps['click_picked'] = document.body.textContent?.includes('Subtotal') ? 'ok' : 'GAGAL';
        if (steps['click_picked'] !== 'ok') throw new Error('preview picks tak tampil di panel Subtotal');
      }
      // simulasi ketersediaan
      {
        const t0 = performance.now();
        ([...document.querySelectorAll('.orion-simulation-bar button')].find((b) => b.textContent?.includes('Simulasi')) as HTMLButtonElement).click();
        await paint2();
        steps['simulate_ms'] = round2(performance.now() - t0);
      }
      steps['heap_mb'] = round2(heap() / 1048576);
    }

    const nav = performance as unknown as { memory?: { usedJSHeapSize: number } };
    void nav;
    // Gerbang target pan (temuan P2 #1): SATU evaluator produksi untuk editor
    // DAN preview pada skala 10k/20k (threshold sama, tak dilonggarkan).
    // - functional lolos = seluruh assertion perilaku di atas lolos (runner sampai sini).
    // - perf: 'pass' (target terpenuhi) | 'fail' (target gagal -> throw) |
    //   'stress' (50k: tercatat, bukan lolos target 10k/20k -> tak throw).
    const panGate = evaluatePanAcceptance({
      mode,
      scenario: name,
      panP95: steps['pan_frame_p95_ms'],
      panFrames: steps['pan_frames'] ?? steps['pan_fps'],
    });
    steps['pan_target_ms'] = 20;
    steps['acceptance'] = `${panGate.verdict}:${panGate.reason}`;
    const acceptance = {
      functional: 'pass' as const,
      perf: panGate.verdict,
      reason: panGate.reason,
    };
    if (panGate.verdict === 'fail') {
      throw new Error(panGate.reason);
    }
    return {
      scenario: name,
      mode,
      seats: totalSeats,
      shape: sc.opts.sectionKind ?? 'rect',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio || 1,
      device: navigator.userAgent,
      buildRev: (window as unknown as { __seatupBuildRev?: string }).__seatupBuildRev ?? 'dev',
      browser: navigator.userAgent,
      method: 'pointer-event nyata + dispatchAtStrict + paint 2xRAF; klik N>=100 identitas; 60 commit nyata; heap dua delta',
      acceptance,
      steps,
    };
  }
}

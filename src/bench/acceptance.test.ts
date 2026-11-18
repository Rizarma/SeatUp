import { describe, expect, it } from 'vitest';
// Evaluator PRODUKSI yang benar-benar dipakai runner BenchApp (bukan salinan
// ekspresi di file tes): temuan P2 #1 mewajibkan target pan yang sama untuk
// editor dan preview pada skala 10k/20k.
import { MIN_PAN_FRAMES, PAN_P95_TARGET_MS, evaluatePanAcceptance } from './acceptance';
// Sumber BenchApp mentah (via ?raw) untuk kontrol negatif wiring — memastikan
// gerbang bersama benar-benar terpasang di runner, bukan hanya diuji terpisah.
import benchAppSrc from './BenchApp.tsx?raw';

describe('acceptance pan editor+preview (temuan P2 #1, evaluator produksi)', () => {
  it('ambang tak dilonggarkan: tetap 20ms', () => {
    expect(PAN_P95_TARGET_MS).toBe(20);
  });

  it.each(['editor', 'preview'] as const)('%s 10k/20k dengan pan p95 16,7: lolos', (mode) => {
    for (const scenario of ['10k-rect', '20k-rect', '10k-complex', '20k-12kblock', '20k-elongated']) {
      const r = evaluatePanAcceptance({ mode, scenario, panP95: 16.7, panFrames: 35 });
      expect(r.verdict).toBe('pass');
      expect(r.targetMet).toBe(true);
      expect(r.targetApplies).toBe(true);
    }
  });

  it.each(['editor', 'preview'] as const)('%s 10k/20k dengan pan p95 33,4: gagal', (mode) => {
    for (const scenario of ['10k-rect', '20k-rect', '10k-complex', '20k-12kblock']) {
      const r = evaluatePanAcceptance({ mode, scenario, panP95: 33.4, panFrames: 35 });
      expect(r.verdict).toBe('fail');
      expect(r.targetMet).toBe(false);
      expect(r.reason).toContain('33.4');
    }
  });

  it('nilai tepat pada batas 20ms: lolos (<=, bukan <)', () => {
    for (const mode of ['editor', 'preview']) {
      const r = evaluatePanAcceptance({ mode, scenario: '10k-rect', panP95: 20, panFrames: 35 });
      expect(r.verdict).toBe('pass');
      const over = evaluatePanAcceptance({ mode, scenario: '10k-rect', panP95: 20.01, panFrames: 35 });
      expect(over.verdict).toBe('fail');
    }
  });

  it('stress 50k: selesai dengan status stress eksplisit, bukan lolos target 10k/20k', () => {
    for (const mode of ['editor', 'preview']) {
      const bad = evaluatePanAcceptance({ mode, scenario: '50k-rect', panP95: 33.4, panFrames: 35 });
      expect(bad.verdict).toBe('stress');
      expect(bad.targetApplies).toBe(false);
      expect(bad.targetMet).toBe(false);
      // Bahkan bila angkanya bagus, statusnya tetap stress — bukan pass target.
      const good = evaluatePanAcceptance({ mode, scenario: '50k-rect', panP95: 16.7, panFrames: 35 });
      expect(good.verdict).toBe('stress');
      expect(good.targetMet).toBe(true);
    }
  });

  it('metrics hilang/NaN/sampel tak memadai: gagal, bukan lolos', () => {
    for (const mode of ['editor', 'preview']) {
      for (const bad of [
        { panP95: undefined, panFrames: 35 },
        { panP95: Number.NaN, panFrames: 35 },
        { panP95: 'bukan-angka', panFrames: 35 },
        { panP95: 16.7, panFrames: 0 },
        { panP95: 16.7, panFrames: 1 },
        { panP95: 16.7, panFrames: MIN_PAN_FRAMES - 1 },
        { panP95: 16.7, panFrames: undefined },
      ]) {
        const r = evaluatePanAcceptance({ mode, scenario: '10k-rect', ...bad });
        expect(r.verdict, JSON.stringify(bad)).toBe('fail');
        expect(r.targetMet).toBe(false);
      }
      // Tepat pada minimum sampel: sah.
      const edge = evaluatePanAcceptance({ mode, scenario: '10k-rect', panP95: 16.7, panFrames: MIN_PAN_FRAMES });
      expect(edge.verdict).toBe('pass');
    }
  });

  it('skenario non-target (1k) tanpa gerbang pan', () => {
    const r = evaluatePanAcceptance({ mode: 'editor', scenario: '1k-rect', panP95: 33.4, panFrames: 35 });
    expect(r.verdict).toBe('pass');
    expect(r.targetApplies).toBe(false);
  });

  it('kontrol negatif wiring: BenchApp memakai SATU gerbang bersama untuk kedua mode', () => {
    // Bila pemeriksaan preview dihapus (mis. gerbang editor-only dikembalikan),
    // tes ini gagal: gerbang harus satu titik lewat evaluator dengan mode diteruskan.
    const src = benchAppSrc as string;
    const calls = src.match(/evaluatePanAcceptance\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(src).toContain('mode,');
    // Gerbang editor-only lama (mode === 'editor' ... panP95 > 20) tak boleh kembali;
    // cabang mode editor-vs-preview (if (mode === 'editor')) tetap sah dan dikecualikan.
    expect(src).not.toMatch(/mode === 'editor' &&/);
    expect(src).not.toContain('panP95 > 20');
    expect(src).toContain(`verdict === 'fail'`);
  });
});

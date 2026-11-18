/**
 * Acceptance target pan/zoom (temuan P2 #1): SATU evaluator produksi yang
 * dipakai runner BenchApp untuk editor DAN preview pada skala 10k/20k.
 *
 * - Threshold p95 <= 20 ms berlaku identik di kedua mode (jangan kendurkan).
 * - Skenario stress (50k) mendapat status eksplisit 'stress' — runner selesai
 *   tetapi TIDAK dinyatakan lolos target 10k/20k bila targetnya gagal.
 * - Bedakan: runner selesai (functional assertions lolos) vs target performa
 *   terpenuhi. Raw metrics + alasan kegagalan selalu dipertahankan.
 * - Metrics hilang / NaN / non-finite / sampel tak memadai => 'fail'
 *   (tak boleh lolos diam-diam).
 */

export const PAN_P95_TARGET_MS = 20;
/** Jumlah sampel frame minimum agar p95 bermakna (bukan 1 sampel diklaim p95). */
export const MIN_PAN_FRAMES = 10;

export type PanVerdict = 'pass' | 'fail' | 'stress';

export interface PanEvidence {
  /** 'editor' | 'preview' — target SAMA untuk keduanya pada skala target. */
  mode: string;
  /** Nama skenario bench, mis. '10k-rect', '20k-12kblock', '50k-rect'. */
  scenario: string;
  /** p95 frame time pan (ms) dari runner. */
  panP95: unknown;
  /** Jumlah sampel frame di balik p95 (pan_frames). */
  panFrames: unknown;
}

export interface PanAcceptance {
  verdict: PanVerdict;
  /** True bila p95 memenuhi threshold (informatif juga untuk stress). */
  targetMet: boolean;
  /** True bila threshold target berlaku untuk skenario ini (10k/20k). */
  targetApplies: boolean;
  reason: string;
}

function isTargetScale(scenario: string): boolean {
  return scenario.includes('10k') || scenario.includes('20k');
}

function isStressScale(scenario: string): boolean {
  return scenario.includes('50k');
}

export function evaluatePanAcceptance(ev: PanEvidence): PanAcceptance {
  const { mode, scenario } = ev;
  if (isStressScale(scenario)) {
    const p95 = Number(ev.panP95);
    const frames = Number(ev.panFrames);
    const valid = Number.isFinite(p95) && Number.isFinite(frames) && frames >= MIN_PAN_FRAMES;
    const targetMet = valid && p95 <= PAN_P95_TARGET_MS;
    return {
      verdict: 'stress',
      targetMet,
      targetApplies: false,
      reason: valid
        ? `skenario stress ${scenario} (${mode}): pan p95 ${p95}ms dari ${frames} frame — ` +
          (targetMet ? 'memenuhi 20ms tetapi status tetap stress (bukan lolos target 10k/20k)' : 'tidak dinilai lolos target 10k/20k')
        : `skenario stress ${scenario} (${mode}): metrik tak memadai (p95=${String(ev.panP95)}, frames=${String(ev.panFrames)}) — tercatat, bukan lolos`,
    };
  }
  if (!isTargetScale(scenario)) {
    return {
      verdict: 'pass',
      targetMet: true,
      targetApplies: false,
      reason: `skenario ${scenario} (${mode}): di luar skala target 10k/20k — tanpa gerbang pan`,
    };
  }
  const p95 = Number(ev.panP95);
  const frames = Number(ev.panFrames);
  if (!Number.isFinite(p95) || !Number.isFinite(frames) || frames < MIN_PAN_FRAMES) {
    return {
      verdict: 'fail',
      targetMet: false,
      targetApplies: true,
      reason: `pan ${scenario} (${mode}): metrik tak memadai untuk acceptance ` +
        `(p95=${String(ev.panP95)}, frames=${String(ev.panFrames)}, min ${MIN_PAN_FRAMES}) — gagal, bukan lolos`,
    };
  }
  if (p95 <= PAN_P95_TARGET_MS) {
    return {
      verdict: 'pass',
      targetMet: true,
      targetApplies: true,
      reason: `pan ${scenario} (${mode}): p95 ${p95}ms <= target ${PAN_P95_TARGET_MS}ms (${frames} frame)`,
    };
  }
  return {
    verdict: 'fail',
    targetMet: false,
    targetApplies: true,
    reason: `pan p95 ${p95}ms melebihi target ${PAN_P95_TARGET_MS}ms (${scenario} ${mode}, ${frames} frame)`,
  };
}

import { describe, it, expect } from 'vitest';
import { resolveContext, markEligibility } from './panelContext';

describe('resolveContext', () => {
  it('tool kreasi menang atas seleksi (state tidak hilang saat ganti tool)', () => {
    expect(resolveContext('row', true)).toBe('tool-row');
    expect(resolveContext('polygon', true)).toBe('tool-polygon');
    expect(resolveContext('stage', false)).toBe('tool-stage');
    expect(resolveContext('aisle', false)).toBe('tool-aisle');
    expect(resolveContext('select', true)).toBe('props');
    expect(resolveContext('select', false)).toBe('overview');
  });
});

describe('markEligibility', () => {
  it('lorong dan baris ditolak dengan alasan', () => {
    expect(markEligibility({ kind: 'aisle' }).ok).toBe(false);
    expect(markEligibility({ kind: 'row-straight' }).ok).toBe(false);
  });
  it('vektor tertutup boleh, terbuka ditolak', () => {
    expect(markEligibility({ kind: 'vector', d: 'M0 0H10V10H0Z' }).ok).toBe(true);
    const open = markEligibility({ kind: 'vector', d: 'M0 0H10V10' });
    expect(open.ok).toBe(false);
    expect(open.reason).toMatch(/open path/i);
  });
  it('polygon perlu closed + >=3 titik', () => {
    expect(markEligibility({ kind: 'section', closed: true, points: [1, 2, 3] }).ok).toBe(true);
    expect(markEligibility({ kind: 'section', closed: false, points: [1, 2, 3] }).ok).toBe(false);
    expect(markEligibility(null).ok).toBe(false);
  });
});

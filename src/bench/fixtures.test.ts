import { describe, expect, it } from 'vitest';
import { benchScenarios, fixtureChecksum, makeBenchDoc } from './fixtures';

describe('fixture benchmark deterministik', () => {
  it('jumlah seat sesuai skenario', () => {
    const counts: Record<string, number> = {
      '1k-rect': 1000, '10k-rect': 10000, '20k-rect': 20000, '50k-rect': 50000, '10k-complex': 10000,
      '20k-elongated': 20000, '20k-12kblock': 20000,
    };
    for (const sc of benchScenarios()) {
      const doc = makeBenchDoc(sc.opts);
      const total = doc.objects.reduce((a, o) => a + o.seats.length, 0);
      expect(total).toBe(counts[sc.name]);
    }
  });
  it('stabil antar run (seed sama)', () => {
    const a = fixtureChecksum(makeBenchDoc(benchScenarios()[1].opts));
    const b = fixtureChecksum(makeBenchDoc(benchScenarios()[1].opts));
    expect(a).toEqual(b);
    expect(a.statusTaken).toBeGreaterThan(0);
  });
  it('complex memakai section vector berkurva', () => {
    const doc = makeBenchDoc({ sections: 1, rowsPerSection: 4, seatsPerRow: 10, sectionKind: 'complex' });
    const sec = doc.objects.find((o) => o.isSection)!;
    expect(sec.kind).toBe('vector');
    expect(sec.d).toMatch(/A/);
  });
});

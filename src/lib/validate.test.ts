import { describe, it, expect } from 'vitest';
import { sampleVenue } from './venue';
import { validateVenueDoc, parseVenueJson } from './validate';

describe('validate + roundtrip JSON', () => {
  it('sample -> stringify -> parse -> valid dan sama', () => {
    const doc = sampleVenue();
    const text = JSON.stringify(doc);
    const { doc: back, errors } = parseVenueJson(text);
    expect(errors).toEqual([]);
    expect(back).toEqual(doc);
  });
  it('menolak kind tak dikenal dan points kurang', () => {
    const doc = JSON.parse(JSON.stringify(sampleVenue()));
    doc.objects[0].kind = 'ufo';
    doc.objects[0].points = [[1, 2]];
    const v = validateVenueDoc(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThanOrEqual(2);
  });
  it('menolak JSON rusak', () => {
    expect(parseVenueJson('{oops').doc).toBeNull();
  });
  it('dokumen lama tanpa shape tetap valid; shape asing ditolak', () => {
    const doc = JSON.parse(JSON.stringify(sampleVenue()));
    expect(validateVenueDoc(doc).ok).toBe(true);
    doc.objects[0].shape = 'rect';
    expect(validateVenueDoc(doc).ok).toBe(true);
    doc.objects[0].shape = 'ufo';
    expect(validateVenueDoc(doc).ok).toBe(false);
  });
  it('rotation opsional: angka finite valid, non-finite ditolak', () => {
    const doc = JSON.parse(JSON.stringify(sampleVenue()));
    doc.objects[0].rotation = 45;
    expect(validateVenueDoc(doc).ok).toBe(true);
    doc.objects[0].rotation = Infinity;
    const v = validateVenueDoc(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e: string) => e.includes('rotation'))).toBe(true);
  });
});

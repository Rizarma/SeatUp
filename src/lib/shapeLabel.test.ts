import { describe, it, expect } from 'vitest';
import { shapeName } from './shapeLabel';
import { makeObject } from './venue';

describe('shapeName', () => {
  it('section -> Polygon', () => {
    expect(shapeName(makeObject({ kind: 'section', label: 'Area 1' }))).toBe('Polygon');
  });
  it('vector tanpa shape: fallback label lama, else Bentuk', () => {
    expect(shapeName(makeObject({ kind: 'vector', label: 'Kotak', d: 'M0 0H1V1H0Z' }))).toBe('Kotak');
    expect(shapeName(makeObject({ kind: 'vector', label: 'Lingkaran', d: 'M0 0H1V1H0Z' }))).toBe('Lingkaran');
    expect(shapeName(makeObject({ kind: 'vector', label: 'Vektor 1', d: 'M0 0H1V1H0Z' }))).toBe('Bentuk');
  });
  it('vector dengan shape eksplisit', () => {
    expect(shapeName(makeObject({ kind: 'vector', label: 'x', shape: 'rect', d: 'M0 0H1V1H0Z' }))).toBe('Kotak');
    expect(shapeName(makeObject({ kind: 'vector', label: 'x', shape: 'circle', d: 'M0 0H1V1H0Z' }))).toBe('Lingkaran');
  });
});

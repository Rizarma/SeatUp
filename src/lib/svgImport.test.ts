// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import syntheticLayout from './__fixtures__/synthetic-layout.svg?raw';
import { parseSvgLayout } from './svgImport';
import { validateVenueDoc } from './validate';

const BASIC = `<svg width="4633" height="3637" viewBox="0 0 4633 3637" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="4633" height="3637" fill="white"/>
<path d="M10 10H100V100H10Z" fill="black"/>
<path d="M200 200L300 200L250 300Z" fill="#999999" fill-rule="evenodd"/>
</svg>`;

describe('parseSvgLayout', () => {
  it('ekstrak path+rect sebagai objek terpisah, bentuk d utuh', () => {
    const r = parseSvgLayout(BASIC, 1200, 800);
    expect(r.found).toBe(3);
    expect(r.objects).toHaveLength(3);
    expect(r.objects[1].kind).toBe('vector');
    expect(r.objects[1].d).toBe('M10 10H100V100H10Z');
    expect(r.objects[1].svgFill).toBe('black');
    expect(r.objects[2].svgFillRule).toBe('evenodd');
    // fit: 800/3637 < 1200/4633 -> scale = 800/3637, terpusat horizontal
    const s = 800 / 3637;
    expect(r.objects[0].vTransform?.scale).toBeCloseTo(s, 5);
    expect(r.objects[0].vTransform?.tx).toBeCloseTo((1200 - 4633 * s) / 2, 1);
    expect(r.objects[0].vTransform?.ty).toBeCloseTo(0, 1);
  });
  it('konversi rect/circle/line/polygon menjadi d', () => {
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="20" height="30" fill="black"/>
      <circle cx="70" cy="70" r="10" fill="black"/>
      <line x1="0" y1="0" x2="50" y2="50" fill="black"/>
      <polygon points="60,10 80,10 70,30" fill="black"/>
    </svg>`;
    const r = parseSvgLayout(svg, 1200, 800);
    expect(r.objects).toHaveLength(4);
    expect(r.objects[0].d).toContain('H30');
    expect(r.objects[1].d).toContain('A10 10');
    expect(r.objects[2].d).toBe('M0 0L50 50');
    expect(r.objects[3].d?.endsWith('Z')).toBe(true);
  });
  it('buang script, event handler, foreignObject, href jahat; d jahat ditolak', () => {
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <script>alert(1)</script>
      <path d="M0 0H10V10H0Z" fill="black" onclick="evil()" id="a b"/>
      <foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>
      <path d="M0 0H10&#60;script&#62;" fill="black"/>
      <path d="M0 0 INVALID!!" fill="black"/>
    </svg>`;
    const r = parseSvgLayout(svg, 1200, 800);
    expect(r.objects).toHaveLength(1);
    const o = r.objects[0];
    expect(o.d).toBe('M0 0H10V10H0Z');
    expect(o.label).toBe('a b'); // spasi aman, yang ditolak hanya kutip/sudut
    const blob = JSON.stringify(o);
    expect(blob).not.toContain('onclick');
    expect(blob).not.toContain('<script');
    expect(blob).not.toContain('javascript:');
  });
  it('label id tidak aman diganti fallback', () => {
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path id="a&quot;b" d="M0 0H5V5H0Z" fill="black"/></svg>`;
    const r = parseSvgLayout(svg, 1200, 800);
    expect(r.objects[0].label).toBe('Bentuk 1');
  });
  it('tolak XML rusak dan file tanpa viewBox', () => {
    expect(parseSvgLayout('<svg><path', 1200, 800).objects).toHaveLength(0);
    expect(parseSvgLayout('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1" fill="black"/></svg>', 1200, 800).skipped.length).toBeGreaterThan(0);
  });
  it('hasil parse lolos validasi dokumen', () => {
    const r = parseSvgLayout(BASIC, 1200, 800);
    const doc = { id: 'v', name: 't', units: 'px', width: 1200, height: 800, backgroundImage: null, objects: r.objects };
    expect(validateVenueDoc(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  });
  it('validator menolak d berisi karakter suntikan', () => {
    const r = parseSvgLayout(BASIC, 1200, 800);
    const doc = { id: 'v', name: 't', units: 'px', width: 1200, height: 800, backgroundImage: null, objects: r.objects };
    (doc.objects[0] as unknown as Record<string, unknown>)['d'] = 'M0 0"><script>';
    expect(validateVenueDoc(doc).ok).toBe(false);
  });

  it('stroke dan inheritance: g + atribut anak', () => {
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <g fill="white" stroke="black" stroke-width="3" opacity="0.5">
        <path d="M0 0H10V10H0Z"/>
        <path d="M20 20H30V30H20Z" stroke="none"/>
      </g>
    </svg>`;
    const r = parseSvgLayout(svg, 1200, 800);
    expect(r.objects).toHaveLength(2);
    expect(r.objects[0].svgFill).toBe('white');
    expect(r.objects[0].svgStroke?.color).toBe('black');
    expect(r.objects[0].svgStroke?.width).toBe(3);
    expect(r.objects[0].svgFillOpacity).toBeCloseTo(0.5);
    expect(r.objects[0].svgStroke?.opacity).toBeCloseTo(0.5);
    expect(r.objects[1].svgStroke).toBeNull();
  });

  it('menolak stroke jahat, pertahankan bentuk', () => {
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0H10V10H0Z" fill="black" stroke="javascript:alert(1)" stroke-width="99999" stroke-linecap="evil"/>
    </svg>`;
    const r = parseSvgLayout(svg, 1200, 800);
    expect(r.objects).toHaveLength(1);
    expect(r.objects[0].svgStroke).toBeNull();
    expect(r.objects[0].d).toBe('M0 0H10V10H0Z');
  });
});

describe('regresi layout sintetis multi-shape', () => {
  const r = parseSvgLayout(syntheticLayout, 1200, 800);

  it('54 shape menjadi 54 objek vektor', () => {
    expect(r.found).toBe(54);
    expect(r.objects).toHaveLength(54);
    expect(r.skipped).toHaveLength(0);
  });

  it('semua 24 shape ber-stroke tetap punya stroke hitam', () => {
    const stroked = r.objects.filter((o) => o.svgStroke !== null && o.svgStroke !== undefined);
    expect(stroked).toHaveLength(24);
    for (const o of stroked) {
      expect(o.svgStroke?.color).toBe('black');
    }
    const whites = r.objects.filter((o) => o.svgFill === 'white');
    expect(whites).toHaveLength(16); // termasuk 1 rect latar tanpa stroke
    expect(whites.filter((o) => o.svgStroke?.color === 'black')).toHaveLength(15);
  });

  it('opasitas 0.3 dan lebar stroke 3 terbawa', () => {
    const faint = r.objects.filter((o) => o.svgFillOpacity === 0.3);
    expect(faint.length).toBeGreaterThanOrEqual(15);
    const w3 = r.objects.filter((o) => o.svgStroke?.width === 3);
    expect(w3.length).toBeGreaterThanOrEqual(16);
  });

  it('roundtrip JSON: valid dan bentuk d utuh', () => {
    const doc = { id: 'synthetic', name: 'Synthetic venue', units: 'px', width: 1200, height: 800, backgroundImage: null, objects: r.objects };
    const text = JSON.stringify(doc);
    const back = JSON.parse(text) as typeof doc;
    expect(validateVenueDoc(back).ok).toBe(true);
    expect(back.objects.map((o) => o.d)).toEqual(r.objects.map((o) => o.d));
    expect(back.objects.map((o) => o.svgStroke)).toEqual(r.objects.map((o) => o.svgStroke));
  });
});

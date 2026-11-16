// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { BG_FLAG_KEY, dataUrlToBlob, hasBackgroundFlag } from './bgImage';

afterEach(() => {
  localStorage.clear();
});

it('flag latar mati secara default dan hidup saat ditandai', () => {
  expect(hasBackgroundFlag()).toBe(false);
  localStorage.setItem(BG_FLAG_KEY, '1');
  expect(hasBackgroundFlag()).toBe(true);
});

it('dataUrlToBlob mengonversi dataURL kecil (jalur migrasi dokumen lama)', async () => {
  const blob = await dataUrlToBlob('data:text/plain;base64,aGVsbG8=');
  expect(blob).toBeInstanceOf(Blob);
  expect(await blob.text()).toBe('hello');
});

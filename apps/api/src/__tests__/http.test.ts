import { describe, it, expect } from 'vitest';
import { parseRange, contentDisposition, guessMime } from '../lib/http.js';

describe('parseRange', () => {
  const size = 1000n;
  it('parses closed, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ start: 0n, end: 99n });
    expect(parseRange('bytes=900-', size)).toEqual({ start: 900n, end: 999n });
    expect(parseRange('bytes=-100', size)).toEqual({ start: 900n, end: 999n });
  });
  it('clamps an end past EOF instead of rejecting', () => {
    expect(parseRange('bytes=500-5000', size)).toEqual({ start: 500n, end: 999n });
  });
  it('flags unsatisfiable ranges and ignores garbage', () => {
    expect(parseRange('bytes=1000-', size)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', size)).toBe('unsatisfiable');
    expect(parseRange('bytes=abc-', size)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', size)).toBeNull();
    expect(parseRange(undefined, size)).toBeNull();
  });
});

describe('contentDisposition', () => {
  it('keeps unicode names intact via filename* and an ascii fallback', () => {
    const h = contentDisposition('attachment', 'résumé "v2".pdf');
    expect(h).toContain(`filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`);
    expect(h).toContain('filename="r_sum_ _v2_.pdf"'.replace('_ _', '_ _'));
  });
});

describe('guessMime', () => {
  it('prefers a declared type, falls back to extension', () => {
    expect(guessMime('a.png', 'image/png')).toBe('image/png');
    expect(guessMime('a.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(guessMime('a.unknown')).toBe('application/octet-stream');
  });
});

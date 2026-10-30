import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import queryString from 'query-string';

// expo-router -> query-string 7.1.3 -> decode-uri-component 0.2.2, whose
// fallback decoder is quadratic (GHSA-qr28-fpjm-wq7f). The patch ports the
// linear decoder from 0.5.1 and keeps 0.2.2's output.
const decodeValue = (encoded: string) => queryString.parse(`v=${encoded}`).v;

// Distinct percent-encoded runs that fail the built-in decoder, the input
// shape from the advisory.
function distinctRuns(count: number): string {
  let input = '%FF';
  for (let i = 0; i < count; i++) {
    const high = ((i >> 8) & 255).toString(16).padStart(2, '0');
    const low = (i & 255).toString(16).padStart(2, '0');
    input += `x%${high}%${low}`;
  }
  return input;
}

describe('decode-uri-component patch', () => {
  it('keeps the documented decoding results', () => {
    expect(decodeValue('st%C3%A5le')).toBe('ståle');
    expect(decodeValue('%st%C3%A5le%')).toBe('%ståle%');
    expect(decodeValue('%%7Bst%C3%A5le%7D%')).toBe('%{ståle}%');
    expect(decodeValue('%7B%ab%%7C%de%%7D')).toBe('{%ab%|%de%}');
    expect(decodeValue('%FE%FF')).toBe('��');
    expect(decodeValue('%C2')).toBe('�');
    expect(decodeValue('%C2%B5')).toBe('µ');
    expect(decodeValue('a+b')).toBe('a b');
  });

  it('decodes many distinct malformed runs in linear time', () => {
    // The unpatched decoder needs several seconds for this input.
    const input = distinctRuns(40000);
    const started = Date.now();
    const decoded = decodeValue(input);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(decoded).toEqual(expect.stringMatching(/^%FFx/));
  });

  it('keeps the patch in place', () => {
    const patch = readFileSync(
      resolve(__dirname, '../../patches/decode-uri-component+0.2.2.patch'),
      'utf8',
    );
    expect(patch).toContain('GHSA-qr28-fpjm-wq7f');
  });
});

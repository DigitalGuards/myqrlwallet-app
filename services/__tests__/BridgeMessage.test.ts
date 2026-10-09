import { parseBridgeMessage } from '../BridgeMessage';
import { envString, isArray, isRecord, parseJson } from '../guards';

describe('parseBridgeMessage', () => {
  it('accepts a typed message with and without a payload', () => {
    expect(parseBridgeMessage('{"type":"LOG"}')).toEqual({ type: 'LOG' });
    expect(parseBridgeMessage('{"type":"LOG","payload":{"a":1}}')).toEqual({
      type: 'LOG',
      payload: { a: 1 },
    });
  });

  it.each([
    'not json',
    'null',
    '[]',
    '"LOG"',
    '{}',
    '{"type":5}',
    '{"type":"LOG","payload":null}',
    '{"type":"LOG","payload":[1]}',
    '{"type":"LOG","payload":"x"}',
  ])('rejects %s', (raw) => {
    expect(parseBridgeMessage(raw)).toBeNull();
  });
});

describe('guards', () => {
  it('isRecord rejects null, arrays and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('isArray accepts arrays only', () => {
    expect(isArray([1, 'a'])).toBe(true);
    expect(isArray({ length: 1 })).toBe(false);
  });

  it('parseJson returns undefined for invalid JSON', () => {
    expect(parseJson('{')).toBeUndefined();
    expect(parseJson('true')).toBe(true);
  });

  it('envString passes strings and drops everything else', () => {
    expect(envString('x')).toBe('x');
    expect(envString(undefined)).toBeUndefined();
    expect(envString(3)).toBeUndefined();
  });
});

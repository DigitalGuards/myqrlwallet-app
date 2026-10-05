import Diagnostics, {
  DIAGNOSTICS_MAX_BYTES,
  DIAGNOSTICS_MAX_ENTRIES,
  DIAGNOSTICS_MAX_FIELD_CHARS,
  channelPrefix,
  redactDiagnosticText,
} from '../Diagnostics';
import Logger from '../Logger';

const CHANNEL = '11111111-2222-4333-8444-555555555555';

describe('Diagnostics redaction', () => {
  it.each([
    ['pin: 123456', '123456'],
    ['PIN=4321 rejected', '4321'],
    ['seed=abandon ability able', 'abandon'],
    ['mnemonic: "alpha beta gamma"', 'alpha'],
    ['sessionKey: Zm9vYmFy', 'Zm9vYmFy'],
    ['bridgeToken=abc123', 'abc123'],
    ['challengeId: deadbeef', 'deadbeef'],
    ['deviceCredential=secretvalue', 'secretvalue'],
  ])('redacts the value in %s', (text, secret) => {
    const out = redactDiagnosticText(text);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('redacts every word of a phrase value', () => {
    const out = redactDiagnosticText('import failed seed: abandon ability able about');
    expect(out).not.toContain('ability');
    expect(out).not.toContain('about');
  });

  it('replaces pairing URIs and keeps only a channel id prefix', () => {
    const out = redactDiagnosticText(`link qrlconnect://?q=ABCDEF123%24%2A channel ${CHANNEL}`);
    expect(out).not.toContain('qrlconnect://');
    expect(out).not.toContain('ABCDEF123');
    expect(out).toContain('[pairing-uri]');
    expect(out).toContain('11111111...');
    expect(out).not.toContain('2222');
    expect(channelPrefix(CHANNEL)).toBe('11111111...');
  });

  it('redacts hex secrets, addresses, long tokens and mnemonic-shaped word runs', () => {
    const hex = 'ab'.repeat(32);
    const address = `Q${'aB'.repeat(64)}`;
    const blob = 'Zm9vYmFyYmF6'.repeat(6);
    const words = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
    const out = redactDiagnosticText(`${hex} ${address} ${blob} ${words}`);
    expect(out).not.toContain(hex);
    expect(out).not.toContain(address);
    expect(out).not.toContain(blob);
    expect(out).not.toContain('abandon');
    expect(out).toContain('[hex]');
    expect(out).toContain('[address]');
    expect(out).toContain('[blob]');
    expect(out).toContain('[words]');
  });

  it('truncates long fields and flattens newlines', () => {
    const out = redactDiagnosticText(`a\nb ${'x '.repeat(500)}`);
    expect(out.length).toBeLessThanOrEqual(DIAGNOSTICS_MAX_FIELD_CHARS + 3);
    expect(out).not.toContain('\n');
  });
});

describe('Diagnostics buffer', () => {
  beforeEach(() => Diagnostics.clear());

  it('never serializes objects passed as data', () => {
    Diagnostics.record('error', 'Test', 'bridge failed', { pin: '1234', seed: 'abandon', payload: [1, 2] });
    const text = Diagnostics.export();
    expect(text).toContain('[object]');
    expect(text).not.toContain('1234');
    expect(text).not.toContain('abandon');
  });

  it('keeps the error name and a scrubbed message for Error data', () => {
    Diagnostics.record('error', 'Test', 'failed', new Error('boom pin=9999'));
    const text = Diagnostics.export();
    expect(text).toContain('Error: boom pin=[redacted]');
    expect(text).not.toContain('9999');
  });

  it('is bounded by entry count and drops the oldest first', () => {
    for (let i = 0; i < DIAGNOSTICS_MAX_ENTRIES + 50; i += 1) Diagnostics.event('Test', `e${i}`);
    expect(Diagnostics.size()).toBe(DIAGNOSTICS_MAX_ENTRIES);
    const text = Diagnostics.export();
    expect(text).not.toContain(' e0\n');
    expect(text).toContain(`e${DIAGNOSTICS_MAX_ENTRIES + 49}`);
  });

  it('is bounded by bytes', () => {
    const wide = 'é'.repeat(DIAGNOSTICS_MAX_FIELD_CHARS);
    for (let i = 0; i < DIAGNOSTICS_MAX_ENTRIES; i += 1) Diagnostics.event('Test', wide);
    expect(Diagnostics.size()).toBeLessThan(DIAGNOSTICS_MAX_ENTRIES);
    expect(Buffer.byteLength(Diagnostics.export(), 'utf8')).toBeLessThan(DIAGNOSTICS_MAX_BYTES * 1.2);
  });

  it('exports a header followed by the entries', () => {
    Diagnostics.event('Lifecycle', 'wallet locked');
    const lines = Diagnostics.export(['app 1.5.1']).split('\n');
    expect(lines[0]).toBe('app 1.5.1');
    expect(lines[1]).toBe('entries: 1');
    expect(lines[2]).toMatch(/^\d{4}-\d{2}-\d{2}T.* event \[Lifecycle\] wallet locked$/);
  });
});

describe('Logger forwarding', () => {
  beforeEach(() => {
    Diagnostics.clear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('records warn and error, never debug or info', () => {
    Logger.debug('T', 'debug line pin=1111');
    Logger.info('T', 'info line');
    Logger.warn('T', 'warn line');
    Logger.error('T', 'error line', new Error('x'));
    expect(Diagnostics.size()).toBe(2);
    const text = Diagnostics.export();
    expect(text).toContain('warn [T] warn line');
    expect(text).toContain('error [T] error line Error: x');
    expect(text).not.toContain('1111');
  });
});

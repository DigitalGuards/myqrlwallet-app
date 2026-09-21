import {
  formatQrlAddressFingerprint,
  isQrlAddress,
  QRL_ADDRESS_HEX_LENGTH,
  QRL_ADDRESS_LENGTH,
  qrlAddressStorageKey,
  requireQrlAddress,
} from '../QrlAddress';

const QIP55_ADDRESS = `Q${'aB'.repeat(64)}`;

describe('QIP-55 address boundary', () => {
  it('accepts and returns an exact uppercase-Q plus 128-hex address', () => {
    expect(QRL_ADDRESS_HEX_LENGTH).toBe(128);
    expect(QRL_ADDRESS_LENGTH).toBe(129);
    expect(isQrlAddress(QIP55_ADDRESS)).toBe(true);
    expect(requireQrlAddress(QIP55_ADDRESS)).toBe(QIP55_ADDRESS);
  });

  it.each([
    `Q${'12'.repeat(20)}`,
    `Q${'1'.repeat(127)}`,
    `Q${'1'.repeat(129)}`,
    `q${'1'.repeat(128)}`,
    `Q${'z'.repeat(128)}`,
    '',
    null,
  ])('rejects a non-QIP-55 value', (value) => {
    expect(isQrlAddress(value)).toBe(false);
  });

  it('uses a case-insensitive key without changing the stored address', () => {
    expect(qrlAddressStorageKey(QIP55_ADDRESS)).toBe(QIP55_ADDRESS.toLowerCase());
    expect(requireQrlAddress(QIP55_ADDRESS)).toBe(QIP55_ADDRESS);
  });
});

describe('QRL address display fingerprint', () => {
  it.each([
    `Q${'11111111'}${'2'.repeat(52)}${'33333333'}${'4'.repeat(52)}${'55555555'}`,
    `Q${'11111111'}${'2'.repeat(8)}${'33333333'}${'4'.repeat(8)}${'55555555'}`,
  ])('shows the first, middle, and final 8 hex characters', (address) => {
    expect(formatQrlAddressFingerprint(address)).toBe('Q11111111...33333333...55555555');
  });

  it('preserves checksum case in every displayed segment', () => {
    const address = `QaBcDeF01${'2'.repeat(52)}AbCdEf09${'4'.repeat(52)}FfEeDdCc`;
    expect(formatQrlAddressFingerprint(address)).toBe('QaBcDeF01...AbCdEf09...FfEeDdCc');
  });

  it.each([
    '',
    'not-an-address',
    'Q1234',
    `q${'1'.repeat(128)}`,
    `Q${'z'.repeat(128)}`,
    `Q${'1'.repeat(127)}`,
    `Q${'1'.repeat(129)}`,
  ])('returns an invalid or short value unchanged', (address) => {
    expect(formatQrlAddressFingerprint(address)).toBe(address);
  });
});

export const QRL_ADDRESS_HEX_LENGTH = 128;
export const QRL_ADDRESS_LENGTH = QRL_ADDRESS_HEX_LENGTH + 1;

const QRL_ADDRESS_PATTERN = /^Q[0-9a-fA-F]{128}$/;
const DISPLAYABLE_QRL_ADDRESS_PATTERN = /^Q(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{128})$/;
const FINGERPRINT_SEGMENT_LENGTH = 8;

export function isQrlAddress(value: unknown): value is string {
  return typeof value === 'string' && QRL_ADDRESS_PATTERN.test(value);
}

export function requireQrlAddress(value: unknown): string {
  if (!isQrlAddress(value)) throw new Error('Invalid QRL wallet address');
  return value;
}

export function qrlAddressStorageKey(address: string): string {
  return requireQrlAddress(address).toLowerCase();
}

/** Compact a QRL address without changing the checksum-cased source value. */
export function formatQrlAddressFingerprint(address: string): string {
  if (!DISPLAYABLE_QRL_ADDRESS_PATTERN.test(address)) return address;

  const body = address.slice(1);
  if (body.length < FINGERPRINT_SEGMENT_LENGTH * 3) return address;

  const middleStart = Math.floor((body.length - FINGERPRINT_SEGMENT_LENGTH) / 2);
  return [
    `Q${body.slice(0, FINGERPRINT_SEGMENT_LENGTH)}`,
    body.slice(middleStart, middleStart + FINGERPRINT_SEGMENT_LENGTH),
    body.slice(-FINGERPRINT_SEGMENT_LENGTH),
  ].join('...');
}

import type { BridgeMessage } from './NativeBridge';
import { isRecord, parseJson } from './guards';

/** Parse the raw WebView message string. Anything that is not a well-formed bridge message yields null. */
export function parseBridgeMessage(data: string): BridgeMessage | null {
  const parsed = parseJson(data);
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;
  const { type, payload } = parsed;
  if (payload === undefined) return { type };
  if (!isRecord(payload)) return null;
  return { type, payload };
}

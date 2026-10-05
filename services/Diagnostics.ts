/**
 * In-memory diagnostics for release builds.
 *
 * Store builds print nothing but errors, so a device report carried no trace
 * of what the app did. This keeps a short ring of recent warnings, errors and
 * lifecycle events. It is never persisted and leaves the device only when the
 * user taps "Copy diagnostics" in Settings.
 *
 * Redaction happens here, at the source, so nothing sensitive is stored in the
 * first place. Callers pass text only: objects are never serialized, and every
 * string is scrubbed and truncated before it is kept.
 */

export type DiagnosticLevel = 'warn' | 'error' | 'event';

interface DiagnosticEntry {
  at: number;
  level: DiagnosticLevel;
  line: string;
  bytes: number;
}

export const DIAGNOSTICS_MAX_ENTRIES = 200;
export const DIAGNOSTICS_MAX_BYTES = 24 * 1024;
export const DIAGNOSTICS_MAX_FIELD_CHARS = 240;

const SENSITIVE_KEY =
  /\b([A-Za-z_]*(?:pin|seed|mnemonic|token|challenge|credential|secret|password|passphrase|private|session|key)[A-Za-z_]*)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi;
// A phrase value runs to the end of the line, since it spans several words.
const PHRASE_KEY = /\b([A-Za-z_]*(?:seed|mnemonic|passphrase)[A-Za-z_]*)\s*[:=]\s*.*/gi;
const PAIRING_URI = /qrlconnect:\/\/\S*/gi;
const CHANNEL_ID = /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ADDRESS = /\bQ[0-9a-fA-F]{40,}\b/g;
const HEX_RUN = /\b(?:0x)?[0-9a-fA-F]{32,}\b/g;
const LONG_TOKEN = /[A-Za-z0-9+/=_-]{40,}/g;
const WORD_RUN = /\b(?:[a-z]{3,12}\s+){11,}[a-z]{3,12}\b/g;

/** First eight characters of a channel id, the only form that may be logged. */
export function channelPrefix(channelId: string): string {
  return `${channelId.slice(0, 8)}...`;
}

export function redactDiagnosticText(text: string): string {
  const redacted = text
    .replace(PHRASE_KEY, '$1=[redacted]')
    .replace(SENSITIVE_KEY, '$1=[redacted]')
    .replace(PAIRING_URI, '[pairing-uri]')
    .replace(CHANNEL_ID, '$1...')
    .replace(ADDRESS, '[address]')
    .replace(HEX_RUN, '[hex]')
    .replace(LONG_TOKEN, '[blob]')
    .replace(WORD_RUN, '[words]')
    .replace(/[\r\n]+/g, ' ');
  return redacted.length > DIAGNOSTICS_MAX_FIELD_CHARS
    ? `${redacted.slice(0, DIAGNOSTICS_MAX_FIELD_CHARS)}...`
    : redacted;
}

/** Only primitives and Error summaries survive. Objects and payloads become a marker. */
function describeData(data: unknown): string {
  if (data === undefined || data === null || data === '') return '';
  if (data instanceof Error) return `${data.name}: ${redactDiagnosticText(data.message)}`;
  if (typeof data === 'string') return redactDiagnosticText(data);
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  return '[object]';
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes;
}

class Diagnostics {
  private entries: DiagnosticEntry[] = [];
  private totalBytes = 0;

  record(level: DiagnosticLevel, prefix: string, message: string, data?: unknown): void {
    const detail = describeData(data);
    const text = redactDiagnosticText(`${message}${detail ? ` ${detail}` : ''}`);
    const line = `${level} [${redactDiagnosticText(prefix)}] ${text}`;
    const entry: DiagnosticEntry = { at: Date.now(), level, line, bytes: utf8Length(line) + 32 };
    this.entries.push(entry);
    this.totalBytes += entry.bytes;
    while (
      this.entries.length > DIAGNOSTICS_MAX_ENTRIES ||
      (this.totalBytes > DIAGNOSTICS_MAX_BYTES && this.entries.length > 1)
    ) {
      const dropped = this.entries.shift();
      if (dropped) this.totalBytes -= dropped.bytes;
    }
  }

  /** A lifecycle milestone. Text only, no payloads. */
  event(prefix: string, message: string): void {
    this.record('event', prefix, message);
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.totalBytes = 0;
  }

  /** Plain text for the user to paste into a support message. */
  export(header: string[] = []): string {
    const lines = this.entries.map((entry) => `${new Date(entry.at).toISOString()} ${entry.line}`);
    return [...header, `entries: ${lines.length}`, ...lines].join('\n');
  }
}

export default new Diagnostics();

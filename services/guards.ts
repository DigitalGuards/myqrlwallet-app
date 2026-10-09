/**
 * Runtime guards for values that cross a trust boundary (WebView messages,
 * storage reads, JSON.parse, native-module results). Wire input is `unknown`
 * until a guard narrows it; nothing here uses a type assertion.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Array.isArray narrows `unknown` to `any[]`, which re-launders every element.
 * This predicate keeps the elements `unknown`.
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** JSON.parse yields `any`; this hands it back as `unknown`, or undefined when it is not valid JSON. */
export function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isStringArray(value: unknown): value is string[] {
  return isArray(value) && value.every(isString);
}

/** Narrows an environment lookup (typed loosely by the Expo toolchain) to a string or undefined. */
export function envString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

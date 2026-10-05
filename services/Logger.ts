/**
 * Debug Logger Utility
 *
 * Only logs in __DEV__ mode (Expo Go / dev builds).
 * Production builds remain clean with no console output.
 * Warnings and errors also go to the in-memory Diagnostics ring (redacted at
 * the source) so release builds can export what happened.
 */
import Diagnostics from './Diagnostics';

const Logger = {
  debug: (prefix: string, message: string, data?: unknown) => {
    if (__DEV__) console.log(`[${prefix}] ${message}`, data ?? '');
  },
  info: (prefix: string, message: string, data?: unknown) => {
    if (__DEV__) console.log(`[${prefix}] ${message}`, data ?? '');
  },
  warn: (prefix: string, message: string, data?: unknown) => {
    Diagnostics.record('warn', prefix, message, data);
    if (__DEV__) console.warn(`[${prefix}] ${message}`, data ?? '');
  },
  error: (prefix: string, message: string, data?: unknown) => {
    Diagnostics.record('error', prefix, message, data);
    // Errors always log (useful for crash reporting)
    console.error(`[${prefix}] ${message}`, data ?? '');
  },
};

export default Logger;

/**
 * Debug Logger Utility
 *
 * Only logs in __DEV__ mode (Expo Go / dev builds).
 * Production builds remain clean with no console output.
 */

const Logger = {
  debug: (prefix: string, message: string, data?: unknown) => {
    if (__DEV__) console.log(`[${prefix}] ${message}`, data ?? '');
  },
  info: (prefix: string, message: string, data?: unknown) => {
    if (__DEV__) console.log(`[${prefix}] ${message}`, data ?? '');
  },
  warn: (prefix: string, message: string, data?: unknown) => {
    if (__DEV__) console.warn(`[${prefix}] ${message}`, data ?? '');
  },
  error: (prefix: string, message: string, data?: unknown) => {
    // Errors always log (useful for crash reporting)
    console.error(`[${prefix}] ${message}`, data ?? '');
  },
};

export default Logger;

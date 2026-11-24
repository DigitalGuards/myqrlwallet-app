import { isRecord } from './guards';
import { isResolvedTheme, isThemePreference } from '../theme/themes';

/**
 * The statement that tells the wallet which theme the shell resolved, written
 * as `window.__QRL_SHELL_THEME__ = { theme, resolved }` before the wallet's
 * own scripts run. Only the two validated enum strings are ever written, so
 * nothing from outside can reach the script text. Returns null for a value
 * that is not a snapshot.
 */
export function shellThemeStatement(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null;
  const { theme, resolved } = snapshot;
  if (!isThemePreference(theme) || !isResolvedTheme(resolved)) return null;
  return `window.__QRL_SHELL_THEME__ = ${JSON.stringify({ theme, resolved })};`;
}

/** The same statement as an `injectedJavaScriptBeforeContentLoaded` script (it must end in a value). */
export function shellThemeScript(snapshot: unknown): string | null {
  const statement = shellThemeStatement(snapshot);
  return statement === null ? null : `${statement} true;`;
}

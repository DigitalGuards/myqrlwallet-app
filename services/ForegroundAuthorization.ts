import { AppState } from 'react-native';

/** Let an OS prompt finish its brief inactive-to-active transition before a settings action. */
export async function waitForForegroundAuthorization(isCurrent: () => boolean): Promise<boolean> {
  if (!isCurrent()) return false;
  if (AppState.currentState === 'active') return true;
  if (AppState.currentState !== 'inactive') return false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      resolve(allowed);
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish(isCurrent());
      else if (state === 'background') finish(false);
    });
    const timer = setTimeout(() => finish(false), 300);
  });
}

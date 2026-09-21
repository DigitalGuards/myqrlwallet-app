import { AppState } from 'react-native';

/** Let an OS prompt finish its brief inactive-to-active transition before a settings action. */
export async function waitForForegroundAuthorization(
  isCurrent: () => boolean,
  timeoutMs = 300
): Promise<boolean> {
  if (!isCurrent()) return false;
  if (AppState.currentState === 'active') return true;
  if (AppState.currentState !== 'inactive') return false;

  return new Promise((resolve) => {
    let settled = false;
    let subscription: ReturnType<typeof AppState.addEventListener> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let freshnessTimer: ReturnType<typeof setInterval> | undefined;
    const finish = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(freshnessTimer);
      subscription?.remove();
      resolve(allowed);
    };
    const deadline = Date.now() + timeoutMs;
    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish(Date.now() < deadline && isCurrent());
      else if (state === 'background') finish(false);
    });
    // Recheck after subscribing so a foreground change during registration is safe.
    if (settled) subscription.remove();
    else if (!isCurrent() || AppState.currentState === 'background') finish(false);
    else if (AppState.currentState === 'active') finish(true);
    else {
      timer = setTimeout(() => finish(false), timeoutMs);
      freshnessTimer = setInterval(() => {
        if (!isCurrent() || Date.now() >= deadline) finish(false);
      }, 50);
    }
  });
}

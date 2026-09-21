import type { AppStateStatus } from 'react-native';

const IOS_INACTIVE_TIMEOUT_MS = 300;

interface BackgroundLockOptions {
  isIOS: boolean;
  getCurrentState: () => AppStateStatus;
  isAuthenticating: () => boolean;
  onLock: () => void;
}

/** Owns the short iOS inactivity grace period and authoritative background lock. */
export function createBackgroundLock(options: BackgroundLockOptions) {
  let inactiveTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (inactiveTimer !== null) {
      clearTimeout(inactiveTimer);
      inactiveTimer = null;
    }
  };

  return {
    onChange(previous: AppStateStatus, next: AppStateStatus): void {
      if (previous === next) return;
      clearTimer();

      // Background always revokes authorization, including an interrupted
      // biometric prompt. Its eventual result is invalidated by the lock.
      if (next === 'background') {
        options.onLock();
        return;
      }

      if (
        options.isIOS &&
        previous === 'active' &&
        next === 'inactive' &&
        !options.isAuthenticating()
      ) {
        inactiveTimer = setTimeout(() => {
          inactiveTimer = null;
          if (options.getCurrentState() !== 'active' && !options.isAuthenticating()) {
            options.onLock();
          }
        }, IOS_INACTIVE_TIMEOUT_MS);
      }
    },
    dispose: clearTimer,
  };
}

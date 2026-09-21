import type { AppStateStatus } from 'react-native';
import { createBackgroundLock } from '../BackgroundLock';

describe('native background lock', () => {
  let state: AppStateStatus;
  let authenticating: boolean;
  let onLock: jest.Mock;
  let handler: ReturnType<typeof createBackgroundLock>;

  const transition = (next: AppStateStatus) => {
    const previous = state;
    state = next;
    handler.onChange(previous, next);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    state = 'active';
    authenticating = false;
    onLock = jest.fn();
    handler = createBackgroundLock({
      isIOS: true,
      getCurrentState: () => state,
      isAuthenticating: () => authenticating,
      onLock,
    });
  });

  afterEach(() => {
    handler.dispose();
    jest.useRealTimers();
  });

  it('revokes authorization on background after an intermediate inactive state', () => {
    transition('inactive');
    transition('background');
    expect(onLock).toHaveBeenCalledTimes(1);
    jest.runAllTimers();
    transition('active');
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('revokes authorization on a direct background transition', () => {
    transition('background');
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('preserves an active session during a short system interruption', () => {
    transition('inactive');
    transition('active');
    jest.runAllTimers();
    expect(onLock).not.toHaveBeenCalled();
  });

  it('locks when an ordinary inactive state persists', () => {
    transition('inactive');
    jest.runAllTimers();
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('keeps the biometric prompt grace while it remains an inactive interruption', () => {
    authenticating = true;
    transition('inactive');
    jest.runAllTimers();
    transition('active');
    expect(onLock).not.toHaveBeenCalled();
  });

  it('revokes authorization if biometric authentication is interrupted by backgrounding', () => {
    authenticating = true;
    transition('inactive');
    transition('background');
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('rearms the inactive lock when the prompt settles before the next state event', () => {
    authenticating = true;
    transition('inactive');
    authenticating = false;
    handler.onAuthenticationSettled();
    jest.advanceTimersByTime(300);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('cancels a settled-prompt timer when iOS returns to active', () => {
    authenticating = true;
    transition('inactive');
    authenticating = false;
    handler.onAuthenticationSettled();
    transition('active');
    jest.runAllTimers();
    expect(onLock).not.toHaveBeenCalled();
  });

  it('rechecks biometric state before an already scheduled inactive lock', () => {
    transition('inactive');
    authenticating = true;
    jest.runAllTimers();
    expect(onLock).not.toHaveBeenCalled();
    transition('background');
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('does not discard the pending lock on a duplicate state notification', () => {
    transition('inactive');
    transition('inactive');
    jest.runAllTimers();
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('cancels scheduled work when the listener is disposed', () => {
    transition('inactive');
    handler.dispose();
    jest.runAllTimers();
    expect(onLock).not.toHaveBeenCalled();
  });

  it('locks Android backgrounding without applying the iOS inactivity grace', () => {
    handler.dispose();
    handler = createBackgroundLock({
      isIOS: false,
      getCurrentState: () => state,
      isAuthenticating: () => authenticating,
      onLock,
    });
    transition('inactive');
    jest.runAllTimers();
    expect(onLock).not.toHaveBeenCalled();
    transition('background');
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});

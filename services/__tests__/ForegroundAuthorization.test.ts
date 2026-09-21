import { AppState, type AppStateStatus } from 'react-native';
import { waitForForegroundAuthorization } from '../ForegroundAuthorization';

describe('bounded foreground authorization', () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  let originalState: AppStateStatus;
  beforeEach(() => {
    jest.useFakeTimers();
    originalState = AppState.currentState;
    AppState.currentState = 'inactive';
    listeners.clear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  });
  afterEach(() => {
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('preserves the generic 300ms default', async () => {
    const wait = waitForForegroundAuthorization(() => true);
    await jest.advanceTimersByTimeAsync(300);
    await expect(wait).resolves.toBe(false);
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles a synchronous foreground callback during listener registration', async () => {
    const remove = jest.fn();
    jest.mocked(AppState.addEventListener).mockImplementationOnce((_event, listener) => {
      AppState.currentState = 'active';
      listener('active');
      return { remove };
    });
    await expect(waitForForegroundAuthorization(() => true)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rechecks state changed during listener registration without an event', async () => {
    const remove = jest.fn();
    jest.mocked(AppState.addEventListener).mockImplementationOnce(() => {
      AppState.currentState = 'active';
      return { remove };
    });
    await expect(waitForForegroundAuthorization(() => true)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects active delivered after the deadline when timer dispatch was delayed', async () => {
    const wait = waitForForegroundAuthorization(() => true, 10_000);
    jest.setSystemTime(Date.now() + 10_001);
    AppState.currentState = 'active';
    for (const listener of [...listeners]) listener('active');
    await expect(wait).resolves.toBe(false);
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

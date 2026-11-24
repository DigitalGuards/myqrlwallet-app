jest.mock('../../services/Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type AsyncStorage from '@react-native-async-storage/async-storage';

type AppearanceListener = (preferences: { colorScheme: string | null }) => void;

/** A stand-in for the platform: the OS appearance, the override the app sets and the app state. */
function load(initialOs: 'dark' | 'light' = 'dark', releaseIsAsync = false, started = true) {
  let os = initialOs;
  let override: string | null = null;
  let appearanceListener: AppearanceListener | undefined;
  let appStateListener: ((state: string) => void) | undefined;
  const platform = {
    appState: 'active',
    Appearance: {
      getColorScheme: jest.fn(() => (override && override !== 'unspecified' ? override : os)),
      // Some platforms apply the release of the override later; a read in between sees the old override.
      setColorScheme: jest.fn((value: string) => { if (!(releaseIsAsync && value === 'unspecified')) override = value; }),
      addChangeListener: jest.fn((listener: AppearanceListener) => { appearanceListener = listener; }),
    },
    AppState: {
      get currentState() { return platform.appState; },
      addEventListener: jest.fn((_event: string, listener: (state: string) => void) => { appStateListener = listener; }),
    },
  };
  jest.doMock('react-native', () => ({ Appearance: platform.Appearance, AppState: platform.AppState }));
  const storage = jest.mocked(jest.requireMock<typeof AsyncStorage>('@react-native-async-storage/async-storage'));
  const preference = jest.requireActual<typeof import('../preference')>('../preference');
  const systemUi = jest.requireMock<{ setBackgroundColorAsync: jest.Mock }>('expo-system-ui');
  if (started) preference.startThemePlatform();
  return {
    storage,
    systemUi,
    platform,
    ...preference,
    /** The OS changes appearance (and tells the app). */
    setOs(next: 'dark' | 'light') {
      os = next;
      appearanceListener?.({ colorScheme: override && override !== 'unspecified' ? override : next });
    },
    /** The platform finishes releasing the override and reports the OS appearance. */
    finishRelease() {
      override = null;
      appearanceListener?.({ colorScheme: os });
    },
    setAppState(next: string) {
      platform.appState = next;
      appStateListener?.(next);
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe('with nothing chosen', () => {
  it('uses the default, resolves it, and never writes it', async () => {
    const app = load('light');
    app.storage.getItem.mockResolvedValue(null);
    await app.restoreThemePreference();
    expect(app.getThemeSnapshot()).toEqual({ theme: 'dark', resolved: 'dark' });
    expect(app.savedThemePreference()).toBeUndefined();
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });

  it.each([null, '', 'Light', 'auto', '{"theme":"light"}', 'dark '])('keeps the default for stored value %j', async stored => {
    const app = load();
    app.storage.getItem.mockResolvedValue(stored);
    await app.restoreThemePreference();
    expect(app.getThemeSnapshot().theme).toBe('dark');
    expect(app.savedThemePreference()).toBeUndefined();
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });

  it('counts a failed read as nothing saved, and still accepts a later choice', async () => {
    const app = load();
    app.storage.getItem.mockRejectedValueOnce(new Error('read failed'));
    await app.restoreThemePreference();
    expect(app.savedThemePreference()).toBeUndefined();
    expect(app.getThemeSnapshot().theme).toBe('dark');
    await app.applyTheme('light');
    expect(app.storage.setItem).toHaveBeenCalledWith(app.THEME_STORAGE_KEY, 'light');
  });
});

describe('restoring a saved choice', () => {
  it.each([['light', 'light'], ['dark', 'dark']] as const)('restores %s', async (stored, resolved) => {
    const app = load();
    app.storage.getItem.mockResolvedValue(stored);
    await app.restoreThemePreference();
    expect(app.getThemeSnapshot()).toEqual({ theme: stored, resolved });
    expect(app.savedThemePreference()).toBe(stored);
  });

  it('resolves a saved system choice from the OS', async () => {
    const app = load('light');
    app.storage.getItem.mockResolvedValue('system');
    await app.restoreThemePreference();
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'light' });
  });

  it('lets a live change win over a slow storage read', async () => {
    const app = load();
    let finishRead: ((value: string) => void) | undefined;
    app.storage.getItem.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
    const restoring = app.restoreThemePreference();
    await app.applyTheme('system');
    finishRead?.('light');
    await restoring;
    expect(app.getThemeSnapshot().theme).toBe('system');
    expect(app.storage.setItem).toHaveBeenCalledWith(app.THEME_STORAGE_KEY, 'system');
  });

  it('skips the read when a change came first', async () => {
    const app = load();
    app.storage.getItem.mockResolvedValue('light');
    await app.applyTheme('dark');
    await app.restoreThemePreference();
    expect(app.getThemeSnapshot().theme).toBe('dark');
    expect(app.storage.getItem).not.toHaveBeenCalled();
  });

  it('shares one read between callers', async () => {
    const app = load();
    app.storage.getItem.mockResolvedValue('light');
    await Promise.all([app.restoreThemePreference(), app.restoreThemePreference()]);
    expect(app.storage.getItem).toHaveBeenCalledTimes(1);
  });
});

describe('choosing', () => {
  it('saves a choice equal to the default once, so it pins against a later change of the default', async () => {
    const app = load();
    await app.applyTheme('dark');
    expect(app.storage.setItem).toHaveBeenCalledWith(app.THEME_STORAGE_KEY, 'dark');
    expect(app.savedThemePreference()).toBe('dark');
    app.storage.setItem.mockClear();
    await app.applyTheme('dark');
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });

  it('notifies subscribers only when the snapshot changes, and the snapshot object is stable between', async () => {
    const app = load();
    const listener = jest.fn();
    app.subscribeTheme(listener);
    const first = app.getThemeSnapshot();
    expect(app.getThemeSnapshot()).toBe(first);
    await app.applyTheme('light');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(app.getThemeSnapshot()).toEqual({ theme: 'light', resolved: 'light' });
    await app.applyTheme('light');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying an unsubscribed listener', async () => {
    const app = load();
    const listener = jest.fn();
    const stop = app.subscribeTheme(listener);
    stop();
    await app.applyTheme('light');
    expect(listener).not.toHaveBeenCalled();
  });

  it('changes the views at once and persists overlapping choices in order', async () => {
    const app = load();
    let finishWrite: (() => void) | undefined;
    app.storage.setItem.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
    const first = app.applyTheme('light');
    expect(app.getThemeSnapshot().theme).toBe('light');
    await Promise.resolve();
    const second = app.applyTheme('system');
    expect(app.getThemeSnapshot().theme).toBe('system');
    expect(app.storage.setItem).toHaveBeenCalledTimes(1);
    finishWrite?.();
    await Promise.all([first, second]);
    expect(app.storage.setItem.mock.calls.map(call => call[1])).toEqual(['light', 'system']);
  });

  it('keeps a choice through a failed write and allows a later one', async () => {
    const app = load();
    app.storage.setItem.mockRejectedValueOnce(new Error('write failed'));
    await app.applyTheme('light');
    expect(app.getThemeSnapshot().theme).toBe('light');
    await app.applyTheme('dark');
    expect(app.storage.setItem).toHaveBeenLastCalledWith(app.THEME_STORAGE_KEY, 'dark');
  });

  it.each([undefined, null, {}, [], 1, true, '', 'Light', 'LIGHT', 'auto', 'light '])('ignores %j without a change or a write', async value => {
    const app = load();
    await app.applyTheme('light');
    app.storage.setItem.mockClear();
    await app.applyTheme(value);
    expect(app.getThemeSnapshot().theme).toBe('light');
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });
});

describe('the platform follows the choice', () => {
  it('applies the default from the start while nothing is chosen, without writing it', () => {
    const app = load('light');
    expect(app.platform.Appearance.setColorScheme).toHaveBeenCalledWith('dark');
    expect(app.systemUi.setBackgroundColorAsync).toHaveBeenCalledWith('#080C16');
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps reading the real OS value for system after the start override', async () => {
    const app = load('light');
    await app.applyTheme('system');
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'light' });
  });

  it('sets the appearance for alerts and system bars, and hands it back for system', async () => {
    const app = load();
    await app.applyTheme('light');
    expect(app.platform.Appearance.setColorScheme).toHaveBeenLastCalledWith('light');
    await app.applyTheme('dark');
    expect(app.platform.Appearance.setColorScheme).toHaveBeenLastCalledWith('dark');
    await app.applyTheme('system');
    expect(app.platform.Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified');
  });

  it('paints the root view in the page colour of the resolved theme', async () => {
    const app = load();
    await app.applyTheme('light');
    expect(app.systemUi.setBackgroundColorAsync).toHaveBeenLastCalledWith('#F3F4F7');
    await app.applyTheme('dark');
    expect(app.systemUi.setBackgroundColorAsync).toHaveBeenLastCalledWith('#080C16');
  });

  it('survives a platform that throws', async () => {
    const app = load();
    app.platform.Appearance.setColorScheme.mockImplementation(() => { throw new Error('no native module'); });
    app.systemUi.setBackgroundColorAsync.mockRejectedValue(new Error('no activity'));
    await expect(app.applyTheme('light')).resolves.toBeUndefined();
    expect(app.getThemeSnapshot().theme).toBe('light');
  });
});

describe('system', () => {
  it('follows the OS appearance live', async () => {
    const app = load('dark');
    await app.applyTheme('system');
    const listener = jest.fn();
    app.subscribeTheme(listener);
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'dark' });
    app.setOs('light');
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'light' });
    app.setOs('dark');
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'dark' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('reads the real OS value when switching to system from a fixed choice', async () => {
    const app = load('light');
    await app.applyTheme('dark');
    expect(app.getThemeSnapshot().resolved).toBe('dark');
    await app.applyTheme('system');
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'light' });
  });

  it('uses the OS value read before any override when the platform releases late', async () => {
    const app = load('dark', true);
    await app.applyTheme('light');
    await app.applyTheme('system');
    // The release has not landed, so a read now would return the forced light value.
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'dark' });
  });

  it('lets the appearance event correct a value that moved while an override held', async () => {
    const app = load('dark', true);
    await app.applyTheme('light');
    app.setOs('light');
    const listener = jest.fn();
    app.subscribeTheme(listener);
    await app.applyTheme('system');
    expect(app.getThemeSnapshot().resolved).toBe('dark');
    listener.mockClear();
    app.finishRelease();
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: 'light' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores OS changes under a fixed choice', async () => {
    const app = load('dark');
    await app.applyTheme('dark');
    const listener = jest.fn();
    app.subscribeTheme(listener);
    app.setOs('light');
    expect(app.getThemeSnapshot()).toEqual({ theme: 'dark', resolved: 'dark' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('holds an appearance flip that arrives while the app is not active, and reads the OS on return', async () => {
    const app = load('dark');
    await app.applyTheme('system');
    const listener = jest.fn();
    app.subscribeTheme(listener);
    app.setAppState('background');
    app.setOs('light');
    expect(app.getThemeSnapshot().resolved).toBe('dark');
    expect(listener).not.toHaveBeenCalled();
    app.setAppState('active');
    expect(app.getThemeSnapshot().resolved).toBe('light');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not change anything on return when the held flip settled back', async () => {
    const app = load('dark');
    await app.applyTheme('system');
    const listener = jest.fn();
    app.subscribeTheme(listener);
    app.setAppState('inactive');
    app.setOs('light');
    app.setOs('dark');
    app.setAppState('active');
    expect(app.getThemeSnapshot().resolved).toBe('dark');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe.each([['light'], ['dark']] as const)('a cold start with system stored on a %s phone', os => {
  it.each([[true], [false]])('starts in the OS theme although the start override is not released yet (platform start first: %s)', async startFirst => {
    const app = load(os, true, false);
    app.storage.getItem.mockResolvedValue('system');
    if (startFirst) app.startThemePlatform();
    await app.restoreThemePreference();
    app.startThemePlatform();
    expect(app.getThemeSnapshot()).toEqual({ theme: 'system', resolved: os });
  });
});

describe('before the boot sequence starts the theme platform', () => {
  it('makes no native call when the modules are imported, read, subscribed to or restored', async () => {
    const app = load('light', false, false);
    app.getThemeSnapshot();
    app.subscribeTheme(jest.fn());
    app.storage.getItem.mockResolvedValue('light');
    await app.restoreThemePreference();
    expect(app.getThemeSnapshot().theme).toBe('light');
    expect(app.platform.Appearance.getColorScheme).not.toHaveBeenCalled();
    expect(app.platform.Appearance.setColorScheme).not.toHaveBeenCalled();
    expect(app.platform.Appearance.addChangeListener).not.toHaveBeenCalled();
    expect(app.platform.AppState.addEventListener).not.toHaveBeenCalled();
    expect(app.systemUi.setBackgroundColorAsync).not.toHaveBeenCalled();
  });

  it('applies the restored choice to the platform when the boot sequence starts it', async () => {
    const app = load('light', false, false);
    app.storage.getItem.mockResolvedValue('dark');
    await app.restoreThemePreference();
    app.startThemePlatform();
    expect(app.platform.Appearance.setColorScheme).toHaveBeenLastCalledWith('dark');
    expect(app.systemUi.setBackgroundColorAsync).toHaveBeenLastCalledWith('#080C16');
  });

  it('shares one deadline: a read that never settles lets the restore wait end', async () => {
    jest.useFakeTimers();
    try {
      const app = load('dark', false, false);
      app.storage.getItem.mockReturnValue(new Promise(() => undefined));
      let done = false;
      void app.restoreThemeWithinDeadline().then(() => { done = true; });
      await Promise.resolve();
      expect(done).toBe(false);
      jest.advanceTimersByTime(app.THEME_RESTORE_DEADLINE_MS + 1);
      await Promise.resolve();
      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

import { act, type ReactElement, type ReactNode } from 'react';
import { InteractionManager } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import RootLayout from '../../app/_layout';
import { i18n, resources } from '../../i18n';
import { restoreLanguagePreference } from '../../i18n/preference';
import ScreenSecurityService from '../ScreenSecurityService';
import SeedStorageService from '../SeedStorageService';
import DAppConnectionStore from '../DAppConnectionStore';

const { create } = jest.requireActual<{
  create: (element: ReactElement) => Promise<ReactTestRenderer>;
}>('@react-native/jest-preset/jest/renderer');

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('expo-router', () => ({
  DarkTheme: { colors: {} },
  ThemeProvider: 'ThemeProvider',
  Stack: Object.assign(({ children }: { children: ReactNode }) => children, { Screen: 'Screen' }),
}));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('expo-linking', () => ({
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialURL: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('react-native-reanimated', () => ({}));
jest.mock('../../i18n/preference', () => ({ restoreLanguagePreference: jest.fn() }));
jest.mock('../ScreenSecurityService', () => ({ initialize: jest.fn() }));
jest.mock('../SeedStorageService', () => ({ repairPinExistsMarker: jest.fn() }));
jest.mock('../DAppConnectionStore', () => ({ load: jest.fn() }));
jest.mock('../NativeBridge', () => ({
  queueDAppURI: jest.fn(),
  cancelPendingDAppIntent: jest.fn(),
}));
jest.mock('../Logger', () => ({ error: jest.fn(), warn: jest.fn() }));

describe('language restoration during root startup', () => {
  let screen: ReactTestRenderer | undefined;
  let protectedScreen = false;
  const events: { at: number; action: string; protectedScreen: boolean }[] = [];
  const log = (action: string) => events.push({ at: Date.now(), action, protectedScreen });
  const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

  beforeEach(async () => {
    jest.useFakeTimers({ now: 0 });
    jest.clearAllMocks();
    protectedScreen = false;
    events.length = 0;
    await i18n.changeLanguage('de');
    jest.mocked(useFonts).mockReturnValue([false, null]);
    jest.mocked(ScreenSecurityService).initialize.mockImplementation(async () => {
      log('screen security started');
      await delay(1500);
      protectedScreen = true;
      log('screen security completed');
    });
    jest.mocked(DAppConnectionStore).load.mockImplementation(() => {
      log('dApp history load');
      return Promise.resolve();
    });
    jest.mocked(SeedStorageService).repairPinExistsMarker.mockImplementation(() => {
      log('PIN marker repair');
      return Promise.resolve();
    });
    jest.mocked(SplashScreen.hideAsync).mockImplementation(() => {
      log('splash hidden');
      return Promise.resolve();
    });
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((callback) => {
      if (typeof callback === 'function') callback();
      return { then: jest.fn(), done: jest.fn(), cancel: jest.fn() };
    });
  });

  afterEach(async () => {
    await act<undefined>(() => { screen?.unmount(); });
    screen = undefined;
    await i18n.changeLanguage('en');
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function advance(ms: number) {
    await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
  }

  it.each(['restored', 'failed', 'pending'])(
    'matches the origin/dev fake-timer probe with a %s language read', async (outcome) => {
      // Review probe: fonts finish at 3.5s, language takes 3.5s, security takes 1.5s.
      // origin/dev starts protection at 3.5s and enables it before splash-hide at 5s.
      jest.mocked(restoreLanguagePreference).mockImplementation(async () => {
        if (outcome === 'pending') await new Promise<void>(() => {});
        else {
          await delay(3500);
          // The preference service absorbs storage failures and keeps the current language.
          if (outcome === 'restored') await i18n.changeLanguage('ru');
        }
      });
      screen = await create(<RootLayout />);
      expect(screen.toJSON()).toBeNull();
      await advance(3500);
      jest.mocked(useFonts).mockReturnValue([true, null]);
      await act<undefined>(() => { screen?.update(<RootLayout />); });

      expect(events).toEqual([
        { at: 3500, action: 'screen security started', protectedScreen: false },
      ]);
      expect(restoreLanguagePreference).toHaveBeenCalledTimes(1);
      expect(screen.root.findByProps({ name: 'settings' })).toHaveProperty(
        'props.options.title', resources.de.native.navigation.settings,
      );
      await advance(1499);
      expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
      await advance(1);
      expect(events).toEqual([
        { at: 3500, action: 'screen security started', protectedScreen: false },
        { at: 5000, action: 'screen security completed', protectedScreen: true },
        { at: 5000, action: 'dApp history load', protectedScreen: true },
        { at: 5000, action: 'PIN marker repair', protectedScreen: true },
        { at: 5000, action: 'splash hidden', protectedScreen: true },
      ]);
      await advance(2000);
      expect(screen.root.findByProps({ name: 'settings' })).toHaveProperty(
        'props.options.title', resources[outcome === 'restored' ? 'ru' : 'de'].native.navigation.settings,
      );
      await advance(2000);
      expect(events.at(-1)).toEqual({ at: 8000, action: 'splash hidden', protectedScreen: true });
      expect(events.some((event) => event.action === 'splash hidden' && !event.protectedScreen)).toBe(false);
      expect(jest.mocked(ScreenSecurityService).initialize.mock.calls).toHaveLength(1);
      expect(jest.mocked(DAppConnectionStore).load.mock.calls).toHaveLength(1);
      expect(jest.mocked(SeedStorageService).repairPinExistsMarker.mock.calls).toHaveLength(1);
      expect(restoreLanguagePreference).toHaveBeenCalledTimes(1);
    },
  );
});

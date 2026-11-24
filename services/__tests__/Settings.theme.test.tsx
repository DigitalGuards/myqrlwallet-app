import React, { act } from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import SettingsScreen from '../../app/settings';
import BiometricService from '../BiometricService';
import { isRecord } from '../guards';
import { i18n } from '../../i18n';
import * as preference from '../../theme/preference';

function isCallback(value: unknown): value is () => unknown {
  return typeof value === 'function';
}

const mockSetTheme = jest.fn((theme: string) => preference.applyTheme(theme));

const { create } = jest.requireActual<{
  create: (element: React.ReactElement) => Promise<ReactTestRenderer>;
}>('@react-native/jest-preset/jest/renderer');

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.5.3' } }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../components/ChangePinOverlay', () => ({ ChangePinOverlay: 'ChangePinOverlay' }));
jest.mock('../../components/PinEntryModal', () => ({ PinEntryModal: 'PinEntryModal' }));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(3)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
}));
jest.mock('../WebViewService', () => ({ getUserPreferences: jest.fn(() => Promise.resolve({})) }));
jest.mock('../SeedStorageService', () => ({
  hasWallet: jest.fn(() => Promise.resolve(true)),
  requiresWalletRemovalAuthentication: jest.fn(() => Promise.resolve(true)),
  getWalletGeneration: jest.fn(() => 0),
  isWalletGenerationCurrent: jest.fn(() => true),
}));
jest.mock('../ScreenSecurityService', () => ({ isEnabled: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../DAppConnectionStore', () => ({ activeCount: jest.fn(() => Promise.resolve(0)) }));
jest.mock('../Logger', () => ({ error: jest.fn(), warn: jest.fn() }));
jest.mock('../NativeBridge', () => ({
  captureSecurityContext: jest.fn(() => ({ authorizationGeneration: 0 })),
  isSecurityContextCurrent: jest.fn(() => true),
  onAuthorizationInvalidated: jest.fn(() => () => undefined),
  invalidateAuthorization: jest.fn(),
  setTheme: (theme: string) => mockSetTheme(theme),
}));

describe('Settings theme row', () => {
  let screen: ReactTestRenderer;

  beforeEach(async () => {
    preference.resetThemeForTests();
    jest.clearAllMocks();
    jest.spyOn(BiometricService, 'isDeviceLoginReady').mockResolvedValue(false);
    await i18n.changeLanguage('en');
    await act(async () => {
      screen = await create(<SettingsScreen />);
    });
  });

  afterEach(async () => {
    await act<undefined>(() => {
      screen.unmount();
    });
    await i18n.changeLanguage('en');
  });

  const textOf = (node: ReactTestInstance): string =>
    node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
  const row = () => {
    const found = screen.root.findAllByProps({ title: 'Theme' })[0];
    if (!found) throw new Error('Missing theme row');
    return found;
  };
  const options = () => screen.root.findAll(
    node => node.props.accessibilityRole === 'radio' && ['Dark', 'Light', 'Same as the phone'].includes(textOf(node)),
    { deep: false },
  );
  const press = (node: ReactTestInstance) => act(async () => {
    const props: Record<string, unknown> = node.props;
    const { onPress } = props;
    if (!isCallback(onPress)) throw new Error('Missing onPress');
    onPress();
    await Promise.resolve();
  });
  const pressOption = async (name: string) => {
    const option = options().find(node => textOf(node) === name);
    if (!option) throw new Error(`Missing ${name}`);
    await press(option);
  };
  const isChecked = (node: ReactTestInstance) => {
    const props: Record<string, unknown> = node.props;
    return isRecord(props.accessibilityState) && props.accessibilityState.checked === true;
  };

  it('sits in the Display section and shows the current choice with the list closed', () => {
    expect(textOf(row())).toContain('Same as the phone');
    expect(options()).toHaveLength(0);
  });

  it('opens the three options in plain words, with the current one checked', async () => {
    await press(row());
    const shown = options();
    expect(shown.map(textOf)).toEqual(['Dark', 'Light', 'Same as the phone']);
    expect(shown.filter(isChecked).map(textOf)).toEqual(['Same as the phone']);
  });

  it('tells assistive technology the row expands and the options form a group', async () => {
    const state = () => {
      const props: Record<string, unknown> = row().findAll(
        node => node.props.accessibilityRole === 'button',
        { deep: false },
      )[0]?.props ?? {};
      return props.accessibilityState;
    };
    expect(state()).toEqual({ expanded: false });
    await press(row());
    expect(state()).toEqual({ expanded: true });
  });

  it('asks the bridge for the chosen theme, closes the list and moves the check mark', async () => {
    await press(row());
    await pressOption('Light');
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    expect(options()).toHaveLength(0);
    expect(textOf(row())).toContain('Light');
    await press(row());
    expect(options().filter(isChecked).map(textOf)).toEqual(['Light']);
  });

  it('can choose the OS appearance', async () => {
    await press(row());
    await pressOption('Same as the phone');
    expect(mockSetTheme).toHaveBeenCalledWith('system');
    expect(textOf(row())).toContain('Same as the phone');
  });

  it('closes without a change when the saved choice is picked again', async () => {
    await press(row());
    await pressOption('Light');
    mockSetTheme.mockClear();
    await press(row());
    await pressOption('Light');
    expect(mockSetTheme).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
  });

  it('saves the default when it is picked while nothing is saved, so the choice sticks', async () => {
    expect(preference.savedThemePreference()).toBeUndefined();
    await press(row());
    await pressOption('Same as the phone');
    expect(mockSetTheme).toHaveBeenCalledWith('system');
    expect(preference.savedThemePreference()).toBe('system');
  });

  it('follows a change made elsewhere while the screen is open', async () => {
    await act(async () => {
      await preference.applyTheme('dark');
    });
    expect(textOf(row())).toContain('Dark');
  });

  it('shows the row in the language of the app', async () => {
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    const german = screen.root.findAllByProps({ title: 'Design' })[0];
    if (!german) throw new Error('Missing German theme row');
    expect(textOf(german)).toContain('Wie das Telefon');
  });
});

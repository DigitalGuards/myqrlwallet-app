import React, { act } from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import SettingsScreen from '../../app/settings';
import BiometricService from '../BiometricService';
import { isRecord } from '../guards';
import { i18n } from '../../i18n';
import { languageNames, supportedLanguages } from '../../i18n/languages';

function isCallback(value: unknown): value is () => unknown {
  return typeof value === 'function';
}

const mockSetLanguage = jest.fn((_language: string) => Promise.resolve());

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
  setLanguage: (language: string) => mockSetLanguage(language),
}));

describe('Settings language row', () => {
  let screen: ReactTestRenderer;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(BiometricService, 'isDeviceLoginReady').mockResolvedValue(false);
    await i18n.changeLanguage('de');
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
    const found = screen.root.findAllByProps({ title: 'Sprache' })[0];
    if (!found) throw new Error('Missing language row');
    return found;
  };
  const options = () => screen.root.findAll(
    node => node.props.accessibilityRole === 'radio',
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

  it('shows the current language in its own name and keeps the list closed', () => {
    expect(textOf(row())).toContain('Deutsch');
    expect(options()).toHaveLength(0);
  });

  it('opens one option per language, with the current one checked', async () => {
    await press(row());
    const shown = options();
    expect(shown.map(textOf)).toEqual(supportedLanguages.map(language => languageNames[language]));
    expect(shown.filter(isChecked).map(textOf)).toEqual(['Deutsch']);
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
    expect(screen.root.findAll(node => node.props.accessibilityRole === 'radiogroup', { deep: false })).toHaveLength(1);
  });

  it('asks the bridge to change the language and closes the list', async () => {
    await press(row());
    await pressOption('Русский');
    expect(mockSetLanguage).toHaveBeenCalledTimes(1);
    expect(mockSetLanguage).toHaveBeenCalledWith('ru');
    expect(options()).toHaveLength(0);
  });

  it('closes without a change when the current language is picked', async () => {
    await press(row());
    await pressOption('Deutsch');
    expect(mockSetLanguage).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
  });

  it('follows the language while the screen is open', async () => {
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    const spanish = screen.root.findAllByProps({ title: 'Idioma' })[0];
    if (!spanish) throw new Error('Missing Spanish language row');
    expect(textOf(spanish)).toContain('Español');
  });
});

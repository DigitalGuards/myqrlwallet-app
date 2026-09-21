import React, { act } from 'react';
import { Alert, AppState, Switch, type AppStateStatus } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import * as LocalAuthentication from 'expo-local-authentication';
import SettingsScreen from '../../app/settings';
import NativeBridge from '../NativeBridge';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';

let mockGeneration = 0;
let mockWalletGeneration = 0;
let mockBlurSettings: (() => void) | undefined;
const mockInvalidationListeners = new Set<() => void>();

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.3.1' } }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: (callback: () => () => void) => {
    jest.requireActual<typeof React>('react').useEffect(() => {
      mockBlurSettings = callback();
      return mockBlurSettings;
    }, [callback]);
  },
}));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('../../components/ChangePinModal', () => ({ ChangePinModal: 'ChangePinModal' }));
jest.mock('../../components/PinEntryModal', () => ({ PinEntryModal: 'PinEntryModal' }));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
jest.mock('../WebViewService', () => ({ getUserPreferences: jest.fn(async () => ({})) }));
jest.mock('../SeedStorageService', () => ({
  hasWallet: jest.fn(async () => true),
  requiresWalletRemovalAuthentication: jest.fn(async () => true),
  getWalletGeneration: jest.fn(() => mockWalletGeneration),
  isWalletGenerationCurrent: jest.fn((value: number) => value === mockWalletGeneration),
}));
jest.mock('../ScreenSecurityService', () => ({ isEnabled: jest.fn(async () => false) }));
jest.mock('../DAppConnectionStore', () => ({ activeCount: jest.fn(async () => 0) }));
jest.mock('../Logger', () => ({ error: jest.fn() }));
jest.mock('../NativeBridge', () => ({
  captureSecurityContext: jest.fn(() => ({ authorizationGeneration: mockGeneration })),
  isSecurityContextCurrent: jest.fn(
    (context) => context.authorizationGeneration === mockGeneration
  ),
  onAuthorizationInvalidated: jest.fn((listener: () => void) => {
    mockInvalidationListeners.add(listener);
    return () => mockInvalidationListeners.delete(listener);
  }),
  invalidateAuthorization: jest.fn(() => {
    mockGeneration += 1;
    for (const listener of mockInvalidationListeners) listener();
  }),
  clearWalletDurably: jest.fn(async (_timeout: number, guard: () => boolean) => {
    if (!guard()) throw new Error('Authorization changed');
  }),
}));

describe('Settings session-bound security actions', () => {
  let screen: ReactTestRenderer | undefined;
  let originalState: AppStateStatus;
  const listeners = new Set<(state: AppStateStatus) => void>();
  let resolvePrompt: (value: LocalAuthentication.LocalAuthenticationResult) => void;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGeneration = 0;
    mockWalletGeneration = 0;
    mockInvalidationListeners.clear();
    listeners.clear();
    originalState = AppState.currentState;
    AppState.currentState = 'active';
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockImplementation(async () => ({ success: true }));
    jest.mocked(SeedStorageService.requiresWalletRemovalAuthentication).mockResolvedValue(true);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(BiometricService, 'isDeviceLoginReady').mockResolvedValue(true);
    jest.spyOn(BiometricService, 'disableDeviceLogin').mockImplementation(async (guard) => {
      if (guard && !guard()) throw new Error('Authorization changed');
    });
    jest.spyOn(BiometricService, 'queuePinChange');
    jest.spyOn(BiometricService, 'queueDeviceLoginSetup');
    await act(async () => {
      screen = create(<SettingsScreen />);
    });
  });

  afterEach(async () => {
    if (screen) await act(async () => screen?.unmount());
    screen = undefined;
    BiometricService.clearPendingSecurityOperations();
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function row(title: string) {
    return screen!.root.findAll((node) => node.props.title === title)[0];
  }
  function modal(name: string) {
    return screen!.root.findByType(name as never).props;
  }
  function button(title: string, text: string) {
    const call = [...jest.mocked(Alert.alert).mock.calls]
      .reverse()
      .find(([heading]) => heading === title);
    const selected = call?.[2]?.find((candidate) => candidate.text === text);
    if (!selected?.onPress) throw new Error(`Missing ${title}/${text}`);
    return selected.onPress;
  }
  async function transition(next: AppStateStatus, elapsed = 0) {
    await act(async () => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
      jest.advanceTimersByTime(elapsed);
    });
  }
  async function begin(kind: 'disable' | 'change' | 'remove') {
    if (kind === 'disable')
      return row('Device Login')
        .findByType(Switch as never)
        .props.onValueChange(false);
    return row(kind === 'change' ? 'Change PIN' : 'Remove All Wallets').props.onPress();
  }
  function deferPrompt() {
    jest.mocked(LocalAuthentication.authenticateAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        })
    );
  }

  it('allows a fresh authenticated two-confirmation removal with a final guard', async () => {
    await act(async () => {
      await begin('remove');
    });
    await act(async () => {
      button('Remove All Wallets', 'Remove All')();
    });
    await act(async () => {
      await button('Delete All Wallets?', 'Yes, Delete All')();
    });
    expect(NativeBridge.clearWalletDurably).toHaveBeenCalledWith(20000, expect.any(Function));
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing explicit recovery removal policy without a device prompt', async () => {
    jest.mocked(SeedStorageService.requiresWalletRemovalAuthentication).mockResolvedValue(false);
    await act(async () => {
      await begin('remove');
    });
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    expect(button('Remove All Wallets', 'Remove All')).toBeDefined();
  });

  it.each(['authorization', 'wallet', 'background', 'blur', 'unmount'])(
    'expires retained final removal on %s',
    async (reason) => {
      await act(async () => {
        await begin('remove');
      });
      await act(async () => {
        button('Remove All Wallets', 'Remove All')();
      });
      const confirm = button('Delete All Wallets?', 'Yes, Delete All');
      await act(async () => {
        if (reason === 'authorization') NativeBridge.invalidateAuthorization();
        if (reason === 'wallet') mockWalletGeneration += 1;
        if (reason === 'blur') mockBlurSettings?.();
        if (reason === 'unmount') {
          screen?.unmount();
          screen = undefined;
        }
      });
      if (reason === 'background') {
        await transition('background');
        await transition('active');
      }
      await act(async () => {
        await confirm();
      });
      expect(NativeBridge.clearWalletDurably).not.toHaveBeenCalled();
    }
  );

  it('expires the first removal confirmation on document or authorization invalidation', async () => {
    await act(async () => {
      await begin('remove');
    });
    const confirm = button('Remove All Wallets', 'Remove All');
    await act(async () => {
      NativeBridge.invalidateAuthorization();
      await confirm();
    });
    expect(
      jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Delete All Wallets?')
    ).toBe(false);
  });

  it.each(['disable', 'change', 'remove'] as const)(
    'allows %s after OS success settles inactive then active within grace',
    async (kind) => {
      deferPrompt();
      let operation!: Promise<void>;
      await act(async () => {
        operation = begin(kind);
      });
      await transition('inactive', 400);
      await act(async () => {
        resolvePrompt({ success: true });
      });
      expect(BiometricService.disableDeviceLogin).not.toHaveBeenCalled();
      expect(modal('ChangePinModal').visible).toBe(false);
      expect(
        jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Remove All Wallets')
      ).toBe(false);
      await transition('active', 100);
      await act(async () => {
        await operation;
      });
      if (kind === 'disable') expect(BiometricService.disableDeviceLogin).toHaveBeenCalledTimes(1);
      if (kind === 'change') expect(modal('ChangePinModal').visible).toBe(true);
      if (kind === 'remove') expect(button('Remove All Wallets', 'Remove All')).toBeDefined();
    }
  );

  it.each(['disable', 'change', 'remove'] as const)(
    'rejects stale %s prompt success after real background',
    async (kind) => {
      deferPrompt();
      let operation!: Promise<void>;
      await act(async () => {
        operation = begin(kind);
      });
      await transition('inactive', 400);
      await transition('background');
      await transition('active');
      await act(async () => {
        resolvePrompt({ success: true });
        await operation;
      });
      expect(BiometricService.disableDeviceLogin).not.toHaveBeenCalled();
      expect(modal('ChangePinModal').visible).toBe(false);
      expect(
        jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Remove All Wallets')
      ).toBe(false);
    }
  );

  it.each(['disable', 'change', 'remove'] as const)(
    'expires %s if the settled prompt stays inactive',
    async (kind) => {
      deferPrompt();
      let operation!: Promise<void>;
      await act(async () => {
        operation = begin(kind);
      });
      await transition('inactive');
      await act(async () => {
        resolvePrompt({ success: true });
      });
      await act(async () => {
        jest.advanceTimersByTime(301);
        await operation;
      });
      await transition('active');
      expect(BiometricService.disableDeviceLogin).not.toHaveBeenCalled();
      expect(modal('ChangePinModal').visible).toBe(false);
      expect(
        jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Remove All Wallets')
      ).toBe(false);
    }
  );

  it.each(['cancel', 'throw'])(
    'keeps a %s OS prompt from authorizing a PIN change',
    async (result) => {
      if (result === 'cancel')
        jest
          .mocked(LocalAuthentication.authenticateAsync)
          .mockResolvedValue({ success: false, error: 'user_cancel' });
      else
        jest
          .mocked(LocalAuthentication.authenticateAsync)
          .mockRejectedValue(new Error('OS failure'));
      await act(async () => {
        await begin('change');
      });
      expect(modal('ChangePinModal').visible).toBe(false);
    }
  );

  it('binds PIN-change modal submission to its original action, including after reauthorization', async () => {
    await act(async () => {
      await begin('change');
    });
    const stale = modal('ChangePinModal').onSubmit;
    await act(async () => {
      NativeBridge.invalidateAuthorization();
    });
    expect(modal('ChangePinModal').visible).toBe(false);
    await act(async () => {
      await begin('change');
    });
    await act(async () => {
      stale('old', 'new');
    });
    expect(BiometricService.queuePinChange).not.toHaveBeenCalled();
    await act(async () => {
      modal('ChangePinModal').onSubmit('fresh-old', 'fresh-new');
    });
    expect(BiometricService.queuePinChange).toHaveBeenCalledWith('fresh-old', 'fresh-new');
  });

  it('dismisses Device Login setup on background and rejects retained submission', async () => {
    await act(async () => {
      row('Device Login')
        .findByType(Switch as never)
        .props.onValueChange(true);
    });
    const stale = modal('PinEntryModal').onSubmit;
    expect(modal('PinEntryModal').visible).toBe(true);
    await transition('background');
    await transition('active');
    expect(modal('PinEntryModal').visible).toBe(false);
    await act(async () => {
      stale('1234');
    });
    expect(BiometricService.queueDeviceLoginSetup).not.toHaveBeenCalled();
  });

  it('keeps the final removal guard false across a delayed journal read', async () => {
    let mutationAllowed = true;
    jest.mocked(NativeBridge.clearWalletDurably).mockImplementationOnce(async (_timeout, guard) => {
      NativeBridge.invalidateAuthorization();
      mutationAllowed = guard?.() ?? true;
    });
    await act(async () => {
      await begin('remove');
    });
    await act(async () => {
      button('Remove All Wallets', 'Remove All')();
    });
    await act(async () => {
      await button('Delete All Wallets?', 'Yes, Delete All')();
    });
    expect(mutationAllowed).toBe(false);
  });
});

import React, { act } from 'react';
import { Alert, AppState, Switch, type AppStateStatus } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import * as LocalAuthentication from 'expo-local-authentication';
import SettingsScreen from '../../app/settings';
import NativeBridge from '../NativeBridge';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';
import Logger from '../Logger';
import Diagnostics from '../Diagnostics';
import * as Clipboard from 'expo-clipboard';
import { runAsPromise as mockRunAsPromise } from '../runAsPromise';

const { create } = jest.requireActual<{
  create: (element: React.ReactElement) => Promise<ReactTestRenderer>;
}>('@react-native/jest-preset/jest/renderer');

function isCallback(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function callback(props: Record<string, unknown>, name: string) {
  const value = props[name];
  if (!isCallback(value)) throw new Error(`Missing ${name} callback`);
  return value;
}

let mockGeneration = 0;
let mockWalletGeneration = 0;
let mockBlurSettings: (() => void) | undefined;
const mockInvalidationListeners = new Set<() => void>();

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.3.1' } }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: (callback: () => () => void) => {
    jest.requireActual<typeof React>('react').useEffect(() => {
      mockBlurSettings = callback();
      return mockBlurSettings;
    }, [callback]);
  },
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
  getWalletGeneration: jest.fn(() => mockWalletGeneration),
  isWalletGenerationCurrent: jest.fn((value: number) => value === mockWalletGeneration),
}));
jest.mock('../ScreenSecurityService', () => ({ isEnabled: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../DAppConnectionStore', () => ({ activeCount: jest.fn(() => Promise.resolve(0)) }));
jest.mock('../Logger', () => ({ error: jest.fn() }));
jest.mock('../NativeBridge', () => ({
  captureSecurityContext: jest.fn(() => ({ authorizationGeneration: mockGeneration })),
  isSecurityContextCurrent: jest.fn(
    (context: { authorizationGeneration: number }) => context.authorizationGeneration === mockGeneration
  ),
  onAuthorizationInvalidated: jest.fn((listener: () => void) => {
    mockInvalidationListeners.add(listener);
    return () => mockInvalidationListeners.delete(listener);
  }),
  invalidateAuthorization: jest.fn(() => {
    mockGeneration += 1;
    for (const listener of mockInvalidationListeners) listener();
  }),
  clearWalletDurably: jest.fn((_timeout: number, guard: () => boolean) =>
    mockRunAsPromise(() => {
      if (!guard()) throw new Error('Authorization changed');
    })
  ),
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
      .mockResolvedValue({ success: true });
    jest.mocked(SeedStorageService).requiresWalletRemovalAuthentication.mockResolvedValue(true);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(BiometricService, 'isDeviceLoginReady').mockResolvedValue(true);
    jest.spyOn(BiometricService, 'disableDeviceLogin').mockImplementation((guard) =>
      mockRunAsPromise(() => {
        if (guard && !guard()) throw new Error('Authorization changed');
      })
    );
    jest.spyOn(BiometricService, 'queuePinChange');
    jest.spyOn(BiometricService, 'queueDeviceLoginSetup');
    await act(async () => {
      screen = await create(<SettingsScreen />);
    });
  });

  afterEach(async () => {
    if (screen) await act<undefined>(() => {
      screen?.unmount();
    });
    screen = undefined;
    BiometricService.clearPendingSecurityOperations();
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function row(title: string) {
    const selected = screen?.root.findAllByProps({ title })[0];
    if (!selected) throw new Error(`Missing ${title} row`);
    return selected;
  }
  function modal(name: string) {
    if (!screen) throw new Error('Settings screen is not mounted');
    const props: Record<string, unknown> = screen.root.find((node) => node.type === name).props;
    return props;
  }
  function button(title: string, text: string): () => unknown {
    const call = [...jest.mocked(Alert.alert).mock.calls]
      .reverse()
      .find(([heading]) => heading === title);
    const selected = call?.[2]?.find((candidate) => candidate.text === text);
    if (!selected?.onPress) throw new Error(`Missing ${title}/${text}`);
    return selected.onPress;
  }
  async function transition(next: AppStateStatus, elapsed = 0) {
    await act<undefined>(() => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
      jest.advanceTimersByTime(elapsed);
    });
  }
  function begin(kind: 'disable' | 'change' | 'remove'): Promise<unknown> {
    return mockRunAsPromise(() => {
      if (kind === 'disable')
        return callback(
          row('Device Login').find((node) => Object.is(node.type, Switch)).props,
          'onValueChange'
        )(false);
      return callback(row(kind === 'change' ? 'Change PIN' : 'Remove All Wallets').props, 'onPress')();
    });
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
    await act<undefined>(() => {
      button('Remove All Wallets', 'Remove All')();
    });
    await act(async () => {
      await button('Delete All Wallets?', 'Yes, Delete All')();
    });
    expect(jest.mocked(NativeBridge).clearWalletDurably.mock.calls).toContainEqual([
      20000, expect.any(Function),
    ]);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected wallet removal and keeps the failure visible', async () => {
    const failure = new Error('Storage failure');
    jest.mocked(NativeBridge).clearWalletDurably.mockRejectedValueOnce(failure);
    await act(async () => {
      await begin('remove');
    });
    await act<undefined>(() => {
      button('Remove All Wallets', 'Remove All')();
    });
    await act(async () => {
      await button('Delete All Wallets?', 'Yes, Delete All')();
    });
    expect(jest.mocked(NativeBridge).clearWalletDurably.mock.calls).toHaveLength(1);
    expect(Logger.error).toHaveBeenCalledWith('Settings', 'Failed to remove wallet:', failure);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Removal Incomplete',
      'Wallet removal has not reached all storage layers yet. Keep the app open and try again. The app will resume the wipe after restart.',
      [{ text: 'OK' }]
    );
    expect(jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Wallet Removed')).toBe(false);
  });

  it('offers removal when native storage holds no wallet', async () => {
    // The wallet page can hold wallets whose device credential is gone, and
    // its recovery steps point here.
    jest.mocked(SeedStorageService).hasWallet.mockResolvedValue(false);
    jest.mocked(SeedStorageService).requiresWalletRemovalAuthentication.mockResolvedValue(false);
    await act<undefined>(() => {
      screen?.unmount();
    });
    await act(async () => {
      screen = await create(<SettingsScreen />);
    });
    await act(async () => {
      await begin('remove');
    });
    await act<undefined>(() => {
      button('Remove All Wallets', 'Remove All')();
    });
    await act(async () => {
      await button('Delete All Wallets?', 'Yes, Delete All')();
    });
    expect(jest.mocked(NativeBridge).clearWalletDurably.mock.calls).toContainEqual([
      20000, expect.any(Function),
    ]);
    jest.mocked(SeedStorageService).hasWallet.mockResolvedValue(true);
  });

  it('preserves the existing explicit recovery removal policy without a device prompt', async () => {
    jest.mocked(SeedStorageService).requiresWalletRemovalAuthentication.mockResolvedValue(false);
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
      await act<undefined>(() => {
        button('Remove All Wallets', 'Remove All')();
      });
      const confirm = button('Delete All Wallets?', 'Yes, Delete All');
      await act<undefined>(() => {
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
      expect(jest.mocked(NativeBridge).clearWalletDurably.mock.calls).toHaveLength(0);
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

  it.each<'disable' | 'change' | 'remove'>(['disable', 'change', 'remove'])(
    'allows %s after OS success settles inactive then active within grace',
    async (kind) => {
      deferPrompt();
      let operation: Promise<unknown>;
      await act<undefined>(() => {
        operation = begin(kind);
      });
      await transition('inactive', 400);
      await act<undefined>(() => {
        resolvePrompt({ success: true });
      });
      expect(jest.mocked(BiometricService).disableDeviceLogin.mock.calls).toHaveLength(0);
      expect(modal('ChangePinOverlay').visible).toBe(false);
      expect(
        jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Remove All Wallets')
      ).toBe(false);
      await transition('active', 100);
      await act(async () => {
        await operation;
      });
      if (kind === 'disable') expect(jest.mocked(BiometricService).disableDeviceLogin.mock.calls).toHaveLength(1);
      if (kind === 'change') expect(modal('ChangePinOverlay').visible).toBe(true);
      if (kind === 'remove') expect(button('Remove All Wallets', 'Remove All')).toBeDefined();
    }
  );

  it.each<'disable' | 'change' | 'remove'>(['disable', 'change', 'remove'])(
    'rejects stale %s prompt success after real background',
    async (kind) => {
      deferPrompt();
      let operation: Promise<unknown>;
      await act<undefined>(() => {
        operation = begin(kind);
      });
      await transition('inactive', 400);
      await transition('background');
      await transition('active');
      await act(async () => {
        resolvePrompt({ success: true });
        await operation;
      });
      expect(jest.mocked(BiometricService).disableDeviceLogin.mock.calls).toHaveLength(0);
      expect(modal('ChangePinOverlay').visible).toBe(false);
      expect(
        jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Remove All Wallets')
      ).toBe(false);
    }
  );

  it.each<'disable' | 'change' | 'remove'>(['disable', 'change', 'remove'])(
    'expires %s if the settled prompt stays inactive',
    async (kind) => {
      deferPrompt();
      let operation: Promise<unknown>;
      await act<undefined>(() => {
        operation = begin(kind);
      });
      await transition('inactive');
      await act<undefined>(() => {
        resolvePrompt({ success: true });
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_001);
        await operation;
      });
      await transition('active');
      expect(jest.mocked(BiometricService).disableDeviceLogin.mock.calls).toHaveLength(0);
      expect(modal('ChangePinOverlay').visible).toBe(false);
      expect(
        jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Remove All Wallets')
      ).toBe(false);
    }
  );

  it.each<['disable' | 'change' | 'remove', number]>([
    ['disable', 350],
    ['disable', 1_000],
    ['disable', 5_000],
    ['change', 1_000],
    ['remove', 1_000],
  ])(
    'completes %s when iOS reports active %ims after the prompt settles',
    async (kind, delay) => {
      // TestFlight 1.3.3 (33): Face ID succeeded, the sheet took longer than
      // 300ms to hand back active, and the toggle silently stayed on.
      deferPrompt();
      let operation: Promise<unknown>;
      await act<undefined>(() => {
        operation = begin(kind);
      });
      await transition('inactive');
      await act<undefined>(() => {
        resolvePrompt({ success: true });
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(delay);
      });
      await transition('active');
      await act(async () => {
        await operation;
      });
      if (kind === 'disable') {
        expect(jest.mocked(BiometricService).disableDeviceLogin.mock.calls).toHaveLength(1);
        expect(Alert.alert).toHaveBeenCalledWith('Disabled', 'Device Login has been disabled.');
      }
      if (kind === 'change') expect(modal('ChangePinOverlay').visible).toBe(true);
      if (kind === 'remove') expect(button('Remove All Wallets', 'Remove All')).toBeDefined();
    }
  );

  it('reports a failed disable prompt instead of silently leaving the toggle on', async () => {
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: 'lockout' });
    await act(async () => {
      await begin('disable');
    });
    expect(jest.mocked(BiometricService).disableDeviceLogin.mock.calls).toHaveLength(0);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Device Login Still On',
      'Authentication did not complete. Please try again.'
    );
  });

  it('stays quiet when the user cancels the disable prompt', async () => {
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: 'user_cancel' });
    await act(async () => {
      await begin('disable');
    });
    expect(jest.mocked(BiometricService).disableDeviceLogin.mock.calls).toHaveLength(0);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

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
      expect(modal('ChangePinOverlay').visible).toBe(false);
    }
  );

  it('reports a failed Change PIN prompt', async () => {
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: 'lockout' });
    await act(async () => {
      await begin('change');
    });
    expect(modal('ChangePinOverlay').visible).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'PIN Not Changed',
      'Authentication did not complete. Please try again.'
    );
    expect(Logger.error).toHaveBeenCalledWith('Settings', expect.stringContaining('Change PIN'));
  });

  it('stays quiet when the user cancels the Change PIN prompt', async () => {
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: 'user_cancel' });
    await act(async () => {
      await begin('change');
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('tells the user when a stale Change PIN form is submitted', async () => {
    await act(async () => {
      await begin('change');
    });
    const stale = callback(modal('ChangePinOverlay'), 'onSubmit');
    await act<undefined>(() => {
      NativeBridge.invalidateAuthorization();
    });
    jest.mocked(Alert.alert).mockClear();
    await act<undefined>(() => {
      stale('old', 'new');
    });
    expect(jest.mocked(BiometricService).queuePinChange.mock.calls).toHaveLength(0);
    expect(Alert.alert).toHaveBeenCalledWith(
      'PIN Not Changed',
      'Your session changed before the PIN could be updated. Please try again.'
    );
    expect(Logger.error).toHaveBeenCalledWith('Settings', expect.stringContaining('stale'));
  });

  it('copies diagnostics only after the user confirms', async () => {
    Diagnostics.clear();
    Diagnostics.event('Test', 'wallet locked');
    Diagnostics.record('error', 'Test', 'failed pin=1234');
    await act<undefined>(() => {
      callback(row('Copy Diagnostics').props, 'onPress')();
    });
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    await act(async () => {
      await button('Copy Diagnostics', 'Copy')();
    });
    const copied = jest.mocked(Clipboard.setStringAsync).mock.calls[0]?.[0];
    expect(copied).toContain('app: 1.3.1');
    expect(copied).toContain('wallet locked');
    expect(copied).not.toContain('1234');
    expect(Alert.alert).toHaveBeenCalledWith('Copied', 'Diagnostics copied to the clipboard.');
  });

  it('binds PIN-change modal submission to its original action, including after reauthorization', async () => {
    await act(async () => {
      await begin('change');
    });
    const stale = callback(modal('ChangePinOverlay'), 'onSubmit');
    await act<undefined>(() => {
      NativeBridge.invalidateAuthorization();
    });
    expect(modal('ChangePinOverlay').visible).toBe(false);
    await act(async () => {
      await begin('change');
    });
    await act<undefined>(() => {
      stale('old', 'new');
    });
    expect(jest.mocked(BiometricService).queuePinChange.mock.calls).toHaveLength(0);
    await act<undefined>(() => {
      callback(modal('ChangePinOverlay'), 'onSubmit')('fresh-old', 'fresh-new');
    });
    expect(jest.mocked(BiometricService).queuePinChange.mock.calls).toContainEqual(['fresh-old', 'fresh-new']);
  });

  it('dismisses Device Login setup on background and rejects retained submission', async () => {
    await act<undefined>(() => {
      callback(row('Device Login').find((node) => Object.is(node.type, Switch)).props, 'onValueChange')(true);
    });
    const stale = callback(modal('PinEntryModal'), 'onSubmit');
    expect(modal('PinEntryModal').visible).toBe(true);
    await transition('background');
    await transition('active');
    expect(modal('PinEntryModal').visible).toBe(false);
    await act<undefined>(() => {
      stale('1234');
    });
    expect(jest.mocked(BiometricService).queueDeviceLoginSetup.mock.calls).toHaveLength(0);
  });

  it('keeps the final removal guard false across a delayed journal read', async () => {
    let mutationAllowed = true;
    jest.mocked(NativeBridge).clearWalletDurably.mockImplementationOnce((_timeout, guard) =>
      mockRunAsPromise(() => {
        NativeBridge.invalidateAuthorization();
        mutationAllowed = guard?.() ?? true;
      })
    );
    await act(async () => {
      await begin('remove');
    });
    await act<undefined>(() => {
      button('Remove All Wallets', 'Remove All')();
    });
    await act(async () => {
      await button('Delete All Wallets?', 'Yes, Delete All')();
    });
    expect(mutationAllowed).toBe(false);
  });
});

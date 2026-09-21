jest.mock('expo-local-authentication', () => ({ authenticateAsync: jest.fn() }));
jest.mock('../SeedStorageService', () => ({}));
jest.mock('../NativeBridge', () => ({
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR: 'ambiguous',
  NATIVE_PIN_COMMIT_ERROR: 'commit failed',
}));
jest.mock('../Logger', () => ({ error: jest.fn() }));

import * as LocalAuthentication from 'expo-local-authentication';
import BiometricService from '../BiometricService';

describe('actual OS authentication prompt lifetime', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('notifies only when the final concurrent prompt settles', async () => {
    const resolvers: ((value: LocalAuthentication.LocalAuthenticationResult) => void)[] = [];
    jest.mocked(LocalAuthentication.authenticateAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const settled = jest.fn();
    const unsubscribe = BiometricService.onAuthenticationPromptSettled(settled);
    try {
      const first = BiometricService.authenticate();
      const second = BiometricService.authenticate();
      expect(BiometricService.isAuthenticationPromptActive()).toBe(true);
      resolvers[0]({ success: false, error: 'user_cancel' });
      await first;
      expect(BiometricService.isAuthenticationPromptActive()).toBe(true);
      expect(settled).not.toHaveBeenCalled();
      resolvers[1]({ success: true });
      await second;
      expect(BiometricService.isAuthenticationPromptActive()).toBe(false);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('clears prompt state and notifies on an OS authentication error', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockRejectedValue(new Error('OS failure'));
    const settled = jest.fn();
    const unsubscribe = BiometricService.onAuthenticationPromptSettled(settled);
    try {
      await expect(BiometricService.authenticate()).resolves.toMatchObject({ success: false });
      expect(BiometricService.isAuthenticationPromptActive()).toBe(false);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('does not notify a disposed screen subscription', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true });
    const settled = jest.fn();
    BiometricService.onAuthenticationPromptSettled(settled)();
    await BiometricService.authenticate();
    expect(settled).not.toHaveBeenCalled();
  });
});

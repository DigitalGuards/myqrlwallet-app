jest.mock('../SeedStorageService', () => ({
  __esModule: true,
  default: {
    getWalletGeneration: jest.fn(),
    isWalletGenerationCurrent: jest.fn(),
    isBiometricEnabled: jest.fn(),
    getStoredPin: jest.fn(),
    storePinSecurely: jest.fn(),
    clearStoredPin: jest.fn(),
    setBiometricEnabled: jest.fn(),
    migratePinAccessibility: jest.fn(),
  },
}));

import DeviceLoginState from '../DeviceLoginState';
import SeedStorageService from '../SeedStorageService';
import { runAsPromise } from '../runAsPromise';

const storage = jest.mocked(SeedStorageService);
let pin: string | null;
let enabled: boolean;
let generation = 0;

beforeEach(() => {
  jest.resetAllMocks();
  pin = null;
  enabled = false;
  generation += 1;
  storage.getWalletGeneration.mockImplementation(() => generation);
  storage.isWalletGenerationCurrent.mockImplementation((value) => value === generation);
  storage.isBiometricEnabled.mockImplementation(() => runAsPromise(() => enabled));
  storage.getStoredPin.mockImplementation(() => runAsPromise(() => pin));
  storage.storePinSecurely.mockImplementation((value) => runAsPromise(() => {
    pin = value;
  }));
  storage.clearStoredPin.mockImplementation(() => runAsPromise(() => {
    pin = null;
  }));
  storage.setBiometricEnabled.mockImplementation((value) => runAsPromise(() => {
    enabled = value;
  }));
  storage.migratePinAccessibility.mockResolvedValue(true);
});

it('retains a rotated PIN only while Device Login is enabled', async () => {
  enabled = true;
  pin = '1234';
  await DeviceLoginState.commitRotatedPin('5678');
  expect(pin).toBe('5678');
  await DeviceLoginState.disable();
  await DeviceLoginState.commitRotatedPin('9012');
  expect(enabled).toBe(false);
  expect(pin).toBeNull();
});

it.each([false, true])(
  'rolls back setup when the enable preference rejects (committed: %s)',
  async (committed) => {
    storage.setBiometricEnabled.mockImplementationOnce((value) => runAsPromise(() => {
      if (committed) enabled = value;
      throw new Error('Preference unavailable');
    }));
    await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow('Preference unavailable');
    expect(enabled).toBe(false);
    expect(pin).toBeNull();
  }
);

it('clears the optional PIN even when preference rollback also fails', async () => {
  storage.setBiometricEnabled.mockRejectedValue(new Error('Preference unavailable'));
  await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow();
  expect(pin).toBeNull();
});

it('clears a setup PIN that was committed before SecureStore rejected', async () => {
  storage.storePinSecurely.mockImplementationOnce((value) => runAsPromise(() => {
    pin = value;
    throw new Error('Write acknowledgement unavailable');
  }));
  await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow(
    'Write acknowledgement unavailable'
  );
  expect(enabled).toBe(false);
  expect(pin).toBeNull();
});

it('restores an already enabled prior PIN after setup fails', async () => {
  enabled = true;
  pin = '9876';
  storage.setBiometricEnabled.mockRejectedValueOnce(new Error('Preference unavailable'));
  await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow();
  expect(enabled).toBe(true);
  expect(pin).toBe('9876');
});

it('removes a new optional PIN when authorization is invalidated during its write', async () => {
  let authorized = true;
  storage.storePinSecurely.mockImplementationOnce((value) => runAsPromise(() => {
    pin = value;
    authorized = false;
  }));
  await expect(DeviceLoginState.enable('1234', () => authorized)).rejects.toThrow(
    'Wallet state changed'
  );
  expect(enabled).toBe(false);
  expect(pin).toBeNull();
});

it('does not clean up or resurrect credentials after the wallet generation changes', async () => {
  storage.storePinSecurely.mockImplementationOnce(() => runAsPromise(() => {
    generation += 1;
    pin = '9012';
    enabled = true;
  }));
  await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow('Wallet state changed');
  expect(pin).toBe('9012');
  expect(enabled).toBe(true);
  expect(storage.clearStoredPin.mock.calls).toHaveLength(0);
});

it('serializes disabling after an in-flight PIN rotation', async () => {
  enabled = true;
  pin = '1234';
  let releaseWrite: (() => void) | undefined;
  storage.storePinSecurely.mockImplementationOnce(
    (value) =>
      new Promise<void>((resolve) => {
        releaseWrite = () => {
          pin = value;
          resolve();
        };
      })
  );
  const rotation = DeviceLoginState.commitRotatedPin('5678');
  const disable = DeviceLoginState.disable();
  for (let i = 0; i < 20 && !releaseWrite; i++) await Promise.resolve();
  expect(storage.setBiometricEnabled.mock.calls).toHaveLength(0);
  if (!releaseWrite) throw new Error('PIN write was not reached');
  releaseWrite();
  await Promise.all([rotation, disable]);
  expect(enabled).toBe(false);
  expect(pin).toBeNull();
});

it('does not let queued rotation restore a PIN after disablement', async () => {
  enabled = true;
  pin = '1234';
  await Promise.all([DeviceLoginState.disable(), DeviceLoginState.commitRotatedPin('5678')]);
  expect(enabled).toBe(false);
  expect(pin).toBeNull();
});

it('rejects a stale disable guard before the queued mutation begins', async () => {
  enabled = true;
  pin = '1234';
  await expect(DeviceLoginState.disable(() => false)).rejects.toThrow('authorization changed');
  expect(storage.setBiometricEnabled.mock.calls).toHaveLength(0);
  expect(pin).toBe('1234');
});

it.each([false, true])(
  'converges a failed disable preference write (committed: %s)',
  async (committed) => {
    enabled = true;
    pin = '1234';
    storage.setBiometricEnabled.mockImplementationOnce((value) => runAsPromise(() => {
      if (committed) enabled = value;
      throw new Error('Preference unavailable');
    }));
    await expect(DeviceLoginState.disable()).rejects.toThrow('Preference unavailable');
    expect(enabled).toBe(!committed);
    expect(pin).toBe(committed ? null : '1234');
  }
);

it('prevents an old authentication migration from restoring a disabled or rotated PIN', async () => {
  enabled = true;
  pin = '1234';
  await DeviceLoginState.commitRotatedPin('5678');
  expect(await DeviceLoginState.migratePinAccessibility('1234')).toBe(false);
  expect(storage.migratePinAccessibility.mock.calls).toHaveLength(0);
  expect(await DeviceLoginState.migratePinAccessibility('5678')).toBe(true);
  await DeviceLoginState.disable();
  storage.migratePinAccessibility.mockClear();
  expect(await DeviceLoginState.migratePinAccessibility('5678')).toBe(false);
  expect(storage.migratePinAccessibility.mock.calls).toHaveLength(0);
  expect(pin).toBeNull();
});

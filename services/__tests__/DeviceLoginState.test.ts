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
  storage.isBiometricEnabled.mockImplementation(async () => enabled);
  storage.getStoredPin.mockImplementation(async () => pin);
  storage.storePinSecurely.mockImplementation(async (value) => {
    pin = value;
  });
  storage.clearStoredPin.mockImplementation(async () => {
    pin = null;
  });
  storage.setBiometricEnabled.mockImplementation(async (value) => {
    enabled = value;
  });
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
    storage.setBiometricEnabled.mockImplementationOnce(async (value) => {
      if (committed) enabled = value;
      throw new Error('Preference unavailable');
    });
    await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow();
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
  storage.storePinSecurely.mockImplementationOnce(async (value) => {
    pin = value;
    throw new Error('Write acknowledgement unavailable');
  });
  await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow();
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
  storage.storePinSecurely.mockImplementationOnce(async (value) => {
    pin = value;
    authorized = false;
  });
  await expect(DeviceLoginState.enable('1234', () => authorized)).rejects.toThrow(
    'Wallet state changed'
  );
  expect(enabled).toBe(false);
  expect(pin).toBeNull();
});

it('does not clean up or resurrect credentials after the wallet generation changes', async () => {
  storage.storePinSecurely.mockImplementationOnce(async () => {
    generation += 1;
    pin = '9012';
    enabled = true;
  });
  await expect(DeviceLoginState.enable('1234', () => true)).rejects.toThrow('Wallet state changed');
  expect(pin).toBe('9012');
  expect(enabled).toBe(true);
  expect(storage.clearStoredPin).not.toHaveBeenCalled();
});

it('serializes disabling after an in-flight PIN rotation', async () => {
  enabled = true;
  pin = '1234';
  let releaseWrite!: () => void;
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
  expect(storage.setBiometricEnabled).not.toHaveBeenCalled();
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
  expect(storage.setBiometricEnabled).not.toHaveBeenCalled();
  expect(pin).toBe('1234');
});

it.each([false, true])(
  'converges a failed disable preference write (committed: %s)',
  async (committed) => {
    enabled = true;
    pin = '1234';
    storage.setBiometricEnabled.mockImplementationOnce(async (value) => {
      if (committed) enabled = value;
      throw new Error('Preference unavailable');
    });
    await expect(DeviceLoginState.disable()).rejects.toThrow();
    expect(enabled).toBe(!committed);
    expect(pin).toBe(committed ? null : '1234');
  }
);

it('prevents an old authentication migration from restoring a disabled or rotated PIN', async () => {
  enabled = true;
  pin = '1234';
  await DeviceLoginState.commitRotatedPin('5678');
  expect(await DeviceLoginState.migratePinAccessibility('1234')).toBe(false);
  expect(storage.migratePinAccessibility).not.toHaveBeenCalled();
  expect(await DeviceLoginState.migratePinAccessibility('5678')).toBe(true);
  await DeviceLoginState.disable();
  storage.migratePinAccessibility.mockClear();
  expect(await DeviceLoginState.migratePinAccessibility('5678')).toBe(false);
  expect(storage.migratePinAccessibility).not.toHaveBeenCalled();
  expect(pin).toBeNull();
});

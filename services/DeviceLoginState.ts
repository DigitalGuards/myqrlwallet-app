import SeedStorageService from './SeedStorageService';

/** Serializes optional PIN retention with setup, disablement and PIN rotation. */
class DeviceLoginState {
  private mutations: Promise<void> = Promise.resolve();

  private enqueue(operation: (isWalletCurrent: () => boolean) => Promise<void>): Promise<void> {
    const generation = SeedStorageService.getWalletGeneration();
    const isWalletCurrent = () => SeedStorageService.isWalletGenerationCurrent(generation);
    const run = this.mutations
      .catch(() => undefined)
      .then(async () => {
        if (!isWalletCurrent()) throw new Error('Wallet state changed');
        await operation(isWalletCurrent);
      });
    this.mutations = run.catch(() => undefined);
    return run;
  }

  enable(pin: string, isAuthorized: () => boolean): Promise<void> {
    return this.enqueue(async (isWalletCurrent) => {
      const isCurrent = () => isWalletCurrent() && isAuthorized();
      if (!isCurrent()) throw new Error('Wallet state changed');
      const previouslyEnabled = await SeedStorageService.isBiometricEnabled();
      const previousPin = previouslyEnabled ? await SeedStorageService.getStoredPin() : null;
      if (!isCurrent()) throw new Error('Wallet state changed');
      try {
        await SeedStorageService.storePinSecurely(pin);
        if (!isCurrent()) throw new Error('Wallet state changed');
        await SeedStorageService.setBiometricEnabled(true);
        if (!isCurrent()) throw new Error('Wallet state changed');
      } catch (error) {
        // A write can commit before rejecting. Restore the prior optional
        // credential state, including after auth cancellation. A wipe owns
        // cleanup once the wallet generation changes, so never resurrect it.
        if (isWalletCurrent()) {
          if (previouslyEnabled) {
            if (previousPin !== null) await SeedStorageService.storePinSecurely(previousPin);
            else await SeedStorageService.clearStoredPin();
            if (isWalletCurrent()) await SeedStorageService.setBiometricEnabled(true);
          } else {
            try {
              await SeedStorageService.setBiometricEnabled(false);
            } finally {
              if (isWalletCurrent()) await SeedStorageService.clearStoredPin();
            }
          }
        }
        throw error;
      }
    });
  }

  disable(isAuthorized: () => boolean = () => true): Promise<void> {
    return this.enqueue(async (isWalletCurrent) => {
      if (!isAuthorized()) throw new Error('App authorization changed');
      try {
        await SeedStorageService.setBiometricEnabled(false);
      } catch (error) {
        // If the preference committed before rejection, finish the requested
        // cleanup. Preserve a still-enabled prior PIN when the write failed.
        if (
          isWalletCurrent() &&
          !(await SeedStorageService.isBiometricEnabled()) &&
          isWalletCurrent()
        ) {
          await SeedStorageService.clearStoredPin();
        }
        throw error;
      }
      // Completing deletion is safe after a lock, but never target a new wallet.
      if (!isWalletCurrent()) throw new Error('Wallet state changed');
      await SeedStorageService.clearStoredPin();
    });
  }

  commitRotatedPin(pin: string): Promise<void> {
    return this.enqueue(async (isWalletCurrent) => {
      const enabled = await SeedStorageService.isBiometricEnabled();
      if (!isWalletCurrent()) throw new Error('Wallet state changed');
      if (enabled) await SeedStorageService.storePinSecurely(pin);
      else await SeedStorageService.clearStoredPin();
    });
  }

  async migratePinAccessibility(
    pin: string,
    walletGeneration: number = SeedStorageService.getWalletGeneration()
  ): Promise<boolean> {
    let migrated = false;
    await this.enqueue(async (isWalletCurrent) => {
      if (!SeedStorageService.isWalletGenerationCurrent(walletGeneration))
        throw new Error('Wallet state changed');
      const enabled = await SeedStorageService.isBiometricEnabled();
      const currentPin = enabled ? await SeedStorageService.getStoredPin() : null;
      if (!isWalletCurrent() || !SeedStorageService.isWalletGenerationCurrent(walletGeneration))
        throw new Error('Wallet state changed');
      // An authentication started before disablement or rotation must never
      // restore its old optional PIN while upgrading Keychain accessibility.
      if (enabled && currentPin === pin) {
        migrated = await SeedStorageService.migratePinAccessibility(pin);
      }
    });
    return migrated;
  }
}

export default new DeviceLoginState();

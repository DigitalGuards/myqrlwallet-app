jest.mock('../BiometricService', () => ({
  __esModule: true,
  default: { authenticate: jest.fn() },
}));
jest.mock('../SeedStorageService', () => ({
  __esModule: true,
  default: { requiresWalletRemovalAuthentication: jest.fn() },
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BiometricService from '../BiometricService';
import SeedStorageService from '../SeedStorageService';
import { authorizeWalletRemoval } from '../WalletRemoval';

describe('wallet removal authorization', () => {
  const required = jest.mocked(SeedStorageService.requiresWalletRemovalAuthentication);
  const authenticate = jest.mocked(BiometricService.authenticate);

  beforeEach(() => jest.resetAllMocks());

  it('allows an explicitly unprotected wallet without a device prompt', async () => {
    required.mockResolvedValue(false);
    await expect(authorizeWalletRemoval()).resolves.toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'requires successful device authentication for protected data: %s',
    async (success) => {
      required.mockResolvedValue(true);
      authenticate.mockResolvedValue({ success });
      await expect(authorizeWalletRemoval()).resolves.toBe(success);
      expect(authenticate).toHaveBeenCalledWith('Authenticate to remove wallet');
    }
  );

  it('fails closed when the protection state cannot be read', async () => {
    required.mockRejectedValue(new Error('storage unavailable'));
    await expect(authorizeWalletRemoval()).rejects.toThrow('storage unavailable');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('checks both-profile authorization before displaying destructive confirmation', () => {
    const source = readFileSync(resolve(__dirname, '../../app/settings.tsx'), 'utf8');
    const removal = source.slice(source.indexOf('const removeWallet = async'));
    expect(removal.indexOf('await authorizeWalletRemoval()')).toBeLessThan(
      removal.indexOf("'Remove All Wallets'")
    );
    expect(removal).toContain('including preserved earlier wallet backups');
  });
});

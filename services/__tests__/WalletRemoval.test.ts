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
import english from '../../locales/en/native.json';

describe('wallet removal authorization', () => {
  const required = jest.spyOn(SeedStorageService, 'requiresWalletRemovalAuthentication');
  const authenticate = jest.spyOn(BiometricService, 'authenticate');

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
      const isCallerCurrent = () => true;
      await expect(authorizeWalletRemoval(isCallerCurrent)).resolves.toBe(success);
      expect(authenticate).toHaveBeenCalledWith('Authenticate to remove wallet', isCallerCurrent);
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
    const authorization = removal.indexOf('await authorizeWalletRemoval(');
    const confirmation = removal.indexOf("t('settings.removeAll')");
    expect(authorization).toBeGreaterThanOrEqual(0);
    expect(confirmation).toBeGreaterThan(authorization);
    expect(removal).toContain("t('settings.removeWarning')");
    expect(english.settings.removeWarning).toContain('including preserved earlier wallet backups');
  });
});

import { t } from '../i18n';
import BiometricService from './BiometricService';
import SeedStorageService from './SeedStorageService';

/** Authenticate destructive removal without reusing an earlier profile's PIN. */
export async function authorizeWalletRemoval(isCallerCurrent?: () => boolean): Promise<boolean> {
  if (!(await SeedStorageService.requiresWalletRemovalAuthentication())) return true;
  const result = await BiometricService.authenticate(t('biometric.removePrompt'), isCallerCurrent);
  return result.success;
}

import BiometricService from './BiometricService';
import SeedStorageService from './SeedStorageService';

/** Authenticate destructive removal without reusing an earlier profile's PIN. */
export async function authorizeWalletRemoval(): Promise<boolean> {
  if (!(await SeedStorageService.requiresWalletRemovalAuthentication())) return true;
  const result = await BiometricService.authenticate('Authenticate to remove wallet');
  return result.success;
}

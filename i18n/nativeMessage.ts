import type { ParseKeys } from 'i18next';
import english from '../locales/en/native.json';
import { t } from './index';

export type NativeKey = ParseKeys;

// Service and bridge error strings are contracts. Translate the known text
// only where native UI displays it; preserve unknown external details.
const messages = new Map<string, NativeKey>([
  [english.errors.finishingRemoval, 'errors.finishingRemoval'],
  [english.errors.loginInterrupted, 'errors.loginInterrupted'],
  [english.errors.loginIncomplete, 'errors.loginIncomplete'],
  [english.errors.securityUnknown, 'errors.securityUnknown'],
  [english.errors.incorrectWalletPin, 'errors.incorrectWalletPin'],
  [english.errors.verifyWalletPin, 'errors.verifyWalletPin'],
  [english.errors.interrupted, 'errors.interrupted'],
  [english.errors.authChanged, 'errors.authChanged'],
  [english.errors.retrievePin, 'errors.retrievePin'],
  [english.errors.authFailed, 'errors.authFailed'],
  [english.errors.loginUnavailable, 'errors.loginUnavailable'],
  [english.errors.loginDisabled, 'errors.loginDisabled'],
  [english.errors.noStoredPin, 'errors.noStoredPin'],
  [english.errors.biometricOff, 'errors.biometricOff'],
  [english.errors.cancelled, 'errors.cancelled'],
  [english.errors.walletChanged, 'errors.walletChanged'],
  [english.errors.incorrectPin, 'errors.incorrectPin'],
  [english.errors.setupLogin, 'errors.setupLogin'],
  [english.errors.noQueuedPin, 'errors.noQueuedPin'],
  [english.errors.noQueuedLogin, 'errors.noQueuedLogin'],
  [english.errors.oldPinActive, 'errors.oldPinActive'],
  [english.errors.loginRestoreFailed, 'errors.loginRestoreFailed'],
  [english.errors.pinRecoveryUnconfirmed, 'errors.pinRecoveryUnconfirmed'],
  [english.errors.changePin, 'errors.changePin'],
  [english.errors.changePinUnexpected, 'errors.changePinUnexpected'],
  [english.errors.pinFormat, 'errors.pinFormat'],
  [english.errors.clearInProgress, 'errors.clearInProgress'],
  [english.errors.verificationInProgress, 'errors.verificationInProgress'],
  [english.errors.authorizationChangedRetry, 'errors.authorizationChangedRetry'],
  [english.errors.webNotReady, 'errors.webNotReady'],
  [english.errors.pinTimeout, 'errors.pinTimeout'],
  [english.errors.webUnavailable, 'errors.webUnavailable'],
  [english.errors.changeInProgress, 'errors.changeInProgress'],
  [english.errors.authorizationChanged, 'errors.authorizationChanged'],
  [english.errors.documentChanged, 'errors.documentChanged'],
  [english.errors.pinResponseMismatch, 'errors.pinResponseMismatch'],
  [english.errors.bundledOpen, 'errors.bundledOpen'],
  [english.errors.webProtection, 'errors.webProtection'],
  [english.errors.bundledReplaced, 'errors.bundledReplaced'],
  [english.errors.walletLoad, 'errors.walletLoad'],
  [english.errors.bridgeUnbound, 'errors.bridgeUnbound'],
  [english.errors.invalidPinFormat, 'errors.invalidPinFormat'],
  [english.errors.noActiveAccount, 'errors.noActiveAccount'],
  [english.errors.noEncryptedSeed, 'errors.noEncryptedSeed'],
  [english.errors.deviceCredential, 'errors.deviceCredential'],
  [english.errors.storage, 'errors.storage'],
  [english.errors.verificationChanged, 'errors.verificationChanged'],
  [english.errors.clearedDuringPinChange, 'errors.clearedDuringPinChange'],
  [english.errors.changeUnexpected, 'errors.changeUnexpected'],
  [english.errors.pinBusy, 'errors.pinBusy'],
  [english.errors.invalidOldPin, 'errors.invalidOldPin'],
  [english.errors.invalidNewPin, 'errors.invalidNewPin'],
  [english.errors.noEncryptedSeeds, 'errors.noEncryptedSeeds'],
  [english.errors.incorrectCurrentPin, 'errors.incorrectCurrentPin'],
]);

export function nativeMessage(message: string): string {
  const key = messages.get(message);
  if (key) return t(key);
  const attempts = /^Incorrect PIN\. (\d+) attempts? remaining\.$/.exec(message);
  if (attempts) return t('errors.attempts', { count: Number(attempts[1]) });
  const lockout = /^Too many failed attempts\. Please wait (\d+) minutes?\.$/.exec(message);
  if (lockout) return t('errors.lockoutMinutes', { count: Number(lockout[1]) });
  const profile = /^This app build ships a wallet for the wrong network\. It needs (.+) and the bundled wallet does not declare it \(missing: (.+)\)\. Install a build whose wallet was synced with scripts\/sync-embedded-web\.sh from a v3 frontend build\.$/.exec(message);
  if (profile) return t('errors.wrongNetwork', { network: profile[1], missing: profile[2] });
  return message;
}

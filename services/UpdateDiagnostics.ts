import * as Updates from 'expo-updates';

/**
 * One diagnostics line describing the running JS bundle: the update id,
 * channel, runtime version, creation time and whether it is the bundle that
 * shipped in the store build. Identifiers only, nothing about the wallet.
 */
export function describeRunningUpdate(): string {
  try {
    const embedded = Updates.isEmbeddedLaunch;
    return [
      `update: ${embedded ? 'embedded' : (Updates.updateId ?? 'unknown')}`,
      `embedded=${String(embedded)}`,
      `channel=${Updates.channel ?? 'none'}`,
      `runtime=${Updates.runtimeVersion ?? 'unknown'}`,
      `created=${Updates.createdAt ? Updates.createdAt.toISOString() : 'n/a'}`,
    ].join(' ');
  } catch {
    return 'update: unavailable';
  }
}

/** Compatibility metadata. Privileged bridge calls still require document binding and authorization. */
export const NATIVE_WALLET_CAPABILITIES = Object.freeze({
  bridgeVersion: 1,
  addressScheme: 'qip55-64',
  networkProfile: 'v3-private',
  chainId: '0x301825',
  genesisHash: '0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4',
});

export const NATIVE_WEBVIEW_INJECTED_OBJECT = Object.freeze({
  qrlWalletCapabilities: NATIVE_WALLET_CAPABILITIES,
});

export const NATIVE_WALLET_BLOCKCHAIN = 'TEST_NET_V3';

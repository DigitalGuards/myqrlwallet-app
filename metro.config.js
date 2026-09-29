const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Windows-specific path handling
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
];

// Ensure Windows paths are handled correctly
config.watchFolders = [
  path.resolve(__dirname),
];

// assets/web/index.html is the whole web wallet as one document. Metro treats
// .html as source by default, so it has to be declared an asset for
// require() to return an asset module the app can read at runtime.
if (!config.resolver.assetExts.includes('html')) {
  config.resolver.assetExts = [...config.resolver.assetExts, 'html'];
}
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => ext !== 'html');

module.exports = config;

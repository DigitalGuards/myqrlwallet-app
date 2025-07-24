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

module.exports = config;
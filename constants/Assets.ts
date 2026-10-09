import type { FontSource } from 'expo-font';
import type { ImageSourcePropType } from 'react-native';

/**
 * Metro resolves `require()` of a bundled asset to an opaque module id, and
 * the bundler typings return `any` for it. This is the one place that touches
 * that `any`, so its file-scoped lint override (see eslint.config.js) covers
 * nothing else: every other file imports these typed constants.
 */
export const LOGO_IMAGE: ImageSourcePropType = require('../assets/images/myqrlwallet/mqrlwallet.png');

export const SPACE_MONO_FONT: FontSource = require('../assets/fonts/SpaceMono-Regular.ttf');

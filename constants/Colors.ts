/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

/**
 * Color scheme matching the QRL Wallet web application
 * Using the same color variables as defined in the web app's CSS
 */

import { NativeThemeLight } from './Theme';

// Light mode colors: the "Ink and blue" set of the web wallet, from constants/Theme.ts
const backgroundLight = NativeThemeLight.background;
const foregroundLight = NativeThemeLight.foreground;
const primaryLight = NativeThemeLight.primary;
const primaryForegroundLight = NativeThemeLight.primaryForeground;
const secondaryLight = NativeThemeLight.secondary;
const secondaryForegroundLight = NativeThemeLight.primaryForeground;

// Dark mode colors
const backgroundDark = '#080C16'; // --background (QRL Blue)
const foregroundDark = '#f8fafc'; // --foreground in dark mode CSS
const primaryDark = '#f8fafc'; // --primary in dark mode CSS
const primaryForegroundDark = '#121921'; // --primary-foreground in dark mode CSS
const secondaryDark = '#33ADE6'; // QRL Blue (--secondary in dark mode CSS)
const secondaryForegroundDark = '#041725'; // --secondary-foreground in dark mode CSS

export default {
  light: {
    text: foregroundLight,
    background: backgroundLight,
    tint: secondaryLight,
    tabIconDefault: NativeThemeLight.tertiary,
    tabIconSelected: secondaryLight,
    headerBackground: backgroundLight,
    headerText: foregroundLight,
    primary: primaryLight,
    primaryForeground: primaryForegroundLight,
    secondary: secondaryLight,
    secondaryForeground: secondaryForegroundLight,
  },
  dark: {
    text: foregroundDark,
    background: backgroundDark,
    tint: secondaryDark,
    tabIconDefault: '#555',
    tabIconSelected: secondaryDark,
    headerBackground: backgroundDark,
    headerText: foregroundDark,
    primary: primaryDark,
    primaryForeground: primaryForegroundDark,
    secondary: secondaryDark,
    secondaryForeground: secondaryForegroundDark,
  },
};

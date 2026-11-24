/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

/**
 * Color scheme matching the QRL Wallet web application
 * Using the same color variables as defined in the web app's CSS
 */

// Light mode colors: the "Ink and blue" set of the web wallet (see constants/Theme.ts)
const backgroundLight = '#F3F4F7';
const foregroundLight = '#0F1729';
const primaryLight = '#0967AE';
const primaryForegroundLight = '#FFFFFF';
const secondaryLight = '#0967AE';
const secondaryForegroundLight = '#FFFFFF';

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
    tabIconDefault: '#606876',
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

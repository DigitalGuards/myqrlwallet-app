/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

/**
 * Color scheme matching the QRL Wallet web application
 * Using the same color variables as defined in the web app's CSS
 */

// Light mode colors
const backgroundLight = '#ffffff'; // --background in CSS
const foregroundLight = '#0c0e10'; // --foreground in CSS
const primaryLight = '#121921'; // --primary in CSS
const primaryForegroundLight = '#f8fafc'; // --primary-foreground in CSS
const secondaryLight = '#ff8700'; // QRL Orange (--secondary in CSS)
const secondaryForegroundLight = '#f8fafc'; // --secondary-foreground in CSS

// Dark mode colors
const backgroundDark = '#0c0e10'; // --background in dark mode CSS
const foregroundDark = '#f8fafc'; // --foreground in dark mode CSS
const primaryDark = '#f8fafc'; // --primary in dark mode CSS
const primaryForegroundDark = '#121921'; // --primary-foreground in dark mode CSS
const secondaryDark = '#ff8700'; // QRL Orange (--secondary in dark mode CSS)
const secondaryForegroundDark = '#f8fafc'; // --secondary-foreground in dark mode CSS

export default {
  light: {
    text: foregroundLight,
    background: backgroundLight,
    tint: secondaryLight,
    tabIconDefault: '#ccc',
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

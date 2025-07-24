# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyQRL Wallet is a React Native/Expo mobile application that serves as a native wrapper for the QRL Wallet website (https://qrlwallet.com). It provides enhanced mobile UX with biometric authentication, session persistence, and native navigation.

## Development Commands

```bash
# Development
npm start          # Start Expo development server
npm run android    # Run on Android device/emulator
npm run ios        # Run on iOS device/simulator
npm run web        # Run in web browser

# Testing & Linting
npm test          # Run Jest tests in watch mode
npm run lint      # Run ESLint

# Building (requires EAS CLI)
eas build --platform android --profile preview   # Build APK for testing
eas build --platform android --profile production # Build AAB for Play Store
eas build --platform ios --profile production    # Build for App Store
```

## Architecture Overview

### Core WebView Integration
The app wraps qrlwallet.com in a native container. The main integration points are:

1. **QRLWebView Component** (`components/QRLWebView.tsx`): Enhanced WebView with:
   - Custom scrolling behavior for better mobile UX
   - Error handling with retry functionality
   - Loading states with timeout fallbacks (30 seconds)
   - HTTPS-only enforcement for security
   - Custom user agent for web compatibility

2. **WebViewService** (`services/WebViewService.ts`): Manages persistent storage using AsyncStorage for:
   - Cookie persistence across app restarts
   - Session tracking
   - User preferences (biometric settings, auto-lock, notifications)

3. **BiometricService** (`services/BiometricService.ts`): Handles device authentication using expo-local-authentication

### Navigation Structure
Uses Expo Router v4 with file-based routing:
- `app/(tabs)/` - Tab navigation (though tabs are hidden via `tabBarStyle: { display: 'none' }`)
- Main screen loads the WebView
- Settings screen for user preferences

### State Management
No global state management library - relies on:
- AsyncStorage for persistence
- React hooks for local state
- Service classes for business logic

### Theme System
Dark theme only with QRL branding colors defined in `constants/Colors.ts`:
- Primary: #F5870A (orange)
- Secondary: #8B959C (gray)
- Background: #0A1929 (dark blue)

## Important Implementation Details

### WebView Configuration
- Restricts navigation to qrlwallet.com domain only
- Injects JavaScript for enhanced scrolling on iOS
- Custom error pages for network issues
- Handles SSL errors gracefully

### Security Considerations
- Biometric authentication is optional but recommended
- WebView restricted to HTTPS URLs only
- Session data stored securely in AsyncStorage
- Planned auto-lock feature (see `upcoming_feats.md`)

### Platform-Specific Behaviors
- iOS: Custom scroll behavior injection for better performance
- Android: Standard WebView implementation
- Both: Native status bar styling and safe area handling

## Planned Features

The `upcoming_feats.md` file documents two major features:

1. **Enhanced Cache Clearing**: Full cache/cookie clearing functionality
2. **Auto-lock with Biometric Auth**: Automatic locking after inactivity with biometric unlock

## Build & Deployment

### EAS Configuration
- Project ID: 6fcaa6f9-5975-4ee1-8bcf-4d1c9e60a3f8
- Bundle ID: com.chiefdg.myqrlwallet
- Three build profiles: development, preview, production

### App Store Requirements
- iOS: Configured for App Store submission
- Android: Supports both APK (preview) and AAB (production) formats
- Assets: All branding assets in place (icons, splash screens)

## Testing Approach

Uses Jest with Expo preset. Test files should be placed alongside components with `.test.tsx` extension. Run specific tests with:
```bash
npm test -- --testNamePattern="test name"
```
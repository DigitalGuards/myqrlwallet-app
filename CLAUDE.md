# CLAUDE.md - MyQRL Wallet Mobile App

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyQRL Wallet is a React Native/Expo mobile application that serves as a native wrapper for the QRL Wallet website (https://qrlwallet.com). It provides enhanced mobile UX with biometric authentication, native features via JS bridge, session persistence, and push notifications.

## Architecture

**WebView Wrapper Pattern**: The web app (zondwebwallet-frontend) runs inside a WebView. Native features are exposed via a postMessage bridge. The web app detects native context via User-Agent string containing "MyQRLWallet".

```
┌─────────────────────────────────────────────────────────────┐
│                 Native App (Expo/React Native)              │
│  ┌──────────────┬────────────────┬───────────────────────┐  │
│  │ BiometricSvc │ NotificationSvc│ NativeBridge          │  │
│  │ (existing)   │ (planned)      │ - QR Scanner          │  │
│  │              │ - Poll for txs │ - Clipboard           │  │
│  │              │ - Local notifs │ - Share               │  │
│  └──────────────┴────────────────┴───────────────────────┘  │
│                           │                                  │
│              postMessage / onMessage                         │
│                           │                                  │
│  ┌────────────────────────▼─────────────────────────────┐   │
│  │              WebView (qrlwallet.com)                 │   │
│  │  - Detects app via User-Agent                        │   │
│  │  - Shows app-specific UI when detected               │   │
│  │  - Communicates via window.ReactNativeWebView        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

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

## Key Components

### 1. QRLWebView (`components/QRLWebView.tsx`)
Core WebView component with:
- Renders qrlwallet.com in a native container
- Handles native↔web message bridge via `onMessage` and `injectJavaScript`
- Domain-restricted to qrlwallet.com only (security)
- Custom user agent includes "MyQRLWallet" for web app detection
- Error handling with retry functionality
- Loading states with timeout fallbacks
- Exposes ref for sending QR results and reloading

### 2. NativeBridge (`services/NativeBridge.ts`)
Central message router:
- Receives messages from WebView via `handle()`
- Routes to appropriate native features (QR, clipboard, share)
- Sends responses back to WebView via `sendToWeb()`
- Singleton pattern for app-wide access

### 3. BiometricService (`services/BiometricService.ts`)
Device authentication:
- Face ID / Touch ID / Fingerprint support
- Optional app lock on launch
- Uses expo-local-authentication

### 4. WebViewService (`services/WebViewService.ts`)
Session management:
- Cookie persistence via AsyncStorage
- User preferences storage
- Session tracking

### 5. SeedStorageService (`services/SeedStorageService.ts`)
Encrypted seed persistence:
- Stores PIN-encrypted seeds in SecureStore
- Associates seeds with wallet addresses
- Enables biometric unlock flow (PIN stored separately)
- Uses expo-secure-store for encrypted storage

### 6. NotificationService (`services/NotificationService.ts`) - PLANNED
Push notifications:
- Poll for new transactions in background
- Local push notifications for incoming txs
- Uses expo-notifications

## Bridge Message Protocol

### Web → Native Messages
```typescript
{ type: 'WEB_APP_READY' }                              // Web app initialized
{ type: 'SCAN_QR' }                                    // Open native QR scanner
{ type: 'COPY_TO_CLIPBOARD', payload: { text } }       // Copy to clipboard
{ type: 'SHARE', payload: { title, text, url } }       // Native share sheet
{ type: 'TX_CONFIRMED', payload: { txHash, type } }    // Transaction done
{ type: 'STORE_SEED', payload: { address, encryptedSeed } }  // Store encrypted seed
{ type: 'REQUEST_BIOMETRIC_UNLOCK', payload: { address } }   // Request biometric unlock
{ type: 'OPEN_NATIVE_SETTINGS' }                       // Open native settings tab
{ type: 'LOG', payload: { message } }                  // Debug logging
```

### Native → Web Messages
```typescript
{ type: 'INIT_DATA', payload: { hasStoredSeed, biometricEnabled, ... } }  // On app ready
{ type: 'QR_RESULT', payload: { address } }            // Scanned QR data
{ type: 'BIOMETRIC_UNLOCK_RESULT', payload: { success, pin?, error? } }   // Unlock result
{ type: 'SEED_STORED', payload: { success, address } } // Seed storage confirmation
{ type: 'BIOMETRIC_SUCCESS', payload: { authenticated } }
{ type: 'APP_STATE', payload: { state } }              // active/background
{ type: 'CLIPBOARD_SUCCESS', payload: { text } }
{ type: 'SHARE_SUCCESS', payload: { action } }
{ type: 'ERROR', payload: { message } }
```

### Message Flow Example (QR Scanning)
1. Web app (in native) shows "Scan QR" button
2. User taps → `sendToNative('SCAN_QR')`
3. Native receives via `onMessage`, routes to `NativeBridge.handle()`
4. Bridge calls `onQRScanRequest` callback → opens camera
5. Camera scans QR → native calls `NativeBridge.sendQRResult(address)`
6. Bridge injects JS: `window.dispatchEvent(new CustomEvent('nativeMessage', {...}))`
7. Web app receives via `subscribeToNativeMessages()` → fills in address field

## Integration with Frontend (zondwebwallet-frontend)

The web app detects native context:
```typescript
// In web app
const isInNativeApp = () => navigator.userAgent.includes('MyQRLWallet')

// Show app-specific UI
{isInNativeApp() && <ScanQRButton onClick={() => sendToNative('SCAN_QR')} />}
```

Key frontend files for bridge integration:
- `src/utils/nativeApp.ts` - Detection and messaging utilities
- `src/components/NativeAppBridge.tsx` - Message listener component
- `src/env.d.ts` - TypeScript declarations for ReactNativeWebView

## File Structure

```
myqrlwallet-app/
├── app/                    # Expo Router screens
│   ├── (tabs)/
│   │   ├── index.tsx       # Main WebView screen
│   │   ├── settings.tsx    # App settings (wallet mgmt, biometrics)
│   │   └── _layout.tsx     # Tab layout (hidden)
│   ├── _layout.tsx         # Root layout
│   └── +not-found.tsx      # 404 page
├── components/
│   ├── QRLWebView.tsx      # Core WebView with bridge
│   ├── PinEntryModal.tsx   # PIN input modal for unlock/setup
│   ├── Themed.tsx          # Theme-aware base components
│   ├── ThemedText.tsx      # Themed text
│   └── ThemedView.tsx      # Themed view
├── services/
│   ├── NativeBridge.ts     # Message routing
│   ├── BiometricService.ts # Device auth
│   ├── SeedStorageService.ts # Encrypted seed persistence
│   └── WebViewService.ts   # Session management
├── constants/
│   └── Colors.ts           # Theme colors
├── hooks/
│   ├── useColorScheme.ts   # System theme detection
│   └── useThemeColor.ts    # Theme color helper
└── assets/                 # Images, fonts, icons
```

## Security Considerations

- WebView restricted to HTTPS + qrlwallet.com domain only
- Biometric auth optional but recommended
- No sensitive data stored in app (wallet keys stay in web localStorage)
- Session data in AsyncStorage with optional auto-clear
- All native↔web communication via secure postMessage bridge

## Build & Deployment

### EAS Configuration
- Project ID: 6fcaa6f9-5975-4ee1-8bcf-4d1c9e60a3f8
- Bundle ID: com.chiefdg.myqrlwallet
- Three build profiles: development, preview, production

### App Store Requirements
- iOS: Configured for App Store submission
- Android: Supports both APK (preview) and AAB (production) formats
- Assets: All branding assets in place (icons, splash screens)

## Planned Features

1. **QR Scanner Integration** - Native camera for scanning addresses
2. **Push Notifications** - Background polling + local notifications for transactions
3. **Offline Support** - Cache balances and transaction history
4. **Enhanced Cache Clearing** - Full cache/cookie clearing functionality

## Testing

Uses Jest with Expo preset:
```bash
npm test                              # Run all tests in watch mode
npm test -- --testNamePattern="name"  # Run specific tests
```

## Dependencies

Key native modules:
- `react-native-webview` - WebView component
- `expo-camera` - QR scanning (planned)
- `expo-notifications` - Local push notifications (planned)
- `expo-local-authentication` - Biometrics
- `@react-native-async-storage/async-storage` - Persistence

## Theme System

Dark theme only with QRL branding colors defined in `constants/Colors.ts`:
- Primary: #F5870A (orange)
- Secondary: #8B959C (gray)
- Background: #0A1929 (dark blue)

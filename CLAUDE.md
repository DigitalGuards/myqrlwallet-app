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
│  │ BiometricSvc │ ScreenSecurity │ NativeBridge          │  │
│  │ - Device auth│ - Screenshot   │ - QR Scanner          │  │
│  │ - Auto-lock  │   prevention   │ - Clipboard           │  │
│  │              │ - FLAG_SECURE  │ - Share               │  │
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
Device Login authentication:
- Supports Face ID, Touch ID, fingerprint, PIN, pattern, or passcode
- "Device Login" branding (covers all device auth methods)
- Auto-lock when app goes to background (standard finance app behavior)
- PIN verification with web app before storing (prevents incorrect PIN)
- Requires device auth to disable Device Login
- Uses expo-local-authentication with SecurityLevel.SECRET check

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

### 6. ScreenSecurityService (`services/ScreenSecurityService.ts`)
Screenshot and screen recording prevention:
- Uses expo-screen-capture module
- FLAG_SECURE on Android - screenshots show black, recording blocked
- Secure text field technique on iOS - prevents screen capture
- Disabled by default - user must explicitly enable after importing wallet
- Persists setting via AsyncStorage

### 7. NotificationService (`services/NotificationService.ts`) - PLANNED
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
{ type: 'SEED_STORED', payload: { address, encryptedSeed, blockchain } }  // Backup seed
{ type: 'REQUEST_BIOMETRIC_UNLOCK' }                   // Request Device Login unlock
{ type: 'WALLET_CLEARED' }                             // Confirm wallet data cleared
{ type: 'PIN_VERIFIED', payload: { success, error? } } // PIN verification result
{ type: 'OPEN_NATIVE_SETTINGS' }                       // Open native settings tab
{ type: 'LOG', payload: { message } }                  // Debug logging
```

### Native → Web Messages
```typescript
{ type: 'QR_RESULT', payload: { address } }            // Scanned QR data
{ type: 'UNLOCK_WITH_PIN', payload: { pin } }          // PIN after Device Login success
{ type: 'RESTORE_SEED', payload: { address, encryptedSeed, blockchain } }  // Restore backup
{ type: 'CLEAR_WALLET' }                               // Request web to clear wallet
{ type: 'VERIFY_PIN', payload: { pin } }               // Verify PIN can decrypt seed
{ type: 'BIOMETRIC_SUCCESS', payload: { authenticated } }
{ type: 'APP_STATE', payload: { state } }              // active/background
{ type: 'CLIPBOARD_SUCCESS' }
{ type: 'SHARE_SUCCESS' }
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
│   ├── ScreenSecurityService.ts # Screenshot/recording prevention
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
- Device Login (biometrics/PIN/pattern) optional but recommended
- Auto-lock when app goes to background (requires re-auth on return)
- PIN verified with web app before storing (ensures correct PIN)
- Device auth required to disable Device Login
- Device auth required to remove wallet when Device Login is enabled
- Screenshot prevention available (disabled by default, user must enable)
- Encrypted seeds stored in SecureStore (iOS Keychain / Android Keystore)
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

## Implemented Features

1. **QR Scanner** - Native camera for scanning addresses (expo-camera)
2. **Device Login** - Face ID / Touch ID / PIN / pattern authentication
3. **Auto-Lock** - App locks when backgrounded, requires re-auth on return
4. **Seed Backup** - Encrypted seeds backed up to SecureStore
5. **Screenshot Prevention** - Block screenshots/recordings (expo-screen-capture)
6. **Wallet Removal Protection** - Device auth required when Device Login enabled

## Planned Features

1. **Push Notifications** - Background polling + local notifications for transactions
2. **Offline Support** - Cache balances and transaction history

## Testing

Uses Jest with Expo preset:
```bash
npm test                              # Run all tests in watch mode
npm test -- --testNamePattern="name"  # Run specific tests
```

## Dependencies

Key native modules:
- `react-native-webview` - WebView component
- `expo-camera` - QR scanning
- `expo-local-authentication` - Biometrics
- `expo-screen-capture` - Screenshot/recording prevention
- `expo-haptics` - Haptic feedback
- `expo-secure-store` - Encrypted storage
- `@react-native-async-storage/async-storage` - Persistence
- `expo-notifications` - Local push notifications (planned)

## Theme System

Dark theme only with QRL branding colors defined in `constants/Colors.ts`:
- Primary: #F5870A (orange)
- Secondary: #8B959C (gray)
- Background: #0A1929 (dark blue)

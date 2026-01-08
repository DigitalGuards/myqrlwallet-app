# MyQRLWallet Mobile App

A React Native/Expo mobile application that wraps [MyQRLWallet](https://qrlwallet.com) with native enhancements. Provides a seamless mobile experience with biometric authentication, QR scanning, secure seed storage, and more.

## Features

### Current
- **WebView Integration** - Renders qrlwallet.com in a native container with optimized scrolling
- **Biometric Authentication** - Optional Face ID / Touch ID / Fingerprint protection with auto-trigger on launch
- **QR Code Scanner** - Native camera for scanning wallet addresses
- **Haptic Feedback** - Native device vibration for UI feedback
- **Session Persistence** - Maintains wallet sessions across app restarts
- **Native Bridge** - Two-way communication between web app and native features
- **Clipboard & Share** - Native clipboard and share sheet integration
- **Dark Theme** - QRL-branded dark theme with quantum loading screen

### Coming Soon
- **Push Notifications** - Alerts for incoming transactions
- **Offline Mode** - Cached balances and transaction history

## Architecture

The app uses a **WebView wrapper pattern** with a JavaScript bridge for native features:

```
┌─────────────────────────────────────────────────────────────┐
│                 Native App (Expo/React Native)              │
│  ┌──────────────┬────────────────┬───────────────────────┐  │
│  │ BiometricSvc │ NotificationSvc│ NativeBridge          │  │
│  │              │ (planned)      │ - QR Scanner          │  │
│  │              │                │ - Clipboard           │  │
│  │              │                │ - Share               │  │
│  └──────────────┴────────────────┴───────────────────────┘  │
│                           │                                  │
│              postMessage / onMessage                         │
│                           │                                  │
│  ┌────────────────────────▼─────────────────────────────┐   │
│  │              WebView (qrlwallet.com)                 │   │
│  │  - Detects app via User-Agent ("MyQRLWallet")        │   │
│  │  - Shows app-specific UI when detected               │   │
│  │  - Communicates via window.ReactNativeWebView        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The web app detects when it's running inside the native app and conditionally shows native features (like QR scan buttons) that communicate via the bridge.

## Getting Started

### Prerequisites

- Node.js v18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- For iOS: macOS with Xcode
- For Android: Android Studio with SDK

### Installation

```bash
# Clone the repository
git clone https://github.com/DigitalGuards/myqrlwallet-app.git
cd myqrlwallet-app

# Install dependencies
npm install

# Start development server
npm start
```

### Running the App

```bash
# Start Expo dev server
npm start

# Then press:
# 'a' - Open on Android device/emulator
# 'i' - Open on iOS simulator
# 'w' - Open in web browser

# Or run directly:
npm run android    # Android
npm run ios        # iOS (macOS only)
```

## Project Structure

```
myqrlwallet-app/
├── app/                        # Expo Router screens
│   ├── (tabs)/
│   │   ├── index.tsx           # Main WebView screen
│   │   ├── settings.tsx        # App settings
│   │   └── _layout.tsx         # Tab layout (hidden)
│   ├── _layout.tsx             # Root layout
│   └── +not-found.tsx          # 404 page
│
├── components/
│   ├── QRLWebView.tsx          # Core WebView with bridge integration
│   ├── Themed.tsx              # Theme-aware base components
│   ├── ThemedText.tsx          # Themed text component
│   └── ThemedView.tsx          # Themed view component
│
├── services/
│   ├── NativeBridge.ts         # Web↔Native message routing
│   ├── BiometricService.ts     # Device authentication
│   └── WebViewService.ts       # Session/cookie management
│
├── constants/
│   └── Colors.ts               # Theme colors
│
├── hooks/
│   ├── useColorScheme.ts       # System theme detection
│   └── useThemeColor.ts        # Theme color helper
│
├── assets/                     # Images, fonts, icons
├── CLAUDE.md                   # AI assistant documentation
└── README.md                   # This file
```

## Bridge Protocol

### Web → Native Messages

| Message | Payload | Description |
|---------|---------|-------------|
| `WEB_APP_READY` | - | Web app initialized, ready for data |
| `SCAN_QR` | - | Request native QR scanner |
| `COPY_TO_CLIPBOARD` | `{ text }` | Copy text to clipboard |
| `SHARE` | `{ title?, text?, url? }` | Open native share sheet |
| `TX_CONFIRMED` | `{ txHash, type }` | Notify of confirmed transaction |
| `STORE_SEED` | `{ address, encryptedSeed }` | Store encrypted seed in native |
| `REQUEST_BIOMETRIC_UNLOCK` | `{ address }` | Request biometric unlock for address |
| `OPEN_NATIVE_SETTINGS` | - | Open native settings tab |
| `LOG` | `{ message }` | Debug logging |

### Native → Web Messages

| Message | Payload | Description |
|---------|---------|-------------|
| `INIT_DATA` | `{ hasStoredSeed, biometricEnabled, ... }` | Initialization data on app ready |
| `QR_RESULT` | `{ address }` | Scanned QR code data |
| `BIOMETRIC_UNLOCK_RESULT` | `{ success, pin?, error? }` | Biometric unlock result with PIN |
| `SEED_STORED` | `{ success, address }` | Seed storage confirmation |
| `BIOMETRIC_SUCCESS` | `{ authenticated }` | Auth result |
| `APP_STATE` | `{ state }` | App foregrounded/backgrounded |
| `CLIPBOARD_SUCCESS` | `{ text }` | Clipboard operation succeeded |
| `SHARE_SUCCESS` | `{ action }` | Share completed |
| `ERROR` | `{ message }` | Error occurred |

## Building for Production

### EAS Build (Recommended)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build APK for testing
eas build --platform android --profile preview

# Build AAB for Play Store
eas build --platform android --profile production

# Build for App Store
eas build --platform ios --profile production
```

### Local Build

```bash
# Android
npx expo prebuild --platform android
cd android && ./gradlew assembleDebug
# APK at: android/app/build/outputs/apk/debug/app-debug.apk

# iOS (macOS only)
npx expo prebuild --platform ios
cd ios && xcodebuild -workspace myqrlwallet.xcworkspace -scheme myqrlwallet
```

## Roadmap

### Phase 1: Bridge Foundation ✅
- [x] NativeBridge service for message routing
- [x] QRLWebView with bridge integration
- [x] Clipboard and Share functionality
- [x] Web app detection via User-Agent

### Phase 2: Seed Persistence & Biometric Unlock ✅
- [x] SeedStorageService for encrypted seed storage
- [x] PIN-based encryption/decryption
- [x] Biometric unlock toggle in settings (shows after wallet import)
- [x] Settings screen with wallet management
- [x] Web app Settings redirects to native settings tab
- [x] Biometric auto-trigger on app launch
- [x] First-reopen prompt for biometric setup
- [x] Web app integration to trigger STORE_SEED on import

### Phase 3: QR Scanner ✅
- [x] Add expo-camera dependency
- [x] Create QRScannerModal component
- [x] Wire up SCAN_QR message handling
- [x] Haptic feedback support

### Phase 4: Push Notifications
- [ ] Add expo-notifications dependency
- [ ] Create NotificationService
- [ ] Background polling for new transactions
- [ ] Local notification on incoming tx

### Phase 5: Offline Support
- [ ] Cache account balances in AsyncStorage
- [ ] Cache recent transaction history
- [ ] Offline indicator in web app
- [ ] Sync on reconnect

### Phase 6: App Store Release
- [ ] App Store screenshots and metadata
- [ ] Play Store listing
- [ ] Privacy policy and terms
- [ ] Beta testing via TestFlight/Internal Testing

## Security

- **Domain Restriction**: WebView only loads qrlwallet.com
- **HTTPS Only**: All connections are encrypted
- **Secure Seed Storage**: Encrypted seeds stored in native SecureStore (not plain localStorage)
- **Biometric Auth**: Optional Face ID / Touch ID protection with PIN fallback
- **Secure Bridge**: Messages validated before processing

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | React Native + Expo SDK 54 |
| Navigation | Expo Router v4 |
| WebView | react-native-webview |
| Storage | @react-native-async-storage/async-storage |
| Biometrics | expo-local-authentication |
| Camera | expo-camera |
| Haptics | expo-haptics |
| Notifications | expo-notifications (planned) |

## Configuration

### EAS Build Profiles (`eas.json`)

- **development**: Debug build with dev client
- **preview**: APK for testing (Android)
- **production**: AAB/IPA for store submission

### App Configuration (`app.json`)

- Bundle ID: `com.chiefdg.myqrlwallet`
- Scheme: `myqrlwallet`

## Related Projects

- [myqrlwallet-frontend](https://github.com/DigitalGuards/myqrlwallet-frontend) - React web wallet
- [myqrlwallet-backend](https://github.com/DigitalGuards/myqrlwallet-backend) - API server
- [QuantaPool](https://github.com/DigitalGuards/QuantaPool) - Liquid staking protocol

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [QRL Project](https://www.theqrl.org/) for the quantum-resistant blockchain
- [QRL Wallet](https://qrlwallet.com) for the web wallet interface
- [Expo](https://expo.dev) for the excellent React Native tooling

## Disclaimer

This application is an independent mobile wrapper for the QRL web wallet. It is not officially affiliated with or endorsed by the QRL Foundation.

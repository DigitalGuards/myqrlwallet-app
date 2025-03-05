# MyQRL Wallet Mobile App

A mobile application that serves as a native wrapper for the [QRL Wallet website](https://qrlwallet.com), providing a seamless mobile experience for QRL cryptocurrency users.

## Features

- **WebView Integration**: Seamlessly renders qrlwallet.com within a native mobile container
- **Biometric Authentication**: Optional Face ID / Touch ID / Fingerprint protection (device-dependent)
- **Session Management**: Maintains wallet sessions with proper caching and security
- **Native Mobile UX**: Enhanced user experience with native navigation and transitions
- **Offline Capability**: Access cached wallet data even without internet connection
- **Modern UI**: Clean and intuitive interface designed specifically for mobile devices

## Architecture

The application follows a modular architecture with these key components:

1. **WebView Component**: Core component that renders the QRL Wallet website with enhanced mobile capabilities
2. **Session Management Service**: Handles persistent storage and caching of wallet data
3. **Biometric Authentication Service**: Provides device-level security for accessing wallet data
4. **Navigation System**: Offers intuitive tab-based navigation between main screens

## Technical Stack

- **Framework**: React Native / Expo
- **State Management**: React Hooks
- **Navigation**: Expo Router
- **Storage**: AsyncStorage for secure persistent data
- **Authentication**: Expo Local Authentication for biometrics
- **UI Components**: Native components with custom styling

## Getting Started

### Prerequisites

- Node.js (v14 or newer)
- npm or yarn
- Expo CLI

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/myqrlwalletapp.git
   cd myqrlwalletapp
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Run on a device or emulator:
   ```
   npm run android
   npm run ios  # Requires macOS for iOS development
   ```

## Development

### Project Structure

```
myqrlwallet/
├── app/                   # App screens and navigation
│   ├── (tabs)/            # Tab-based screens
│   │   ├── index.tsx      # Main wallet screen
│   │   ├── settings.tsx   # Settings screen
│   │   ├── about.tsx      # About screen
│   │   └── _layout.tsx    # Tab navigation layout
│   └── _layout.tsx        # Root layout
├── components/            # Reusable UI components
│   ├── QRLWebView.tsx     # Core WebView component
│   └── Themed.tsx         # Theme-aware components
├── constants/             # App constants and configuration
│   └── Colors.ts          # Theme colors
├── services/              # Business logic services
│   ├── WebViewService.ts  # WebView session management
│   └── BiometricService.ts # Biometric authentication handling
└── assets/                # Static assets (images, fonts)
```

### WebView Implementation

The QRL Wallet WebView is implemented with enhanced features:

```typescript
// Core WebView with security features
<WebView
  source={{ uri: 'https://qrlwallet.com' }}
  originWhitelist={['https://*']}
  javaScriptEnabled={true}
  domStorageEnabled={true}
  sharedCookiesEnabled={true}
  cacheEnabled={true}
  // ... additional security configs
/>
```

### Extending the App

The app is designed to be extensible. To add new features:

1. Create new service modules in the `services/` directory
2. Add new screens in the appropriate directory under `app/`
3. Extend existing components or create new ones in `components/`

## Security Considerations

- The WebView is configured with strict security settings
- User data is stored in secure AsyncStorage
- Biometric authentication provides device-level security
- All network requests are made through HTTPS

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [QRL Project](https://www.theqrl.org/) for creating the QRL blockchain
- [QRL Wallet](https://qrlwallet.com) for the web wallet interface

## Disclaimer

This application is not officially affiliated with or endorsed by the QRL Team. It is an independent mobile wrapper for the QRL web wallet.

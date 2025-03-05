# MyQRL Wallet Mobile App

A mobile application that serves as a native wrapper for the [QRL Wallet website](https://qrlwallet.com), providing a seamless mobile experience for QRL cryptocurrency users.

## Features

- **WebView Integration**: Seamlessly renders qrlwallet.com within a native mobile container
- **Biometric Authentication**: Optional Face ID / Touch ID / Fingerprint protection (device-dependent)
- **Session Management**: Maintains wallet sessions with proper caching and security
- **Native Mobile UX**: Enhanced user experience with native navigation and transitions
- **Offline Capability**: Access cached wallet data even without internet connection
- **Modern UI**: Clean and intuitive interface designed specifically for mobile devices
- **Optimized Scrolling**: Enhanced scrolling experience in the WebView component

## Architecture

The application follows a modular architecture with these key components:

1. **WebView Component**: Core component that renders the QRL Wallet website with enhanced mobile capabilities
2. **Session Management Service**: Handles persistent storage and caching of wallet data
3. **Biometric Authentication Service**: Provides device-level security for accessing wallet data
4. **Navigation System**: Offers intuitive tab-based navigation between main screens
5. **UI Components**: Reusable themed components with animations and haptic feedback

## Technical Stack

- **Framework**: React Native / Expo (v52+)
- **State Management**: React Hooks
- **Navigation**: Expo Router (v4+)
- **Storage**: AsyncStorage for secure persistent data
- **Authentication**: Expo Local Authentication for biometrics
- **UI Components**: Native components with custom styling
- **Animations**: React Native Reanimated
- **Gestures**: React Native Gesture Handler
- **Visual Effects**: Expo Blur, Haptics

## Getting Started

### Prerequisites

- Node.js (v14 or newer)
- npm or yarn
- Expo CLI

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/DigitalGuards/myqrlwallet.git
   cd myqrlwallet
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
│   │   ├── explore.tsx    # Explore screen
│   │   └── _layout.tsx    # Tab navigation layout
│   ├── _layout.tsx        # Root layout
│   └── +not-found.tsx     # Error page
├── components/            # Reusable UI components
│   ├── QRLWebView.tsx     # Core WebView component with enhanced scrolling
│   ├── Themed.tsx         # Theme-aware components
│   ├── ExternalLink.tsx   # External link handler
│   ├── Collapsible.tsx    # Collapsible section component
│   ├── HapticTab.tsx      # Tab with haptic feedback
│   ├── HelloWave.tsx      # Animated wave component
│   ├── ParallaxScrollView.tsx # Scrollview with parallax effect
│   ├── ThemedText.tsx     # Text with theming support
│   ├── ThemedView.tsx     # View with theming support
│   └── ui/                # UI helper components
├── constants/             # App constants and configuration
│   └── Colors.ts          # Theme colors
├── services/              # Business logic services
│   ├── WebViewService.ts  # WebView session management
│   └── BiometricService.ts # Biometric authentication handling
├── assets/                # Static assets (images, fonts)
├── hooks/                 # Custom React hooks
└── scripts/               # Build and utility scripts
```

### WebView Implementation

The QRL Wallet WebView is implemented with enhanced features for an optimal mobile experience:

```typescript
// Core WebView with security features and enhanced scrolling
<WebView
  ref={webViewRef}
  source={{ uri: 'https://qrlwallet.com' }}
  style={styles.webView}
  originWhitelist={['https://*']}
  userAgent={customUserAgent}
  javaScriptEnabled={true}
  domStorageEnabled={true}
  scalesPageToFit={true}
  scrollEnabled={true}
  decelerationRate={Platform.OS === 'ios' ? 'normal' : 0.985}
  automaticallyAdjustContentInsets={true}
  contentInsetAdjustmentBehavior="automatic"
  overScrollMode="always"
  showsVerticalScrollIndicator={true}
  cacheEnabled={true}
  nestedScrollEnabled={true}
  injectedJavaScript={enhancedScrollingScript}
  // ... additional configuration
/>
```

The component includes custom JavaScript injection to optimize scrolling behavior, handle errors, and provide a seamless user experience even on slower connections.

### Extending the App

The app is designed to be extensible. To add new features:

1. Create new service modules in the `services/` directory
2. Add new screens in the appropriate directory under `app/`
3. Extend existing components or create new ones in `components/`
4. Use the Themed components for consistent styling

## Security Considerations

- The WebView is configured with strict security settings
- User data is stored in secure AsyncStorage
- Biometric authentication provides device-level security
- All network requests are made through HTTPS
- Content security policies are enforced in the WebView

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [QRL Project](https://www.theqrl.org/) for creating the QRL blockchain
- [QRL Wallet](https://qrlwallet.com) for the web wallet interface

## Disclaimer

This application is not officially affiliated with or endorsed by the QRL Team. It is an independent mobile wrapper for the QRL web wallet.

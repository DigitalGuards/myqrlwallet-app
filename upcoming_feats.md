# MyQRL Wallet - Upcoming Feature Implementations

This document outlines implementation plans for two critical features in the MyQRL Wallet mobile app that require enhancement:

1. Improved Cache Clearing Functionality
2. Auto-Lock with Biometric Authentication

## 1. Cache Clearing Functionality

### Current Issues
- The existing cache clearing functionality only removes cookies and session timestamp from AsyncStorage
- WebView internal cache, local storage, IndexedDB, and other web storage remain intact
- No reload mechanism after clearing cache
- This results in users remaining logged in after cache clear

### Implementation Plan

#### 1.1 Enhance the WebViewService

```typescript
// services/WebViewService.ts

// 1. Add a WebView reference to the service
private webViewRef: React.RefObject<WebView> | null = null;

// 2. Add a method to set the WebView reference
setWebViewRef(ref: React.RefObject<WebView>): void {
  this.webViewRef = ref;
}

// 3. Enhance the clearSessionData method
async clearSessionData(): Promise<void> {
  try {
    // Clear AsyncStorage items
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.COOKIES,
      STORAGE_KEYS.LAST_SESSION,
    ]);
    
    // Clear WebView cache if reference exists
    if (this.webViewRef?.current) {
      // A. Clear WebView cache (requires custom JavaScriptInterface for Android)
      if (Platform.OS === 'android') {
        this.webViewRef.current.injectJavaScript(`
          if (window.ReactNativeWebView.clearCache) {
            window.ReactNativeWebView.clearCache();
          }
          true;
        `);
      }
      
      // B. Clear local storage, session storage, and cookies
      const clearStorageScript = `
        localStorage.clear();
        sessionStorage.clear();
        
        // Clear cookies by setting expired date
        document.cookie.split(';').forEach(function(c) {
          document.cookie = c.trim().split('=')[0] + '=;' +
          'expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
        });
        
        // Clear IndexedDB
        if (window.indexedDB) {
          const databases = await window.indexedDB.databases();
          databases.forEach(db => {
            window.indexedDB.deleteDatabase(db.name);
          });
        }
        
        // Signal completion
        window.ReactNativeWebView.postMessage('CACHE_CLEARED');
        true;
      `;
      this.webViewRef.current.injectJavaScript(clearStorageScript);
    }
    
    console.log('Session data cleared successfully');
    return true;
  } catch (error) {
    console.error('Failed to clear session data:', error);
    return false;
  }
}
```

#### 1.2 Update QRLWebView Component

```typescript
// components/QRLWebView.tsx

// 1. Add props to accept reload signal
interface QRLWebViewProps {
  uri?: string;
  userAgent?: string;
  shouldReload?: boolean;
  onReloadComplete?: () => void;
}

// 2. Pass WebView reference to service at mount time
useEffect(() => {
  if (webViewRef.current) {
    WebViewService.setWebViewRef(webViewRef);
  }
}, []);

// 3. Add effect to handle reload signal
useEffect(() => {
  if (shouldReload && webViewRef.current) {
    // Force reload with cache disabled
    const reloadUrl = uri.includes('?') ? `${uri}&nocache=${Date.now()}` : `${uri}?nocache=${Date.now()}`;
    webViewRef.current.injectJavaScript(`
      window.location.href = "${reloadUrl}";
      true;
    `);
    
    // Notify parent component when reload is complete
    if (onReloadComplete) {
      onReloadComplete();
    }
  }
}, [shouldReload, uri]);

// 4. Add message handler for cache clearing
const handleMessage = (event: any) => {
  const { data } = event.nativeEvent;
  
  if (data === 'CACHE_CLEARED') {
    console.log('Cache cleared message received');
    
    // Reload the WebView
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
  } else if (data === 'PAGE_LOADED') {
    // ... existing code
  }
};
```

#### 1.3 Update Settings Screen

```typescript
// app/(tabs)/settings.tsx

// Update the clearCache function
const clearCache = async () => {
  const [shouldReload, setShouldReload] = useState(false);
  
  Alert.alert(
    'Clear Cache',
    'This will clear all stored wallet data from the app. You will need to log in again. Continue?',
    [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Clear', 
        style: 'destructive',
        onPress: async () => {
          const result = await WebViewService.clearSessionData();
          
          if (result) {
            // Set reload signal
            setShouldReload(true);
            
            Alert.alert('Cache Cleared', 'All cached data has been cleared. The wallet will now reload.');
            
            // Navigate back to wallet
            setTimeout(() => {
              router.push('/');
            }, 1500);
          } else {
            Alert.alert('Error', 'Failed to clear cache. Please try again.');
          }
        }
      }
    ]
  );
};
```

#### 1.4 Update Main Wallet Screen

```typescript
// app/(tabs)/index.tsx

// Add state for WebView reload
const [shouldReloadWebView, setShouldReloadWebView] = useState(false);

// Add handler for reload completion
const handleReloadComplete = () => {
  setShouldReloadWebView(false);
};

// Pass reload state to QRLWebView
return (
  <RNView style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor="#0A0A17" />
    {isAuthorized && (
      <>
        <QRLWebView 
          shouldReload={shouldReloadWebView} 
          onReloadComplete={handleReloadComplete}
        />
        {/* ... existing code */}
      </>
    )}
  </RNView>
);
```

#### 1.5 Add Native Modules for Deep Cache Clearing

Create platform-specific modules to enhance cache clearing functionality:

```java
// android/app/src/main/java/com/myqrlwallet/WebViewCacheModule.java
public class WebViewCacheModule extends ReactContextBaseJavaModule {
  @ReactMethod
  public void clearCache() {
    Activity activity = getCurrentActivity();
    if (activity != null) {
      activity.runOnUiThread(() -> {
        WebView.clearCache(true);
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
      });
    }
  }
}
```

```swift
// ios/MyQRLWallet/WebViewCacheModule.swift
@objc(WebViewCacheModule)
class WebViewCacheModule: NSObject {
  @objc
  func clearCache() {
    DispatchQueue.main.async {
      WKWebsiteDataStore.default().removeData(
        ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
        modifiedSince: Date(timeIntervalSince1970: 0),
        completionHandler: {}
      )
    }
  }
}
```

### Testing Plan

1. **Preparation Tests**:
   - Login to wallet and verify session persistence after app restart
   - Create test wallets or transactions to verify state

2. **Cache Clearing Tests**:
   - Clear cache while logged in, verify redirect to login screen
   - Check localStorage and sessionStorage values before and after clearing
   - Verify cookies are properly removed
   - Test on both iOS and Android platforms

3. **Edge Cases**:
   - Test with slow network connections
   - Test with failed network conditions
   - Repeatedly clear cache in quick succession

## 2. Auto-Lock with Biometric Authentication

### Current Issues
- Auto-lock setting exists in UI but has no actual implementation
- No inactivity detection is implemented
- No re-authentication is triggered after inactivity period

### Implementation Plan

#### 2.1 Create an Application Activity Monitor Service

```typescript
// services/ActivityMonitorService.ts
import { AppState, AppStateStatus } from 'react-native';
import WebViewService from './WebViewService';

interface LockConfig {
  isEnabled: boolean;
  timeoutMinutes: number;
}

class ActivityMonitorService {
  private lastActivityTimestamp: number = Date.now();
  private appState: AppStateStatus = AppState.currentState;
  private lockTimeoutId: NodeJS.Timeout | null = null;
  private lockConfig: LockConfig = { isEnabled: true, timeoutMinutes: 5 };
  private lockCallback: (() => void) | null = null;
  
  constructor() {
    // Initialize with preferences
    this.initializeFromPreferences();
    
    // Subscribe to AppState changes
    AppState.addEventListener('change', this.handleAppStateChange);
  }
  
  /**
   * Load lock settings from user preferences
   */
  private async initializeFromPreferences(): Promise<void> {
    try {
      const preferences = await WebViewService.getUserPreferences();
      this.lockConfig = {
        isEnabled: preferences.autoLock ?? true,
        timeoutMinutes: preferences.lockTimeoutMinutes ?? 5
      };
    } catch (error) {
      console.error('Failed to initialize activity monitor:', error);
    }
  }
  
  /**
   * Update the lock configuration
   */
  public updateLockConfig(config: Partial<LockConfig>): void {
    this.lockConfig = { ...this.lockConfig, ...config };
    
    // If lock timeout is active, reset it with new duration
    if (this.lockTimeoutId) {
      this.resetLockTimeout();
    }
  }
  
  /**
   * Set the callback to be called when the app should lock
   */
  public setLockCallback(callback: () => void): void {
    this.lockCallback = callback;
  }
  
  /**
   * Handle app state changes
   */
  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    // App coming to foreground from background or inactive
    if (
      (this.appState === 'background' || this.appState === 'inactive') && 
      nextAppState === 'active'
    ) {
      // Check if we should lock based on elapsed time
      const now = Date.now();
      const elapsedMinutes = (now - this.lastActivityTimestamp) / (1000 * 60);
      
      if (
        this.lockConfig.isEnabled && 
        elapsedMinutes >= this.lockConfig.timeoutMinutes &&
        this.lockCallback
      ) {
        // Execute lock callback
        this.lockCallback();
      } else {
        // Just reset the activity timestamp if we're not locking
        this.updateActivity();
      }
    } 
    // App going to background
    else if (
      this.appState === 'active' && 
      (nextAppState === 'background' || nextAppState === 'inactive')
    ) {
      // Clear any existing timeout
      if (this.lockTimeoutId) {
        clearTimeout(this.lockTimeoutId);
        this.lockTimeoutId = null;
      }
    }
    
    this.appState = nextAppState;
  };
  
  /**
   * Update the activity timestamp and reset the lock timeout
   */
  public updateActivity(): void {
    this.lastActivityTimestamp = Date.now();
    this.resetLockTimeout();
  }
  
  /**
   * Reset the lock timeout based on current config
   */
  private resetLockTimeout(): void {
    // Clear existing timeout if any
    if (this.lockTimeoutId) {
      clearTimeout(this.lockTimeoutId);
      this.lockTimeoutId = null;
    }
    
    // Only set a new timeout if auto-lock is enabled and app is active
    if (this.lockConfig.isEnabled && this.appState === 'active') {
      this.lockTimeoutId = setTimeout(() => {
        if (this.lockCallback) {
          this.lockCallback();
        }
      }, this.lockConfig.timeoutMinutes * 60 * 1000);
    }
  }
  
  /**
   * Cleanup on service destruction
   */
  public cleanup(): void {
    AppState.removeEventListener('change', this.handleAppStateChange);
    
    if (this.lockTimeoutId) {
      clearTimeout(this.lockTimeoutId);
      this.lockTimeoutId = null;
    }
  }
}

export default new ActivityMonitorService();
```

#### 2.2 Enhance the Settings Screen

```typescript
// app/(tabs)/settings.tsx

// Update the auto-lock toggle handler
const handleAutoLockToggle = async (value: boolean) => {
  updatePreference('autoLock', value);
  
  // Update ActivityMonitorService config
  ActivityMonitorService.updateLockConfig({
    isEnabled: value
  });
};

// Add a timeout picker for auto-lock
const timeoutOptions = [1, 2, 5, 10, 15, 30, 60];

// Add a new component for timeout selection
{preferences.autoLock && (
  <View style={styles.settingRow}>
    <View style={styles.settingTextContainer}>
      <Text style={styles.settingTitle}>Auto-lock Timeout</Text>
      <Text style={styles.settingDescription}>
        Lock the app after this many minutes of inactivity
      </Text>
    </View>
    <View style={styles.pickerContainer}>
      <Picker
        selectedValue={preferences.lockTimeoutMinutes}
        style={styles.picker}
        onValueChange={(itemValue) => {
          updatePreference('lockTimeoutMinutes', itemValue);
          ActivityMonitorService.updateLockConfig({
            timeoutMinutes: itemValue
          });
        }}
      >
        {timeoutOptions.map((minutes) => (
          <Picker.Item 
            key={minutes} 
            label={`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`} 
            value={minutes} 
          />
        ))}
      </Picker>
    </View>
  </View>
)}
```

#### 2.3 Implement User Interaction Tracking in QRLWebView

```typescript
// components/QRLWebView.tsx

// 1. Add touch handlers to track user activity
<WebView
  // ... existing props
  onTouchStart={() => ActivityMonitorService.updateActivity()}
  onScrollBegin={() => ActivityMonitorService.updateActivity()}
  
  // Also inject JavaScript to track interactions in the WebView
  injectedJavaScript={`
    // Track user interactions within the WebView
    function notifyActivityToReactNative() {
      window.ReactNativeWebView.postMessage('USER_ACTIVITY');
      return true;
    }
    
    // Add event listeners for user interactions
    document.addEventListener('touchstart', notifyActivityToReactNative);
    document.addEventListener('mousedown', notifyActivityToReactNative);
    document.addEventListener('keydown', notifyActivityToReactNative);
    document.addEventListener('scroll', notifyActivityToReactNative);
    
    // Execute once to signal initial load
    true;
  `}
/>

// 2. Update the message handler to detect activity
const handleMessage = (event: any) => {
  const { data } = event.nativeEvent;
  
  if (data === 'USER_ACTIVITY') {
    ActivityMonitorService.updateActivity();
  } 
  // ... existing message handling code
};
```

#### 2.4 Update the Main Wallet Screen

```typescript
// app/(tabs)/index.tsx

// Add lock state management
const [isLocked, setIsLocked] = useState(false);

// Setup activity monitor on component mount
useEffect(() => {
  // Set up lock callback
  ActivityMonitorService.setLockCallback(() => {
    console.log('Auto-lock triggered');
    setIsAuthorized(false);
    setIsLocked(true);
  });
  
  // Update activity on initial mount
  ActivityMonitorService.updateActivity();
  
  // Clean up on unmount
  return () => {
    ActivityMonitorService.cleanup();
  };
}, []);

// Modify the authentication check
useEffect(() => {
  async function authCheck() {
    setIsLoading(true);

    try {
      const preferences = await WebViewService.getUserPreferences();
      
      // Update the activity monitor with current preferences
      ActivityMonitorService.updateLockConfig({
        isEnabled: preferences.autoLock ?? true,
        timeoutMinutes: preferences.lockTimeoutMinutes ?? 5
      });
      
      // Require authentication if biometrics enabled or app is locked
      if (preferences.biometricEnabled || isLocked) {
        const biometricAvailable = await BiometricService.isBiometricAvailable();
        
        if (biometricAvailable) {
          let promptMessage = 'Authenticate to access your wallet';
          if (isLocked) {
            promptMessage = 'Session timed out. Authenticate to continue';
          }
          
          const authResult = await BiometricService.authenticate(promptMessage);
          setIsAuthorized(authResult.success);
          
          if (authResult.success) {
            // Reset lock state if authentication successful
            setIsLocked(false);
            ActivityMonitorService.updateActivity();
          }
        } else {
          // Fallback if biometrics unavailable
          setIsAuthorized(true);
          setIsLocked(false);
        }
      } else {
        setIsAuthorized(true);
      }
    } catch (error) {
      console.error('Authentication error:', error);
      setIsAuthorized(true); // Fallback on error
    } finally {
      setIsLoading(false);
    }
  }

  // Run auth check when screen is focused or lock state changes
  if (isFocused) {
    authCheck();
  }
}, [isFocused, isLocked]);

// Add activity monitoring for tab focus changes
useEffect(() => {
  if (isFocused && isAuthorized) {
    // Update activity timestamp when tab is focused
    ActivityMonitorService.updateActivity();
    WebViewService.updateLastSession();
  }
}, [isFocused, isAuthorized]);
```

#### 2.5 Add a Lock Screen Component (Optional Enhancement)

```typescript
// components/LockScreen.tsx
import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import BiometricService from '../services/BiometricService';
import FontAwesome from '@expo/vector-icons/FontAwesome';

interface LockScreenProps {
  onUnlock: () => void;
}

const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const handleUnlock = async () => {
    const result = await BiometricService.authenticate('Authenticate to access your wallet');
    if (result.success) {
      onUnlock();
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/images/icon.png')}
        style={styles.logo}
      />
      <Text style={styles.title}>Session Locked</Text>
      <Text style={styles.subtitle}>Your session was locked due to inactivity</Text>
      
      <TouchableOpacity style={styles.unlockButton} onPress={handleUnlock}>
        <FontAwesome name="lock" size={24} color="#fff" style={styles.icon} />
        <Text style={styles.buttonText}>Unlock</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A17',
    padding: 20,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 40,
  },
  unlockButton: {
    flexDirection: 'row',
    backgroundColor: '#5e35b1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default LockScreen;
```

#### 2.6. Update Main Wallet Screen with Lock Screen

```typescript
// app/(tabs)/index.tsx

// In the render method
return (
  <RNView style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor="#0A0A17" />
    {isAuthorized ? (
      <>
        <QRLWebView 
          shouldReload={shouldReloadWebView} 
          onReloadComplete={handleReloadComplete}
        />
        <TouchableOpacity 
          style={styles.settingsButton} 
          onPress={navigateToSettings}
          activeOpacity={0.7}
        >
          <FontAwesome name="gear" size={24} color="white" />
        </TouchableOpacity>
      </>
    ) : isLocked ? (
      <LockScreen onUnlock={() => {
        setIsAuthorized(true);
        setIsLocked(false);
        ActivityMonitorService.updateActivity();
      }} />
    ) : (
      // Show loading or initial authentication UI
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#5e35b1" />
      </View>
    )}
  </RNView>
);
```

### Testing Plan

1. **Functionality Tests**:
   - Verify auto-lock triggers after specified timeout period (test with short timeout)
   - Verify biometric prompt appears when returning after timeout
   - Test switching between auto-lock enabled/disabled states
   - Test different timeout values and verify they work correctly

2. **Background/Foreground Tests**:
   - Put app in background, wait longer than timeout, verify lock on return
   - Test lock behavior with different app state transitions

3. **User Activity Tests**:
   - Verify continuous interaction prevents auto-lock
   - Test interaction inside WebView updates activity timestamp
   - Test edge cases like minimal movement/interaction

4. **Platform-Specific Tests**:
   - Test on different iOS and Android versions
   - Test with different biometric hardware (fingerprint, Face ID)
   - Test with devices that lack biometric capabilities

5. **Integration Tests**:
   - Verify settings changes immediately affect lock behavior
   - Test lock with network connectivity issues
   - Test auto-lock during active wallet operations

## Implementation Timeline

### Phase 1: Cache Clearing (2 weeks)
- Week 1: Implement WebViewService enhancements and QRLWebView updates
- Week 2: Add native modules and test on both platforms

### Phase 2: Auto-Lock (3 weeks)
- Week 1: Implement ActivityMonitorService and integration with existing components
- Week 2: Add lock screen component and update main wallet screen
- Week 3: Testing and refinements

## Future Enhancements

1. **Cache Management**:
   - Selective cache clearing options (clear wallets, transactions, etc.)
   - Background cache cleanup for unused data

2. **Security**:
   - PIN code fallback option when biometrics unavailable
   - Progressive security (increased requirements for larger transactions)
   - Session timeouts for specific actions (require re-auth for transactions) 
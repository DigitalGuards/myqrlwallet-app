declare module 'react-native-screenshot-prevent' {
  interface RNScreenshotPrevent {
    /**
     * Enable or disable screenshot prevention
     * @param enabled - Whether to enable screenshot prevention
     */
    enabled(enabled: boolean): void;

    /**
     * Enable secure view on iOS (prevents screen capture)
     */
    enableSecureView(): void;

    /**
     * Disable secure view on iOS
     */
    disableSecureView(): void;
  }

  const screenshotPrevent: RNScreenshotPrevent;
  export default screenshotPrevent;
}

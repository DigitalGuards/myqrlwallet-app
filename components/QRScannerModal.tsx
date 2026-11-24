import { t } from '../i18n';
import { useNativeLanguage } from '../i18n/useNativeLanguage';
import { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Platform,
  Linking,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { nativePalettes } from '../constants/Theme';
import { createThemedStyles, usePalette, useResolvedTheme } from '../theme/useAppTheme';

interface QRScannerModalProps {
  visible: boolean;
  onScan: (data: string) => void;
  onClose: () => void;
}

/**
 * Modal component for scanning QR codes using the device camera.
 * Used for scanning QRL wallet addresses on the Transfer page.
 */
export default function QRScannerModal({ visible, onScan, onClose }: QRScannerModalProps) {
  useNativeLanguage();
  const palette = usePalette();
  const resolvedTheme = useResolvedTheme();
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  // Synchronous lock: state updates are async, so without a ref the camera
  // fires onBarcodeScanned many times for the same code before React can
  // re-render with scanned=true and swap the prop to undefined.
  const scanLock = useRef(false);

  // Reset before rendering the camera for a new opening.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setScanned(false);
  }

  useEffect(() => {
    if (visible) {
      scanLock.current = false;
    }
  }, [visible]);

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    if (scanLock.current) return;
    scanLock.current = true;

    setScanned(true);
    const data = result.data;

    // Pass the scanned data to parent
    onScan(data);
    onClose();
  };

  const showsCamera = permission?.granted === true;

  const renderContent = () => {
    // Permission not yet determined
    if (!permission) {
      return (
        <View style={styles.centeredContent}>
          <Text style={styles.text}>{t('scanner.requesting')}</Text>
        </View>
      );
    }

    // Permission denied
    if (!permission.granted) {
      return (
        <View style={styles.centeredContent}>
          <Ionicons name="camera-outline" size={64} color={palette.primary} />
          {permission.canAskAgain ? (
            <>
              <Text style={styles.text}>
                {t('scanner.prePermission')}
              </Text>
              <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                <Text style={styles.permissionButtonText}>{t('common.continue')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.text}>
                {t('scanner.permissionOff')}
              </Text>
              <TouchableOpacity
                style={styles.permissionButton}
                onPress={() => {
                  void Linking.openSettings();
                }}
              >
                <Text style={styles.permissionButtonText}>{t('common.openSettings')}</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Permission granted - show camera. CameraView does not support children:
    // the native preview covers them once it starts, so the overlay and the
    // close button are siblings drawn on top of the camera.
    return (
      <View style={StyleSheet.absoluteFill}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />

        {/* Scanner overlay */}
        <View style={styles.overlay} pointerEvents="none">
          {/* Top dark area */}
          <View style={styles.overlayRow} />

          {/* Middle row with scanner window */}
          <View style={styles.middleRow}>
            <View style={styles.overlayColumn} />
            <View style={styles.scannerWindow}>
              {/* Corner markers */}
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <View style={styles.overlayColumn} />
          </View>

          {/* Bottom dark area with instructions */}
          <View style={styles.overlayRow}>
            <Text style={styles.instructionText}>
              {t('scanner.point')}
            </Text>
          </View>
        </View>

        {/* Close button */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('scanner.close')}
        >
          <Ionicons name="close" size={32} color="#ffffff" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* The camera view is always on black with a dark scrim, whatever the theme:
          the viewfinder chrome sits over live video. Only the permission screens
          follow the theme. */}
      <StatusBar
        barStyle={showsCamera || resolvedTheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={showsCamera ? '#000000' : palette.background}
      />
      <View style={[styles.container, !showsCamera && { backgroundColor: palette.background }]}>
        {renderContent()}
      </View>
    </Modal>
  );
}

const SCANNER_SIZE = 280;
const CORNER_SIZE = 40;
const CORNER_WIDTH = 4;

const useStyles = createThemedStyles((p) => {
  const dark = p === nativePalettes.dark;
  return {
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  text: {
    color: p.foreground,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: p.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginBottom: 12,
  },
  permissionButtonText: {
    color: p.primaryForeground,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  cancelButtonText: {
    color: dark ? '#8B959C' : p.mutedForeground,
    fontSize: 16,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  overlayRow: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  middleRow: {
    flexDirection: 'row',
    height: SCANNER_SIZE,
  },
  overlayColumn: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scannerWindow: {
    width: SCANNER_SIZE,
    height: SCANNER_SIZE,
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#33ADE6',
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#33ADE6',
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#33ADE6',
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#33ADE6',
  },
  instructionText: {
    color: '#F2F5F8',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 32,
  },
  closeButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  };
});

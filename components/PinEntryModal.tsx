import type { NativeKey } from '../i18n/nativeMessage';
import { t } from '../i18n';
import { useNativeLanguage } from '../i18n/useNativeLanguage';
import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  type TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PinBoxInput, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from './PinBoxInput';
import type { NativePalette } from '../constants/Theme';
import { createThemed, createThemedStyles } from '../theme/useAppTheme';

// Colours come from the theme tables (constants/Theme.ts), as in the web wallet.
function colorsFor(p: NativePalette) {
  return {
    overlay: p.scrim,
    card: p.card,
    input: p.elevated,
    divider: p.border,
    textPrimary: p.foreground,
    textSecondary: p.mutedForeground,
    textTertiary: p.tertiary,
    brandBlue: p.primary,
    brandBlueForeground: p.primaryForeground,
    red: p.destructive,
    disabledPrimary: p.disabledPrimary,
  };
}
const useC = createThemed(colorsFor);

interface PinEntryModalProps {
  visible: boolean;
  title: string;
  message?: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

/**
 * Secure PIN entry modal - replaces Alert.prompt for sensitive input.
 * Uses the segmented PIN boxes shared with the web wallet's PIN setup UX.
 */
export const PinEntryModal: React.FC<PinEntryModalProps> = ({
  visible,
  title,
  message,
  onSubmit,
  onCancel,
}) => {
  useNativeLanguage();
  const C = useC();
  const styles = useStyles();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<NativeKey | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [previousVisible, setPreviousVisible] = useState(visible);

  if (visible !== previousVisible) {
    setPreviousVisible(visible);
    if (visible) {
      setPin('');
      setError(null);
    }
  }

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visible]);

  const handleSubmit = () => {
    if (pin.length < PIN_MIN_LENGTH) {
      setError('pin.minimum');
      return;
    }
    onSubmit(pin);
  };

  const handleCancel = () => {
    setPin('');
    setError(null);
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.card}>
          <View style={styles.tileWrap}>
            <View style={styles.tile}>
              <Ionicons name="keypad" size={22} color={C.brandBlueForeground} />
            </View>
          </View>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <PinBoxInput
            value={pin}
            onChangeText={(v) => {
              setPin(v);
              setError(null);
            }}
            helper={t('pin.helper', { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH })}
            inputRef={inputRef}
            accessibilityLabel={t('pin.walletPin')}
            onSubmitEditing={handleSubmit}
          />

          {error ? <Text style={styles.error}>{t(error, { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH })}</Text> : null}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                styles.submitButton,
                pin.length < PIN_MIN_LENGTH && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              activeOpacity={0.8}
              disabled={pin.length < PIN_MIN_LENGTH}
            >
              <Text
                style={[
                  styles.submitButtonText,
                  pin.length < PIN_MIN_LENGTH && styles.submitButtonTextDisabled,
                ]}
              >
                {t('common.confirm')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const useStyles = createThemedStyles((p) => {
  const C = colorsFor(p);
  return {
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 22,
    width: '100%',
    maxWidth: 340,
  },
  tileWrap: {
    alignItems: 'center',
    marginBottom: 14,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: C.brandBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: C.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  message: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  error: {
    color: C.red,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: C.input,
  },
  submitButton: {
    backgroundColor: C.brandBlue,
  },
  submitButtonDisabled: {
    backgroundColor: C.disabledPrimary,
    opacity: 0.6,
  },
  cancelButtonText: {
    color: C.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  submitButtonText: {
    color: C.brandBlueForeground,
    fontSize: 16,
    fontWeight: '700',
  },
  submitButtonTextDisabled: {
    color: C.textTertiary,
  },
  };
});

export default PinEntryModal;

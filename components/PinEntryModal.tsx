import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 6;

const C = {
  overlay: 'rgba(0, 0, 0, 0.7)',
  card: '#1e293b',
  input: '#273548',
  inputFocus: '#334155',
  divider: '#334155',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  brandOrange: '#ff8700',
  red: '#ef4444',
};

interface PinEntryModalProps {
  visible: boolean;
  title: string;
  message?: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

/**
 * Secure PIN entry modal - replaces Alert.prompt for sensitive input.
 * secureTextEntry masks PIN digits.
 */
export const PinEntryModal: React.FC<PinEntryModalProps> = ({
  visible,
  title,
  message,
  onSubmit,
  onCancel,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setPin('');
      setError(null);
      const timer = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleSubmit = () => {
    if (pin.length < PIN_MIN_LENGTH) {
      setError(`PIN must be at least ${PIN_MIN_LENGTH} digits`);
      return;
    }
    if (pin.length > PIN_MAX_LENGTH) {
      setError(`PIN must be at most ${PIN_MAX_LENGTH} digits`);
      return;
    }
    if (!/^\d+$/.test(pin)) {
      setError('PIN must contain only numbers');
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
              <Ionicons name="keypad" size={22} color="#ffffff" />
            </View>
          </View>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <TextInput
            ref={inputRef}
            style={styles.input}
            value={pin}
            onChangeText={(text) => {
              setPin(text.replace(/[^0-9]/g, '').slice(0, PIN_MAX_LENGTH));
              setError(null);
            }}
            placeholder={`${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`}
            placeholderTextColor={C.textTertiary}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={PIN_MAX_LENGTH}
            autoComplete="off"
            autoCorrect={false}
            textContentType="none"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.submitButton]}
              onPress={handleSubmit}
              activeOpacity={0.8}
            >
              <Text style={styles.submitButtonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: C.brandOrange,
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
  input: {
    backgroundColor: C.input,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 18,
    fontWeight: '600',
    color: C.textPrimary,
    textAlign: 'center',
    letterSpacing: 6,
    marginBottom: 4,
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
    backgroundColor: C.brandOrange,
  },
  cancelButtonText: {
    color: C.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default PinEntryModal;

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
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PinBoxInput, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from './PinBoxInput';

const C = {
  overlay: 'rgba(0, 0, 0, 0.7)',
  card: '#1e293b',
  input: '#273548',
  divider: '#334155',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  brandOrange: '#ff8700',
  red: '#ef4444',
};

interface ChangePinModalProps {
  visible: boolean;
  onSubmit: (currentPin: string, newPin: string) => void;
  onCancel: () => void;
}

interface PinFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  inputRef: React.RefObject<TextInput | null>;
  onFilled?: () => void;
  onSubmitEditing?: () => void;
}

function PinField({ label, value, onChangeText, inputRef, onFilled, onSubmitEditing }: PinFieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <PinBoxInput
        value={value}
        onChangeText={onChangeText}
        inputRef={inputRef}
        accessibilityLabel={label}
        onFilled={onFilled}
        onSubmitEditing={onSubmitEditing}
      />
    </View>
  );
}

export const ChangePinModal: React.FC<ChangePinModalProps> = ({ visible, onSubmit, onCancel }) => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currentPinRef = useRef<TextInput>(null);
  const newPinRef = useRef<TextInput>(null);
  const confirmPinRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setError(null);
      const timerId = setTimeout(() => currentPinRef.current?.focus(), 120);
      return () => clearTimeout(timerId);
    }
  }, [visible]);

  const isValidPin = (pin: string): boolean =>
    pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH && /^\d+$/.test(pin);

  const isFormValid = (): boolean =>
    isValidPin(currentPin) &&
    isValidPin(newPin) &&
    isValidPin(confirmPin) &&
    newPin === confirmPin &&
    newPin !== currentPin;

  const handlePinChange = (text: string, setter: (value: string) => void) => {
    setter(text);
    setError(null);
  };

  const handleSubmit = () => {
    if (!isValidPin(currentPin)) {
      setError(`Current PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
      currentPinRef.current?.focus();
      return;
    }
    if (!isValidPin(newPin)) {
      setError(`New PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
      newPinRef.current?.focus();
      return;
    }
    if (newPin !== confirmPin) {
      setError('New PINs do not match');
      confirmPinRef.current?.focus();
      return;
    }
    if (newPin === currentPin) {
      setError('New PIN must be different from current PIN');
      newPinRef.current?.focus();
      return;
    }
    onSubmit(currentPin, newPin);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.tileWrap}>
              <View style={styles.tile}>
                <Ionicons name="keypad" size={22} color="#ffffff" />
              </View>
            </View>
            <Text style={styles.title}>Change PIN</Text>
            <Text style={styles.message}>
              Enter your current PIN, then choose a new {PIN_MIN_LENGTH}-{PIN_MAX_LENGTH} digit
              PIN. Your seed stays encrypted with this PIN.
            </Text>

            <PinField
              label="Current PIN"
              value={currentPin}
              onChangeText={(t) => handlePinChange(t, setCurrentPin)}
              inputRef={currentPinRef}
              onFilled={() => newPinRef.current?.focus()}
              onSubmitEditing={() => newPinRef.current?.focus()}
            />

            <PinField
              label="New PIN"
              value={newPin}
              onChangeText={(t) => handlePinChange(t, setNewPin)}
              inputRef={newPinRef}
              onFilled={() => confirmPinRef.current?.focus()}
              onSubmitEditing={() => confirmPinRef.current?.focus()}
            />

            <PinField
              label="Confirm New PIN"
              value={confirmPin}
              onChangeText={(t) => handlePinChange(t, setConfirmPin)}
              inputRef={confirmPinRef}
              onSubmitEditing={handleSubmit}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={onCancel}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.submitButton,
                  !isFormValid() && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                activeOpacity={0.8}
                disabled={!isFormValid()}
              >
                <Text
                  style={[
                    styles.submitButtonText,
                    !isFormValid() && styles.submitButtonTextDisabled,
                  ]}
                >
                  Change PIN
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
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
    marginBottom: 16,
  },
  fieldWrap: {
    marginTop: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.2,
  },
  error: {
    color: C.red,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 22,
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
  submitButtonDisabled: {
    backgroundColor: '#4a3a20',
    opacity: 0.6,
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
  submitButtonTextDisabled: {
    color: C.textTertiary,
  },
});

export default ChangePinModal;

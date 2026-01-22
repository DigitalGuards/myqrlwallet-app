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

// PIN length constraints
const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 6;

interface ChangePinModalProps {
  visible: boolean;
  onSubmit: (currentPin: string, newPin: string) => void;
  onCancel: () => void;
}

/**
 * Modal for changing PIN - requires current PIN and new PIN with confirmation
 * Matches PinEntryModal styling with orange accent
 */
export const ChangePinModal: React.FC<ChangePinModalProps> = ({
  visible,
  onSubmit,
  onCancel,
}) => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currentPinRef = useRef<TextInput>(null);
  const newPinRef = useRef<TextInput>(null);
  const confirmPinRef = useRef<TextInput>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (visible) {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setError(null);
      // Focus first input with small delay
      const timerId = setTimeout(() => {
        currentPinRef.current?.focus();
      }, 100);
      return () => clearTimeout(timerId);
    }
  }, [visible]);

  const isValidPin = (pin: string): boolean => {
    return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH && /^\d+$/.test(pin);
  };

  const isFormValid = (): boolean => {
    return (
      isValidPin(currentPin) &&
      isValidPin(newPin) &&
      isValidPin(confirmPin) &&
      newPin === confirmPin &&
      newPin !== currentPin
    );
  };

  const handlePinChange = (text: string, setter: (value: string) => void) => {
    setter(text.replace(/[^0-9]/g, '').slice(0, PIN_MAX_LENGTH));
    setError(null);
  };

  const handleSubmit = () => {
    // Validate current PIN
    if (!isValidPin(currentPin)) {
      setError(`Current PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
      currentPinRef.current?.focus();
      return;
    }

    // Validate new PIN
    if (!isValidPin(newPin)) {
      setError(`New PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
      newPinRef.current?.focus();
      return;
    }

    // Check PINs match
    if (newPin !== confirmPin) {
      setError('New PINs do not match');
      confirmPinRef.current?.focus();
      return;
    }

    // Check new PIN is different
    if (newPin === currentPin) {
      setError('New PIN must be different from current PIN');
      newPinRef.current?.focus();
      return;
    }

    onSubmit(currentPin, newPin);
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            <Text style={styles.title}>Change PIN</Text>
            <Text style={styles.message}>
              Enter your current PIN and choose a new one.
            </Text>

            {/* Current PIN */}
            <Text style={styles.label}>Current PIN</Text>
            <TextInput
              ref={currentPinRef}
              style={styles.input}
              value={currentPin}
              onChangeText={(text) => handlePinChange(text, setCurrentPin)}
              placeholder={`${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`}
              placeholderTextColor="#888"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={PIN_MAX_LENGTH}
              autoComplete="off"
              autoCorrect={false}
              textContentType="none"
              returnKeyType="next"
              onSubmitEditing={() => newPinRef.current?.focus()}
            />

            {/* New PIN */}
            <Text style={styles.label}>New PIN</Text>
            <TextInput
              ref={newPinRef}
              style={styles.input}
              value={newPin}
              onChangeText={(text) => handlePinChange(text, setNewPin)}
              placeholder={`${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`}
              placeholderTextColor="#888"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={PIN_MAX_LENGTH}
              autoComplete="off"
              autoCorrect={false}
              textContentType="none"
              returnKeyType="next"
              onSubmitEditing={() => confirmPinRef.current?.focus()}
            />

            {/* Confirm New PIN */}
            <Text style={styles.label}>Confirm New PIN</Text>
            <TextInput
              ref={confirmPinRef}
              style={styles.input}
              value={confirmPin}
              onChangeText={(text) => handlePinChange(text, setConfirmPin)}
              placeholder={`${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`}
              placeholderTextColor="#888"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={PIN_MAX_LENGTH}
              autoComplete="off"
              autoCorrect={false}
              textContentType="none"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleCancel}
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 13,
    color: '#8e8e93',
    textAlign: 'center',
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#ff8700',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#2c2c2e',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 4,
  },
  error: {
    color: '#ff453a',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#2c2c2e',
  },
  submitButton: {
    backgroundColor: '#ff8700',
  },
  submitButtonDisabled: {
    backgroundColor: '#4a3a20',
    opacity: 0.6,
  },
  cancelButtonText: {
    color: '#ff8700',
    fontSize: 17,
    fontWeight: '500',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  submitButtonTextDisabled: {
    color: '#888',
  },
});

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

interface PinEntryModalProps {
  visible: boolean;
  title: string;
  message?: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

/**
 * Secure PIN entry modal - replaces Alert.prompt for sensitive input
 * Uses secureTextEntry to mask PIN digits
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

  // Focus input when modal opens
  useEffect(() => {
    if (visible) {
      setPin('');
      setError(null);
      // Small delay to ensure modal is rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [visible]);

  const handleSubmit = () => {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    if (pin.length > 6) {
      setError('PIN must be at most 6 digits');
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
        <View style={styles.container}>
          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}

          <TextInput
            ref={inputRef}
            style={styles.input}
            value={pin}
            onChangeText={(text) => {
              setPin(text.replace(/[^0-9]/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder="Enter PIN (4-6 digits)"
            placeholderTextColor="#888"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            autoComplete="off"
            autoCorrect={false}
            textContentType="none"
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
              style={[styles.button, styles.submitButton]}
              onPress={handleSubmit}
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    padding: 20,
    width: '85%',
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
  input: {
    backgroundColor: '#2c2c2e',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 4,
    marginBottom: 8,
  },
  error: {
    color: '#ff453a',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 12,
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
    backgroundColor: '#0a84ff',
  },
  cancelButtonText: {
    color: '#0a84ff',
    fontSize: 17,
    fontWeight: '500',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});

export default PinEntryModal;

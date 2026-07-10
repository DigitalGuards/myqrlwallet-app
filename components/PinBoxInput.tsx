import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

// Mirrors the web wallet's Set Transaction PIN entry (segmented boxes with
// dots) so PIN entry looks and behaves the same in native modals and in the
// WebView. Structure over pixel-parity: navy wells, slate borders, brand
// orange focus ring.
const C = {
  box: '#0f172a',
  boxBorder: '#334155',
  boxBorderActive: '#ff8700',
  dot: '#f8fafc',
  helper: '#94a3b8',
};

type PinBoxInputProps = {
  value: string;
  onChangeText: (v: string) => void;
  /** Small helper line under the boxes, e.g. "Enter a 4-6 digit PIN". */
  helper?: string;
  inputRef?: React.RefObject<TextInput | null>;
  accessibilityLabel?: string;
  /** Fires once when the value reaches PIN_MAX_LENGTH (used to auto-advance). */
  onFilled?: () => void;
};

export function PinBoxInput({
  value,
  onChangeText,
  helper,
  inputRef,
  accessibilityLabel,
  onFilled,
}: PinBoxInputProps) {
  const [focused, setFocused] = useState(false);

  const handleChange = (text: string) => {
    const clean = text.replace(/[^0-9]/g, '').slice(0, PIN_MAX_LENGTH);
    const crossedMax = clean.length === PIN_MAX_LENGTH && value.length < PIN_MAX_LENGTH;
    onChangeText(clean);
    if (crossedMax) onFilled?.();
  };

  return (
    <View>
      <View style={styles.boxRow} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: PIN_MAX_LENGTH }).map((_, i) => {
          const filled = i < value.length;
          const active = focused && i === value.length;
          return (
            <View
              key={i}
              style={[styles.box, active && styles.boxActive]}
            >
              {filled ? <View style={styles.dot} /> : null}
            </View>
          );
        })}
        {/* Invisible input stretched over the boxes: taps anywhere on the row
            focus it, digits fill the boxes. iOS number-pad has no return key,
            so commit stays on the modal buttons. */}
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={value}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          maxLength={PIN_MAX_LENGTH}
          caretHidden
          autoComplete="off"
          autoCorrect={false}
          textContentType="none"
          contextMenuHidden
          accessibilityLabel={accessibilityLabel}
        />
      </View>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boxRow: {
    flexDirection: 'row',
    gap: 8,
  },
  box: {
    flex: 1,
    maxWidth: 46,
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.boxBorder,
    backgroundColor: C.box,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: {
    borderColor: C.boxBorderActive,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.dot,
  },
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    color: 'transparent',
  },
  helper: {
    fontSize: 13,
    color: C.helper,
    marginTop: 8,
  },
});

export default PinBoxInput;

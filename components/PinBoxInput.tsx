import React, { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

// Mirrors the web wallet's Set Transaction PIN entry (segmented boxes with
// dots) so PIN entry looks and behaves the same in native modals and in the
// WebView. Structure over pixel-parity: navy wells, slate borders, brand
// orange focus ring.
const C = {
  box: '#09090c',
  boxBorder: '#22232a',
  boxBorderActive: '#fa761e',
  dot: '#f5f3f0',
  helper: '#9c9dab',
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
  /** Android's numeric keyboard has a Next/Done action key; iOS's does not. */
  onSubmitEditing?: () => void;
};

export function PinBoxInput({
  value,
  onChangeText,
  helper,
  inputRef,
  accessibilityLabel,
  onFilled,
  onSubmitEditing,
}: PinBoxInputProps) {
  const [focused, setFocused] = useState(false);
  const localRef = useRef<TextInput>(null);
  const fieldRef = inputRef ?? localRef;

  const handleChange = (text: string) => {
    const clean = text.replace(/[^0-9]/g, '').slice(0, PIN_MAX_LENGTH);
    const crossedMax = clean.length === PIN_MAX_LENGTH && value.length < PIN_MAX_LENGTH;
    onChangeText(clean);
    if (crossedMax) onFilled?.();
  };

  return (
    <View>
      {/* Only the decorative boxes are hidden from screen readers; the
          TextInput stays an accessible sibling so VoiceOver/TalkBack users
          can focus and fill the PIN. Presses on the boxes focus the input
          programmatically; the input itself never intercepts touches. */}
      <Pressable
        style={styles.boxRow}
        onPress={() => fieldRef.current?.focus()}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
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
      </Pressable>
      <TextInput
        ref={fieldRef}
        style={styles.hiddenInput}
        pointerEvents="none"
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
        onSubmitEditing={onSubmitEditing}
      />
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

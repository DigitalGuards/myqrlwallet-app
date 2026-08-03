import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

// Boot messages, cycled while no customMessage is set.
const LOADING_MESSAGES = [
  'Waking your wallet...',
  'Establishing post-quantum encryption...',
  'Connecting to the QRL network...',
  'Loading your accounts...',
];

// Obsidian & Ember palette (mirrors the web wallet tokens).
const INK = '#09090c';
const EMBER = '#fa761e';
const EMBER_SOFT = '#fb8b41';
const BLUE = '#4aafff';
const MUTED = '#9c9dab';
const TRACK = 'rgba(245, 243, 240, 0.08)';

const PROGRESS_TRACK_WIDTH = 220;

type EmberSpec = {
  x: number;
  size: number;
  duration: number;
  delay: number;
  color: string;
  drift: number;
};

/**
 * A single ember: rises from the lower third to above the logo while
 * fading, then loops. Transform + opacity only, so the whole field runs
 * on the native driver.
 */
const Ember: React.FC<{ spec: EmberSpec }> = ({ spec }) => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    const timeout = setTimeout(() => {
      loop = Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration: spec.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
    }, spec.delay);
    return () => {
      clearTimeout(timeout);
      loop?.stop();
    };
  }, [progress, spec.delay, spec.duration]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height * 0.82, height * 0.12],
  });
  const translateX = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, spec.drift, 0],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.75, 1],
    outputRange: [0, 0.85, 0.35, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spec.x,
        top: 0,
        width: spec.size,
        height: spec.size,
        borderRadius: spec.size / 2,
        backgroundColor: spec.color,
        opacity,
        transform: [{ translateY }, { translateX }],
      }}
    />
  );
};

interface QuantumLoadingScreenProps {
  visible: boolean;
  customMessage?: string; // When set, display this instead of cycling messages
  /**
   * Real load fraction (0..1). When provided the bar is determinate;
   * without it an indeterminate ember beam sweeps the track.
   */
  progress?: number;
}

const QuantumLoadingScreen: React.FC<QuantumLoadingScreenProps> = ({
  visible,
  customMessage,
  progress,
}) => {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.9)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const messageOpacity = useRef(new Animated.Value(1)).current;
  const beamPosition = useRef(new Animated.Value(0)).current;
  const fillScale = useRef(new Animated.Value(0)).current;
  const [messageIndex, setMessageIndex] = useState(0);

  const [embers] = useState<EmberSpec[]>(() =>
    Array.from({ length: 14 }, (_, i) => ({
      x: Math.random() * width,
      size: 2 + Math.random() * 3,
      duration: 6000 + Math.random() * 5000,
      delay: Math.random() * 4000,
      // A couple of battery-blue sparks among the embers.
      color: i % 7 === 3 ? BLUE : i % 2 ? EMBER : EMBER_SOFT,
      drift: (Math.random() - 0.5) * 60,
    })),
  );

  const isDeterminate = typeof progress === 'number';

  // Cycle through loading messages with a crossfade (skip if customMessage).
  useEffect(() => {
    if (!visible || customMessage) return;
    const interval = setInterval(() => {
      Animated.timing(messageOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
        Animated.timing(messageOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }).start();
      });
    }, 2800);
    return () => clearInterval(interval);
  }, [visible, customMessage, messageOpacity]);

  // Logo entrance + very subtle pulse.
  useEffect(() => {
    if (!visible) return;

    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.02,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );
    const timeout = setTimeout(() => pulse.start(), 700);
    return () => {
      clearTimeout(timeout);
      pulse.stop();
    };
  }, [visible, logoOpacity, logoScale]);

  // Indeterminate beam sweep (only mounted when no progress fraction).
  useEffect(() => {
    if (!visible || isDeterminate) return;
    const sweep = Animated.loop(
      Animated.timing(beamPosition, {
        toValue: 1,
        duration: 1150,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    sweep.start();
    return () => sweep.stop();
  }, [visible, isDeterminate, beamPosition]);

  // Determinate fill: ease toward the latest real fraction.
  useEffect(() => {
    if (!isDeterminate) return;
    Animated.timing(fillScale, {
      toValue: Math.min(Math.max(progress ?? 0, 0), 1),
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isDeterminate, progress, fillScale]);

  // Fade out when hidden.
  useEffect(() => {
    if (!visible) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start();
    } else {
      fadeAnim.setValue(1);
    }
  }, [visible, fadeAnim]);

  if (!visible) return null;

  const beamTranslate = beamPosition.interpolate({
    inputRange: [0, 1],
    outputRange: [-PROGRESS_TRACK_WIDTH * 0.45, PROGRESS_TRACK_WIDTH],
  });

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Atmosphere: soft ember wash above, faint cyan breath below. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(250, 118, 30, 0.14)', 'rgba(250, 118, 30, 0.04)', 'rgba(0, 0, 0, 0)']}
        locations={[0, 0.45, 1]}
        style={styles.glowTop}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0, 0, 0, 0)', 'rgba(74, 175, 255, 0.05)']}
        style={styles.glowBottom}
      />

      {/* Rising embers in place of the old matrix rain. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {embers.map((spec, index) => (
          <Ember key={index} spec={spec} />
        ))}
      </View>

      <View style={styles.content}>
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
            marginBottom: 18,
          }}
        >
          <Image
            source={require('../assets/images/myqrlwallet/mqrlwallet.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>

        <Text style={styles.subtitle}>Post-Quantum Secure</Text>

        <View style={styles.track}>
          {isDeterminate ? (
            <Animated.View
              style={[
                styles.fill,
                {
                  transform: [{ scaleX: fillScale }],
                },
              ]}
            />
          ) : (
            <Animated.View
              style={[
                styles.beam,
                { transform: [{ translateX: beamTranslate }] },
              ]}
            >
              <View style={styles.beamBody} />
              <View style={styles.beamHead} />
            </Animated.View>
          )}
        </View>

        <View style={styles.messageContainer}>
          <Animated.Text
            style={[styles.loadingMessage, { opacity: messageOpacity }]}
          >
            {customMessage || LOADING_MESSAGES[messageIndex]}
          </Animated.Text>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: INK,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    overflow: 'hidden',
  },
  glowTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: height * 0.45,
  },
  glowBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.3,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  logo: {
    width: 260,
    height: 74,
  },
  subtitle: {
    fontSize: 11,
    color: MUTED,
    marginBottom: 36,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  track: {
    width: PROGRESS_TRACK_WIDTH,
    height: 4,
    borderRadius: 999,
    backgroundColor: TRACK,
    overflow: 'hidden',
  },
  fill: {
    width: PROGRESS_TRACK_WIDTH,
    height: 4,
    borderRadius: 999,
    backgroundColor: EMBER,
    transformOrigin: 'left',
    shadowColor: EMBER,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  beam: {
    flexDirection: 'row',
    alignItems: 'center',
    width: PROGRESS_TRACK_WIDTH * 0.4,
    height: 4,
  },
  beamBody: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: EMBER,
    shadowColor: EMBER,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  beamHead: {
    width: 6,
    height: 6,
    marginLeft: -3,
    borderRadius: 3,
    backgroundColor: BLUE,
  },
  messageContainer: {
    height: 44,
    justifyContent: 'center',
    marginTop: 18,
  },
  loadingMessage: {
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});

export default QuantumLoadingScreen;

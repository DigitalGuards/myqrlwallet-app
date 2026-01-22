import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  Image,
} from 'react-native';

const { width, height } = Dimensions.get('window');

// Matrix characters - mix of symbols and numbers
const MATRIX_CHARS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

// Security-themed loading messages
const LOADING_MESSAGES = [
  'Initializing quantum-secure protocols...',
  'Establishing post-quantum encryption...',
  'Securing your digital assets...',
  'Loading QRL Zond network...',
  'Preparing your quantum-safe wallet...',
];

interface MatrixColumnProps {
  delay: number;
  speed: number;
  x: number;
}

const MatrixColumn: React.FC<MatrixColumnProps> = ({ delay, speed, x }) => {
  const translateY = useRef(new Animated.Value(-height * 0.5)).current;
  const [chars] = useState(() => {
    const length = Math.floor(Math.random() * 15) + 10;
    return Array.from({ length }, () =>
      MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]
    );
  });

  useEffect(() => {
    let loopAnimation: Animated.CompositeAnimation | null = null;
    let delayTimeout: ReturnType<typeof setTimeout> | null = null;

    // Create the looping animation
    const createLoop = () => {
      loopAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(translateY, {
            toValue: height,
            duration: speed,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: -height * 0.5,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
      loopAnimation.start();
    };

    // Apply initial delay, then start looping
    delayTimeout = setTimeout(() => {
      createLoop();
    }, delay);

    return () => {
      if (delayTimeout) {
        clearTimeout(delayTimeout);
      }
      if (loopAnimation) {
        loopAnimation.stop();
      }
    };
  }, [translateY, delay, speed]);

  return (
    <Animated.View
      style={[
        styles.matrixColumn,
        {
          left: x,
          transform: [{ translateY }],
        },
      ]}
    >
      {chars.map((char, index) => (
        <Text
          key={index}
          style={[
            styles.matrixChar,
            {
              opacity: index === 0 ? 1 : 0.5 + (index / chars.length) * 0.4,
              color: index === 0 ? '#ff8700' : '#ff8700aa',
            },
          ]}
        >
          {char}
        </Text>
      ))}
    </Animated.View>
  );
};

interface QuantumLoadingScreenProps {
  visible: boolean;
  customMessage?: string; // When set, display this instead of cycling messages
}

const QuantumLoadingScreen: React.FC<QuantumLoadingScreenProps> = ({ visible, customMessage }) => {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const [messageIndex, setMessageIndex] = useState(0);
  const [columns] = useState(() => {
    const cols = [];
    const numColumns = Math.floor(width / 25);
    for (let i = 0; i < numColumns; i++) {
      cols.push({
        x: i * 25,
        delay: Math.random() * 2000,
        speed: 3000 + Math.random() * 4000,
      });
    }
    return cols;
  });

  // Cycle through loading messages (skip if customMessage is provided)
  useEffect(() => {
    if (!visible || customMessage) return;
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [visible, customMessage]);

  // Logo animation
  useEffect(() => {
    if (!visible) return;

    // Fade in and scale up logo
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle pulse animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.05,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );

    const timeout = setTimeout(() => pulse.start(), 800);
    return () => {
      clearTimeout(timeout);
      pulse.stop();
    };
  }, [visible, logoOpacity, logoScale]);

  // Fade out animation
  useEffect(() => {
    if (!visible) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start();
    } else {
      fadeAnim.setValue(1);
    }
  }, [visible, fadeAnim]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Matrix rain background */}
      <View style={styles.matrixContainer}>
        {columns.map((col, index) => (
          <MatrixColumn
            key={index}
            x={col.x}
            delay={col.delay}
            speed={col.speed}
          />
        ))}
      </View>

      {/* Dark overlay for readability */}
      <View style={styles.overlay} />

      {/* Content */}
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <Image
            source={require('../assets/images/myqrlwallet/mqrlwallet.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>

        <Text style={styles.subtitle}>Post-Quantum Secure</Text>

        <View style={styles.messageContainer}>
          <Text style={styles.loadingMessage}>
            {customMessage || LOADING_MESSAGES[messageIndex]}
          </Text>
        </View>

        {/* Loading dots */}
        <View style={styles.dotsContainer}>
          {[0, 1, 2].map((i) => (
            <LoadingDot key={i} delay={i * 200} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
};

const LoadingDot: React.FC<{ delay: number }> = ({ delay }) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    animate.start();
    return () => animate.stop();
  }, [opacity, delay]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A17',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  matrixContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  matrixColumn: {
    position: 'absolute',
    top: 0,
  },
  matrixChar: {
    fontSize: 16,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 23, 0.55)',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  logoContainer: {
    marginBottom: 20,
  },
  logo: {
    width: 280,
    height: 80,
  },
  subtitle: {
    fontSize: 16,
    color: '#ff8700',
    marginBottom: 40,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  messageContainer: {
    height: 50,
    justifyContent: 'center',
  },
  loadingMessage: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  dotsContainer: {
    flexDirection: 'row',
    marginTop: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff8700',
    marginHorizontal: 4,
  },
});

export default QuantumLoadingScreen;

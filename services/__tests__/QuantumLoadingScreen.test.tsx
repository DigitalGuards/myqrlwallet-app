import { act, type ComponentProps, type ReactElement } from 'react';
import { Animated } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import QuantumLoadingScreen from '../../components/QuantumLoadingScreen';
import { malformed } from '../../test-utils/malformed';
import { isRecord } from '../guards';

function isNativeTestRenderer(value: unknown): value is {
  create: (element: ReactElement) => Promise<ReactTestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const renderer: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(renderer)) throw new TypeError('Missing native test renderer');

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

function animation() {
  return {
    start: jest.fn<undefined, [Animated.EndCallback?]>(),
    stop: jest.fn<undefined, []>(),
    reset: jest.fn<undefined, []>(),
  };
}

describe('quantum loading animations', () => {
  let screen: ReactTestRenderer;
  const timings: {
    value: Parameters<typeof Animated.timing>[0];
    config: Animated.TimingAnimationConfig;
    control: ReturnType<typeof animation>;
  }[] = [];
  const loops: ReturnType<typeof animation>[] = [];

  const latestTiming = (duration: number) => {
    const timing = timings.filter((entry) => entry.config.duration === duration).at(-1);
    if (!timing) throw new Error(`Missing ${duration} ms animation`);
    return timing;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    timings.length = 0;
    loops.length = 0;
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
      const control = animation();
      timings.push({ value, config, control });
      return control;
    });
    jest.spyOn(Animated, 'spring').mockImplementation(() => animation());
    jest.spyOn(Animated, 'sequence').mockImplementation(() => animation());
    jest.spyOn(Animated, 'parallel').mockImplementation(() => animation());
    jest.spyOn(Animated, 'loop').mockImplementation(() => {
      const control = animation();
      loops.push(control);
      return control;
    });
  });
  afterEach(async () => {
    await act<undefined>(() => { screen.unmount(); });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps the fill value stable across updates with the same clamping and native timing', async () => {
    screen = await renderer.create(<QuantumLoadingScreen visible progress={0.25} />);
    const first = latestTiming(260);
    expect(first.config.toValue).toBe(0.25);
    for (const [progress, expected] of [
      [-2, 0], [0, 0], [0.75, 0.75], [2, 1], [NaN, NaN], [Infinity, 1], [-Infinity, 0],
    ]) {
      if (progress === undefined) throw new Error('Missing progress fixture');
      await act<undefined>(() => { screen.update(<QuantumLoadingScreen visible progress={progress} />); });
      const updated = latestTiming(260);
      expect(updated.value).toBe(first.value);
      expect(updated.config.toValue).toBe(expected);
      expect(updated.config.useNativeDriver).toBe(true);
      expect(updated.control.start).toHaveBeenCalledTimes(1);
    }
    // Only the logo pulse is created before the delayed sparks start.
    expect(loops).toHaveLength(1);
  });

  it.each([undefined, null, '0.5', 1n])('keeps progress %p indeterminate', async (progress) => {
    const props = malformed<ComponentProps<typeof QuantumLoadingScreen>>({ visible: true, progress });
    screen = await renderer.create(<QuantumLoadingScreen {...props} />);
    expect(timings.some((entry) => entry.config.duration === 260)).toBe(false);
    const sweep = latestTiming(1150);
    expect(sweep.config.toValue).toBe(1);
    expect(sweep.config.useNativeDriver).toBe(true);
    expect(loops.at(-1)?.start.mock.calls).toEqual([[]]);
  });

  it('cycles messages after the existing fade and pauses for a custom message', async () => {
    screen = await renderer.create(<QuantumLoadingScreen visible />);
    expect(JSON.stringify(screen.toJSON())).toContain('Waking your wallet...');
    await act<undefined>(() => { jest.advanceTimersByTime(2799); });
    expect(timings.some((entry) => entry.config.duration === 220)).toBe(false);
    await act<undefined>(() => { jest.advanceTimersByTime(1); });
    const fade = latestTiming(220);
    expect(fade.config.toValue).toBe(0);
    const complete = fade.control.start.mock.calls[0]?.[0];
    if (!complete) throw new Error('Missing message fade callback');
    await act<undefined>(() => { complete({ finished: true }); });
    expect(JSON.stringify(screen.toJSON())).toContain('Establishing post-quantum encryption...');
    const reveal = latestTiming(220);
    expect(reveal.value).toBe(fade.value);
    expect(reveal.config.toValue).toBe(1);

    await act<undefined>(() => {
      screen.update(<QuantumLoadingScreen visible customMessage="Opening wallet..." />);
    });
    await act<undefined>(() => { jest.advanceTimersByTime(5600); });
    expect(latestTiming(220)).toBe(reveal);
    expect(JSON.stringify(screen.toJSON())).toContain('Opening wallet...');
  });

  it('keeps the delayed pulse and sparks stable across renders and stops them on hide', async () => {
    screen = await renderer.create(<QuantumLoadingScreen visible customMessage="Opening wallet..." />);
    const pulse = loops[0];
    if (!pulse) throw new Error('Missing logo pulse');
    await act<undefined>(() => { jest.advanceTimersByTime(699); });
    expect(pulse.start).not.toHaveBeenCalled();
    await act<undefined>(() => { jest.advanceTimersByTime(1); });
    expect(pulse.start).toHaveBeenCalledTimes(1);
    await act<undefined>(() => { jest.advanceTimersByTime(1300); });
    expect(loops).toHaveLength(16);
    expect(timings.filter((entry) => entry.config.duration === 8500)).toHaveLength(14);
    for (const loop of loops) expect(loop.start).toHaveBeenCalledTimes(1);

    await act<undefined>(() => {
      screen.update(<QuantumLoadingScreen visible customMessage="Connecting..." />);
    });
    expect(loops).toHaveLength(16);
    await act<undefined>(() => { screen.update(<QuantumLoadingScreen visible={false} />); });
    expect(screen.toJSON()).toBeNull();
    expect(latestTiming(400).config.toValue).toBe(0);
    for (const loop of loops) expect(loop.stop).toHaveBeenCalledTimes(1);
    const stoppedTimings = timings.length;
    await act<undefined>(() => { jest.advanceTimersByTime(10000); });
    expect(timings).toHaveLength(stoppedTimings);
  });
});

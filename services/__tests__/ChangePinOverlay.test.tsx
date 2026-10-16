import { act, type ReactElement } from 'react';
import { BackHandler, Modal } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import { ChangePinOverlay } from '../../components/ChangePinOverlay';
import { isRecord } from '../guards';

function isNativeTestRenderer(value: unknown): value is {
  create: (element: ReactElement) => Promise<ReactTestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const rendererModule: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(rendererModule)) throw new TypeError('Missing native test renderer');
const nativeTestRenderer = rendererModule;

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('ChangePinOverlay', () => {
  let screen: ReactTestRenderer | undefined;
  let backListener: Parameters<typeof BackHandler.addEventListener>[1] | undefined;
  const remove = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    backListener = undefined;
    remove.mockClear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
      backListener = listener;
      return { remove };
    });
  });

  afterEach(async () => {
    if (screen) await act<undefined>(() => {
      screen?.unmount();
    });
    screen = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function render(visible: boolean, onCancel = jest.fn()) {
    await act(async () => {
      screen = await nativeTestRenderer.create(<ChangePinOverlay visible={visible} onSubmit={jest.fn()} onCancel={onCancel} />);
    });
    return onCancel;
  }

  it('draws in the screen tree without a native Modal', async () => {
    // A Fabric Modal presented right after the Face ID sheet can be refused by UIKit.
    await render(true);
    if (!screen) throw new Error('Missing rendered overlay');
    expect(screen.root.findAll(node => Object.is(node.type, Modal))).toHaveLength(0);
    expect(screen.root.findAllByProps({ accessibilityLabel: 'Current PIN' }).length).toBeGreaterThan(0);
  });

  it('renders nothing while hidden', async () => {
    await render(false);
    if (!screen) throw new Error('Missing rendered overlay');
    expect(screen.toJSON()).toBeNull();
  });

  it('closes on the Android back button only while visible', async () => {
    const onCancel = await render(true);
    expect(backListener).toBeDefined();
    let handled: unknown = false;
    await act<undefined>(() => {
      if (!backListener) throw new Error('Missing back listener');
      handled = Reflect.apply(backListener, undefined, []);
    });
    expect(handled).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act<undefined>(() => {
      screen?.unmount();
    });
    screen = undefined;
    expect(remove).toHaveBeenCalled();
  });

  it('does not intercept back while hidden', async () => {
    await render(false);
    expect(backListener).toBeUndefined();
  });
});

import React, { act } from 'react';
import { BackHandler, Modal } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { ChangePinOverlay } from '../../components/ChangePinOverlay';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('ChangePinOverlay', () => {
  let screen: ReactTestRenderer | undefined;
  let backListener: (() => boolean) | undefined;
  const remove = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    backListener = undefined;
    remove.mockClear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
      backListener = listener as unknown as () => boolean;
      return { remove };
    });
  });

  afterEach(async () => {
    if (screen) await act(async () => screen?.unmount());
    screen = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function render(visible: boolean, onCancel = jest.fn()) {
    await act(async () => {
      screen = create(<ChangePinOverlay visible={visible} onSubmit={jest.fn()} onCancel={onCancel} />);
    });
    return onCancel;
  }

  it('draws in the screen tree without a native Modal', async () => {
    // A Fabric Modal presented right after the Face ID sheet can be refused by UIKit.
    await render(true);
    expect(screen!.root.findAllByType(Modal as never)).toHaveLength(0);
    expect(screen!.root.findAllByProps({ accessibilityLabel: 'Current PIN' }).length).toBeGreaterThan(0);
  });

  it('renders nothing while hidden', async () => {
    await render(false);
    expect(screen!.toJSON()).toBeNull();
  });

  it('closes on the Android back button only while visible', async () => {
    const onCancel = await render(true);
    expect(backListener).toBeDefined();
    let handled = false;
    await act(async () => {
      handled = backListener!();
    });
    expect(handled).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => screen?.unmount());
    screen = undefined;
    expect(remove).toHaveBeenCalled();
  });

  it('does not intercept back while hidden', async () => {
    await render(false);
    expect(backListener).toBeUndefined();
  });
});

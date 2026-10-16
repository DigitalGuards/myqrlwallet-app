import { act, type ReactElement } from 'react';
import { BackHandler, Modal, TextInput, TouchableOpacity } from 'react-native';
import { ChangePinOverlay } from '../../components/ChangePinOverlay';
import { PinEntryModal } from '../../components/PinEntryModal';
import { isRecord } from '../guards';

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  instance: unknown;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
  findAllByType: (type: unknown) => TestInstance[];
  findAllByProps: (props: Record<string, unknown>) => TestInstance[];
}

interface TestRenderer {
  root: TestInstance;
  update: (element: ReactElement) => void;
  unmount: () => void;
  toJSON: () => unknown;
}

function isNativeTestRenderer(value: unknown): value is {
  create: (element: ReactElement) => Promise<TestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const rendererModule: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(rendererModule)) throw new TypeError('Missing native test renderer');
const nativeTestRenderer = rendererModule;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test instance or callback');
  return value;
}

function callProp(node: TestInstance, key: string, ...args: unknown[]): unknown {
  const callback = node.props[key];
  if (typeof callback !== 'function') throw new TypeError(`Missing callback ${key}`);
  return Reflect.apply(callback, node.props, args);
}

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('ChangePinOverlay', () => {
  let screen: TestRenderer | undefined;
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
    if (screen) await act<undefined>(() => { screen?.unmount(); });
    screen = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function render(visible: boolean, onCancel = jest.fn()) {
    screen = await nativeTestRenderer.create(
      <ChangePinOverlay visible={visible} onSubmit={jest.fn()} onCancel={onCancel} />,
    );
    return onCancel;
  }

  it('draws in the screen tree without a native Modal', async () => {
    // A Fabric Modal presented right after the Face ID sheet can be refused by UIKit.
    await render(true);
    expect(required(screen).root.findAll(node => Object.is(node.type, Modal))).toHaveLength(0);
    expect(required(screen).root.findAllByProps({ accessibilityLabel: 'Current PIN' }).length).toBeGreaterThan(0);
  });

  it('renders nothing while hidden', async () => {
    await render(false);
    expect(required(screen).toJSON()).toBeNull();
  });

  it('closes on the Android back button only while visible', async () => {
    const onCancel = await render(true);
    expect(backListener).toBeDefined();
    let handled: boolean | null | undefined = false;
    await act<undefined>(() => {
      handled = required(backListener)({ type: 'hardwareBackPress', timeStamp: 1 });
    });
    expect(handled).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act<undefined>(() => { screen?.unmount(); });
    screen = undefined;
    expect(remove).toHaveBeenCalled();
  });

  it('does not intercept back while hidden', async () => {
    await render(false);
    expect(backListener).toBeUndefined();
  });
});

describe.each(['entry', 'change'])('%s PIN form lifecycle', (form) => {
  let screen: TestRenderer | undefined;
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  const firstLabel = form === 'entry' ? 'Wallet PIN' : 'Current PIN';
  const submitLabel = form === 'entry' ? 'Wallet PIN' : 'Confirm New PIN';
  const errorText = form === 'entry' ? 'PIN must be at least 4 digits' : 'New PINs do not match';

  function element(visible: boolean, title = 'Unlock wallet'): ReactElement {
    return form === 'entry'
      ? <PinEntryModal visible={visible} title={title} onSubmit={onSubmit} onCancel={onCancel} />
      : <ChangePinOverlay visible={visible} onSubmit={onSubmit} onCancel={onCancel} />;
  }

  function input(label: string): TestInstance {
    return required(required(screen).root.findAllByType(TextInput).find(
      (node) => node.props.accessibilityLabel === label,
    ));
  }

  async function update(visible: boolean, title?: string): Promise<void> {
    await act<undefined>(() => { required(screen).update(element(visible, title)); });
  }

  async function enter(label: string, value: string): Promise<void> {
    await act<undefined>(() => { callProp(input(label), 'onChangeText', value); });
  }

  function focusMock(): unknown {
    const instance = input(firstLabel).instance;
    if (!isRecord(instance) || typeof instance.focus !== 'function') {
      throw new TypeError('Missing input focus method');
    }
    return instance.focus;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  });

  afterEach(async () => {
    await act<undefined>(() => { screen?.unmount(); });
    screen = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps edits and errors while visible and clears both on reopening', async () => {
    screen = await nativeTestRenderer.create(element(true));
    expect(input(firstLabel).props.value).toBe('');
    await enter(firstLabel, form === 'entry' ? '12' : '1234');
    if (form === 'change') {
      await enter('New PIN', '5678');
      await enter('Confirm New PIN', '9999');
    }
    await act<undefined>(() => { callProp(input(submitLabel), 'onSubmitEditing'); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(required(screen).root.findAllByProps({ children: errorText }).length).toBeGreaterThan(0);

    await update(true, 'Confirm wallet PIN');
    expect(input(firstLabel).props.value).toBe(form === 'entry' ? '12' : '1234');
    expect(required(screen).root.findAllByProps({ children: errorText }).length).toBeGreaterThan(0);
    await update(false);
    await update(true);

    const inputs = required(screen).root.findAllByType(TextInput);
    expect(inputs.map((node) => node.props.value)).toEqual(form === 'entry' ? [''] : ['', '', '']);
    expect(required(screen).root.findAllByProps({ children: errorText })).toHaveLength(0);
    const buttons = required(screen).root.findAllByType(TouchableOpacity);
    expect(required(buttons.at(-1)).props.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('submits the exact entered PIN values and preserves them until the form reopens', async () => {
    screen = await nativeTestRenderer.create(element(true));
    await enter(firstLabel, '1234');
    if (form === 'change') {
      await enter('New PIN', '567890');
      await enter('Confirm New PIN', '567890');
    }
    const buttons = required(screen).root.findAllByType(TouchableOpacity);
    expect(required(buttons.at(-1)).props.disabled).toBe(false);
    await act<undefined>(() => { callProp(input(submitLabel), 'onSubmitEditing'); });
    expect(onSubmit.mock.calls).toEqual(form === 'entry' ? [['1234']] : [['1234', '567890']]);
    expect(input(firstLabel).props.value).toBe('1234');
  });

  it('cancels once and resets entered PINs on reopening', async () => {
    screen = await nativeTestRenderer.create(element(true));
    await enter(firstLabel, '1234');
    const cancelButton = required(required(screen).root.findAllByType(TouchableOpacity)[0]);
    await act<undefined>(() => { callProp(cancelButton, 'onPress'); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input(firstLabel).props.value).toBe(form === 'entry' ? '' : '1234');
    await update(false);
    await update(true);
    expect(input(firstLabel).props.value).toBe('');
  });

  it('focuses after 120ms on opening and keeps one timer across visible rerenders', async () => {
    screen = await nativeTestRenderer.create(element(false));
    await update(true);
    const focus = focusMock();
    expect(focus).not.toHaveBeenCalled();
    await act<undefined>(() => { jest.advanceTimersByTime(119); });
    expect(focus).not.toHaveBeenCalled();
    await update(true, 'Confirm wallet PIN');
    await act<undefined>(() => { jest.advanceTimersByTime(1); });
    expect(focus).toHaveBeenCalledTimes(1);
    await act<undefined>(() => { jest.advanceTimersByTime(120); });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending focus on hide and unmount', async () => {
    screen = await nativeTestRenderer.create(element(true));
    const focus = focusMock();
    await act<undefined>(() => { jest.advanceTimersByTime(119); });
    await update(false);
    await act<undefined>(() => { jest.advanceTimersByTime(1); });
    expect(focus).not.toHaveBeenCalled();
    await update(true);
    await act<undefined>(() => { jest.advanceTimersByTime(120); });
    expect(focusMock()).toHaveBeenCalledTimes(1);
    await update(false);
    await update(true);
    const reopenedFocus = focusMock();
    await act<undefined>(() => { required(screen).unmount(); });
    screen = undefined;
    await act<undefined>(() => { jest.advanceTimersByTime(120); });
    expect(reopenedFocus).toHaveBeenCalledTimes(1);
  });
});

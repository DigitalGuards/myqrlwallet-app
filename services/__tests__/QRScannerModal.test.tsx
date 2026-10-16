import { act, type ReactElement } from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import QRScannerModal from '../../components/QRScannerModal';
import { isRecord } from '../guards';

function isNativeTestRenderer(value: unknown): value is {
  create: (element: ReactElement) => Promise<ReactTestRenderer>;
} {
  return isRecord(value) && typeof value.create === 'function';
}

const renderer: unknown = jest.requireActual('@react-native/jest-preset/jest/renderer');
if (!isNativeTestRenderer(renderer)) throw new TypeError('Missing native test renderer');

const mockCameraRender = jest.fn<undefined, [unknown]>();

jest.mock('expo-camera', () => ({
  CameraView: (props: Record<string, unknown>) => {
    mockCameraRender(props.onBarcodeScanned);
    const React = jest.requireActual<typeof import('react')>('react');
    return React.createElement('CameraView', props);
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('QR scanner reset and synchronous lock', () => {
  let screen: ReactTestRenderer;
  const calls: string[] = [];
  const onScan = jest.fn((data: string) => { calls.push(`scan:${data}`); });
  const onClose = jest.fn(() => { calls.push('close'); });

  const element = (visible: boolean) => (
    <QRScannerModal visible={visible} onScan={onScan} onClose={onClose} />
  );
  const scanCallback = (): unknown => {
    const props: unknown = screen.root.find(({ type }: { type: unknown }) => type === 'CameraView').props;
    if (!isRecord(props)) throw new Error('Missing camera props');
    return props.onBarcodeScanned;
  };
  const scan = (callback: unknown, data: string) => {
    if (typeof callback !== 'function') throw new TypeError('Missing scan callback');
    Reflect.apply(callback, undefined, [{ data, type: 'qr' }]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
  });
  afterEach(async () => {
    await act<undefined>(() => { screen.unmount(); });
  });

  it('accepts one callback per opening and preserves scan-before-close ordering', async () => {
    screen = await renderer.create(element(true));
    const firstScan = scanCallback();
    await act<undefined>(() => {
      scan(firstScan, 'first');
      scan(firstScan, 'duplicate');
    });
    expect(calls).toEqual(['scan:first', 'close']);
    expect(scanCallback()).toBeUndefined();

    await act<undefined>(() => { screen.update(element(true)); });
    expect(scanCallback()).toBeUndefined();
    await act<undefined>(() => { scan(firstScan, 'late'); });
    expect(calls).toEqual(['scan:first', 'close']);

    await act<undefined>(() => { screen.update(element(false)); });
    await act<undefined>(() => { screen.update(element(true)); });
    const reopenedScan = scanCallback();
    await act<undefined>(() => {
      scan(reopenedScan, 'second');
      scan(reopenedScan, 'duplicate');
    });
    expect(calls).toEqual(['scan:first', 'close', 'scan:second', 'close']);
    expect(scanCallback()).toBeUndefined();
  });

  it('resets on opening after an initially hidden mount', async () => {
    screen = await renderer.create(element(false));
    await act<undefined>(() => { screen.update(element(true)); });
    await act<undefined>(() => { scan(scanCallback(), 'qrlconnect://pairing'); });
    expect(calls).toEqual(['scan:qrlconnect://pairing', 'close']);
  });

  it('reopens with an enabled scanner in a single camera render', async () => {
    screen = await renderer.create(element(true));
    await act<undefined>(() => { scan(scanCallback(), 'first'); });
    await act<undefined>(() => { screen.update(element(false)); });
    mockCameraRender.mockClear();

    await act<undefined>(() => { screen.update(element(true)); });

    expect(mockCameraRender).toHaveBeenCalledTimes(1);
    expect(mockCameraRender).toHaveBeenCalledWith(expect.any(Function));
  });

  it('preserves a scan callback error and the lock until the next opening', async () => {
    screen = await renderer.create(element(true));
    const failure = new Error('scan callback failed');
    onScan.mockImplementationOnce(() => { throw failure; });
    const callback = scanCallback();
    await act<undefined>(() => {
      expect(() => { scan(callback, 'first'); }).toThrow(failure);
      scan(callback, 'duplicate');
    });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(scanCallback()).toBeUndefined();
    await act<undefined>(() => { screen.update(element(false)); });
    await act<undefined>(() => { screen.update(element(true)); });
    await act<undefined>(() => { scan(scanCallback(), 'retry'); });
    expect(calls).toEqual(['scan:retry', 'close']);
  });
});

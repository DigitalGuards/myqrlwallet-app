import type { ReactElement } from 'react';
import QuantumLoadingScreen from '../../components/QuantumLoadingScreen';
import { isRecord } from '../guards';

jest.mock('react-native', () => {
  const nativeWeb: unknown = jest.requireActual('react-native-web');
  return nativeWeb;
});
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'div' }));
jest.mock('../../constants/Assets', () => ({ LOGO_IMAGE: { uri: 'logo.png' } }));

function isServerRenderer(value: unknown): value is {
  renderToStaticMarkup: (element: ReactElement) => string;
} {
  return isRecord(value) && typeof value.renderToStaticMarkup === 'function';
}

const server: unknown = jest.requireActual('react-dom/server.node');
if (!isServerRenderer(server)) throw new TypeError('Missing web server renderer');

describe('quantum loading screen on web', () => {
  it('renders an unconditionally mounted hidden overlay', () => {
    expect(server.renderToStaticMarkup(<QuantumLoadingScreen visible={false} />)).toBe('');
  });

  it.each([{}, { progress: 0.5 }])(
    'renders the overlay and its sparks with props %p',
    (props) => {
      const html = server.renderToStaticMarkup(<QuantumLoadingScreen visible {...props} />);
      expect(html).toContain('Post-Quantum Secure');
      expect(html).toContain('Waking your wallet...');
    },
  );
});

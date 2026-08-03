jest.mock('expo-local-authentication', () => ({}));
jest.mock('../SeedStorageService', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../NativeBridge', () => ({
  __esModule: true,
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR: 'Native PIN change outcome is ambiguous',
  NATIVE_PIN_COMMIT_ERROR: 'Native secure PIN commit failed',
  default: {
    changePin: jest.fn(),
  },
}));
jest.mock('../Logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), error: jest.fn() },
}));

import BiometricService from '../BiometricService';
import NativeBridge, {
  NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR,
  NATIVE_PIN_COMMIT_ERROR,
} from '../NativeBridge';

const mockChangePin = NativeBridge.changePin as jest.MockedFunction<
  typeof NativeBridge.changePin
>;

describe('BiometricService PIN change recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('automatically compensates an ambiguous timeout back to the old PIN', async () => {
    mockChangePin
      .mockResolvedValueOnce({ success: false, error: NATIVE_PIN_CHANGE_AMBIGUOUS_ERROR })
      .mockResolvedValueOnce({ success: true });

    await expect(BiometricService.changePin('1234', '5678')).resolves.toEqual({
      success: false,
      error: 'The PIN change could not be confirmed. No change was made; your old PIN remains active.',
    });

    expect(mockChangePin).toHaveBeenNthCalledWith(1, '1234', '5678');
    expect(mockChangePin).toHaveBeenNthCalledWith(2, '5678', '1234', {
      acceptAlreadyTarget: true,
    });
  });

  it('automatically compensates a failed native PIN commit', async () => {
    mockChangePin
      .mockResolvedValueOnce({ success: false, error: NATIVE_PIN_COMMIT_ERROR })
      .mockResolvedValueOnce({ success: true });

    await expect(BiometricService.changePin('1234', '5678')).resolves.toEqual({
      success: false,
      error: 'The PIN change could not be confirmed. No change was made; your old PIN remains active.',
    });

    expect(mockChangePin).toHaveBeenNthCalledWith(2, '5678', '1234', {
      acceptAlreadyTarget: true,
    });
  });
});

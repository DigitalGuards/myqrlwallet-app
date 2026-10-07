import { describeRunningUpdate } from '../UpdateDiagnostics';

const mockUpdates = {
  isEmbeddedLaunch: true as boolean,
  updateId: null as string | null,
  channel: null as string | null,
  runtimeVersion: null as string | null,
  createdAt: null as Date | null,
};
jest.mock('expo-updates', () => ({
  get isEmbeddedLaunch() {
    return mockUpdates.isEmbeddedLaunch;
  },
  get updateId() {
    return mockUpdates.updateId;
  },
  get channel() {
    return mockUpdates.channel;
  },
  get runtimeVersion() {
    return mockUpdates.runtimeVersion;
  },
  get createdAt() {
    return mockUpdates.createdAt;
  },
}));

describe('describeRunningUpdate', () => {
  it('reports the embedded bundle', () => {
    Object.assign(mockUpdates, {
      isEmbeddedLaunch: true,
      updateId: '11111111-2222-3333-4444-555555555555',
      channel: 'production',
      runtimeVersion: 'abc123',
      createdAt: new Date('2026-10-07T10:00:00Z'),
    });
    expect(describeRunningUpdate()).toBe(
      'update: embedded embedded=true channel=production runtime=abc123 created=2026-10-07T10:00:00.000Z',
    );
  });

  it('reports a downloaded update with its id', () => {
    Object.assign(mockUpdates, {
      isEmbeddedLaunch: false,
      updateId: '11111111-2222-3333-4444-555555555555',
      channel: 'preview',
      runtimeVersion: 'abc123',
      createdAt: new Date('2026-10-07T10:00:00Z'),
    });
    expect(describeRunningUpdate()).toContain(
      'update: 11111111-2222-3333-4444-555555555555 embedded=false channel=preview',
    );
  });

  it('survives missing values', () => {
    Object.assign(mockUpdates, {
      isEmbeddedLaunch: true,
      updateId: null,
      channel: null,
      runtimeVersion: null,
      createdAt: null,
    });
    expect(describeRunningUpdate()).toBe(
      'update: embedded embedded=true channel=none runtime=unknown created=n/a',
    );
  });
});

import type AsyncStorage from '@react-native-async-storage/async-storage';

function load() {
  const storage = jest.requireMock<typeof AsyncStorage>('@react-native-async-storage/async-storage');
  const { i18n } = jest.requireActual<typeof import('../index')>('../index');
  const preference = jest.requireActual<typeof import('../preference')>('../preference');
  return { storage: jest.mocked(storage), i18n, ...preference };
}

beforeEach(() => { jest.resetModules(); });

it('initializes from expo-localization and restores a previous web choice', async () => {
  jest.doMock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'de-AT' }] }));
  const app = load();
  expect(app.i18n.language).toBe('de');
  app.storage.getItem.mockResolvedValue('ru');
  await app.restoreLanguagePreference();
  expect(app.i18n.language).toBe('ru');
});

it.each([null, 'fr', 'zh-Hant', '{broken', '"de"'])('keeps the device language for invalid storage: %s', async stored => {
  jest.doMock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'es-MX' }] }));
  const app = load();
  app.storage.getItem.mockResolvedValue(stored);
  await app.restoreLanguagePreference();
  expect(app.i18n.language).toBe('es');
});

it('keeps a web report when a slow startup storage read completes', async () => {
  const app = load();
  let finishRead: ((value: string) => void) | undefined;
  app.storage.getItem.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
  const restoring = app.restoreLanguagePreference();
  await app.applyLanguage('zh-CN');
  finishRead?.('ru');
  await restoring;
  expect(app.i18n.language).toBe('zh-CN');
  expect(app.storage.setItem).toHaveBeenCalledWith(app.LANGUAGE_STORAGE_KEY, 'zh-CN');
});

it('keeps a web report received before restoration starts', async () => {
  const app = load();
  app.storage.getItem.mockResolvedValue('de');
  await app.applyLanguage('ru');
  await app.restoreLanguagePreference();
  expect(app.i18n.language).toBe('ru');
  expect(app.storage.getItem).not.toHaveBeenCalled();
});

it('applies each report immediately and persists overlapping choices in order', async () => {
  const app = load();
  let finishWrite: (() => void) | undefined;
  app.storage.setItem.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
  const first = app.applyLanguage('de');
  expect(app.i18n.language).toBe('de');
  await Promise.resolve();
  const second = app.applyLanguage('es');
  expect(app.i18n.language).toBe('es');
  expect(app.storage.setItem).toHaveBeenCalledTimes(1);
  finishWrite?.();
  await Promise.all([first, second]);
  expect(app.storage.setItem.mock.calls).toEqual([
    [app.LANGUAGE_STORAGE_KEY, 'de'], [app.LANGUAGE_STORAGE_KEY, 'es'],
  ]);
});

it('retains live changes through storage failure and allows a later write', async () => {
  const app = load();
  app.storage.getItem.mockRejectedValueOnce(new Error('read failed'));
  await app.restoreLanguagePreference();
  app.storage.setItem.mockRejectedValueOnce(new Error('write failed'));
  await app.applyLanguage('de');
  expect(app.i18n.language).toBe('de');
  await app.applyLanguage('es');
  expect(app.storage.setItem).toHaveBeenLastCalledWith(app.LANGUAGE_STORAGE_KEY, 'es');
});

it('ignores invalid values without changing language or writing storage', async () => {
  const app = load();
  await app.applyLanguage('ru');
  app.storage.setItem.mockClear();
  for (const value of [undefined, null, {}, [], 1, 'fr', 'zh-Hans', 'de-DE']) {
    await app.applyLanguage(value);
  }
  expect(app.i18n.language).toBe('ru');
  expect(app.storage.setItem).not.toHaveBeenCalled();
});

describe('the saved language', () => {
  it('is empty until storage or a change provides one', async () => {
    const app = load();
    expect(app.savedLanguagePreference()).toBeUndefined();
    app.storage.getItem.mockResolvedValue(null);
    await app.restoreLanguagePreference();
    expect(app.savedLanguagePreference()).toBeUndefined();
    await app.applyLanguage('de');
    expect(app.savedLanguagePreference()).toBe('de');
  });

  it('comes from storage', async () => {
    const app = load();
    app.storage.getItem.mockResolvedValue('ru');
    await app.restoreLanguagePreference();
    expect(app.savedLanguagePreference()).toBe('ru');
  });

  it('stays empty after a failed read, so no default counts as saved', async () => {
    const app = load();
    app.storage.getItem.mockRejectedValue(new Error('read failed'));
    await app.restoreLanguagePreference();
    expect(app.savedLanguagePreference()).toBeUndefined();
  });
});


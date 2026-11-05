import { createInstance } from 'i18next';
import { i18n, resources, t } from '../index';
import { nativeMessage } from '../nativeMessage';
import { supportedLanguages } from '../languages';
import { isRecord } from '../../services/guards';

function flatten(value: unknown, prefix = ''): Map<string, string> {
  if (!isRecord(value)) throw new Error(`Expected catalog object: ${prefix}`);
  const entries = new Map<string, string>();
  for (const [name, child] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof child === 'string') entries.set(key, child);
    else for (const [nestedKey, text] of flatten(child, key)) entries.set(nestedKey, text);
  }
  return entries;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match => match[1] ?? '').sort();
}

const english = flatten(resources.en.native);

afterEach(async () => { await i18n.changeLanguage('en'); });

it.each(supportedLanguages.filter(language => language !== 'en'))(
  '%s has exactly the English keys and interpolation placeholders', language => {
    const catalog = flatten(resources[language].native);
    expect([...catalog.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, source] of english) {
      const translation = catalog.get(key);
      expect(translation?.trim()).toBeTruthy();
      expect(placeholders(translation ?? '')).toEqual(placeholders(source));
      expect(translation).not.toContain('\u2014');
      for (const product of ['Quanta', 'QRL', 'QRL 2.0', 'MyQRLWallet']) {
        if (source.includes(product)) expect(translation).toContain(product);
      }
    }
  },
);

it('keeps English copy free of prohibited punctuation and phrasing', () => {
  for (const source of english.values()) {
    expect(source).not.toMatch(/\u2014|rather than|instead of/i);
  }
});

it('falls back to English for a missing individual translation', async () => {
  const instance = createInstance();
  await instance.init({
    resources: {
      en: resources.en,
      de: { native: { common: { cancel: 'Abbrechen' } } },
    },
    lng: 'de', defaultNS: 'native', fallbackLng: 'en', initAsync: false,
  });
  expect(instance.t('common.cancel')).toBe('Abbrechen');
  expect(instance.t('settings.removeWarning')).toBe(resources.en.native.settings.removeWarning);
});

it('translates retained service errors and leaves unknown external details intact', async () => {
  const error = resources.en.native.errors.pinRecoveryUnconfirmed;
  expect(nativeMessage(error)).toBe(error);
  for (const language of supportedLanguages) {
    await i18n.changeLanguage(language);
    expect(nativeMessage(error)).toBe(resources[language].native.errors.pinRecoveryUnconfirmed);
    expect(nativeMessage('External failure: code 437, payload unchanged')).toBe(
      'External failure: code 437, payload unchanged',
    );
  }
});

it('preserves exact English PIN attempts and lockout text', () => {
  for (const count of [1, 2, 5]) {
    const attempts = `Incorrect PIN. ${count} attempt${count === 1 ? '' : 's'} remaining.`;
    const lockout = `Too many failed attempts. Please wait ${count} minute${count === 1 ? '' : 's'}.`;
    expect(nativeMessage(attempts)).toBe(attempts);
    expect(nativeMessage(lockout)).toBe(lockout);
  }
});

it('uses all Russian PIN attempt and lockout plural forms', async () => {
  await i18n.changeLanguage('ru');
  expect(nativeMessage('Incorrect PIN. 1 attempt remaining.')).toContain('1 попытка');
  expect(nativeMessage('Incorrect PIN. 2 attempts remaining.')).toContain('2 попытки');
  expect(nativeMessage('Incorrect PIN. 5 attempts remaining.')).toContain('5 попыток');
  expect(nativeMessage('Too many failed attempts. Please wait 21 minutes.')).toContain('21 минуту');
  expect(nativeMessage('Too many failed attempts. Please wait 2 minutes.')).toContain('2 минуты');
  expect(nativeMessage('Too many failed attempts. Please wait 5 minutes.')).toContain('5 минут');
});

it('uses the current language through a callback captured before the change', async () => {
  const callback = () => t('settings.changePin');
  await i18n.changeLanguage('de');
  expect(callback()).toBe(resources.de.native.settings.changePin);
  await i18n.changeLanguage('zh-CN');
  expect(callback()).toBe(resources['zh-CN'].native.settings.changePin);
});

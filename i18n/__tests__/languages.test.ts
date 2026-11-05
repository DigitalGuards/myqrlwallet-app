import { isLanguage, resolveDeviceLanguage } from '../languages';

describe('primary device language', () => {
  it.each([
    ['en', 'en'], ['en-GB', 'en'], ['de', 'de'], ['de-AT', 'de'],
    ['es-MX', 'es'], ['ru-RU', 'ru'], ['DE-de', 'de'], ['es_419', 'es'],
    ['zh-CN', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh-Hans', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'], ['zh-Hans-HK', 'zh-CN'], ['zh_Hans_SG', 'zh-CN'],
    ['zh-CN-u-nu-hanidec', 'zh-CN'], ['zh-invalid-CN', 'en'],
    ['zh', 'en'], ['zh-TW', 'en'], ['zh-HK', 'en'], ['zh-MO', 'en'],
    ['zh-Hant', 'en'], ['zh-Hant-CN', 'en'], ['zh-Hant-SG', 'en'],
    ['fr-FR', 'en'], ['ja', 'en'], ['', 'en'], [null, 'en'], [undefined, 'en'],
  ])('resolves %s to %s', (locale, expected) => {
    expect(resolveDeviceLanguage(locale)).toBe(expected);
  });

  it.each(['en', 'de', 'es', 'ru', 'zh-CN'])('accepts the exact web code %s', language => {
    expect(isLanguage(language)).toBe(true);
  });

  it.each([null, undefined, 1, true, {}, [], '', 'de-DE', 'zh', 'zh-cn', 'zh-Hans', 'fr', ' en']) (
    'rejects unsupported or malformed web codes: %p', language => {
      expect(isLanguage(language)).toBe(false);
    },
  );
});

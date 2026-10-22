export const supportedLanguages = ['en', 'de', 'es', 'ru', 'zh-CN'] as const;
export type Language = (typeof supportedLanguages)[number];

export function isLanguage(value: unknown): value is Language {
  return supportedLanguages.some(language => language === value);
}

/** Use the primary device locale. An explicit script takes priority over its region. */
export function resolveDeviceLanguage(locale: string | null | undefined): Language {
  if (!locale) return 'en';
  const parts = locale.toLowerCase().replace(/_/g, '-').split('-');
  const language = parts[0];
  if (language === 'de' || language === 'es' || language === 'ru') return language;
  if (language !== 'zh') return 'en';
  const script = /^[a-z]{4}$/.test(parts[1] ?? '') ? parts[1] : undefined;
  if (script) return script === 'hans' ? 'zh-CN' : 'en';
  return parts[1] === 'cn' || parts[1] === 'sg' ? 'zh-CN' : 'en';
}

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { resolveDeviceLanguage, supportedLanguages } from './languages';
import en from '../locales/en/native.json';
import de from '../locales/de/native.json';
import es from '../locales/es/native.json';
import ru from '../locales/ru/native.json';
import zhCN from '../locales/zh-CN/native.json';

export const resources = {
  en: { native: en },
  de: { native: de },
  es: { native: es },
  ru: { native: ru },
  'zh-CN': { native: zhCN },
};

function deviceLanguage() {
  try {
    return resolveDeviceLanguage(getLocales()[0].languageTag);
  } catch {
    return 'en';
  }
}

// Every catalog ships with the native bundle, including offline startup.
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: 'en',
  supportedLngs: supportedLanguages,
  load: 'currentOnly',
  defaultNS: 'native',
  initAsync: false,
  returnNull: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

// This stable function reads the current language on each call. Security
// effects can retain their callbacks while their displayed text updates.
export const t = i18n.t;

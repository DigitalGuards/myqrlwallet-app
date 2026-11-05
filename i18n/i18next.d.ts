import 'i18next';
import type native from '../locales/en/native.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'native';
    resources: { native: typeof native };
    strictKeyChecks: true;
    enableSelector: false;
    returnNull: false;
  }
}

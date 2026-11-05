import { useTranslation as useReactTranslation } from 'react-i18next';
import { i18n } from './index';

/** Subscribe the view to language changes without restarting its security effects. */
export function useNativeLanguage() {
  useReactTranslation('native', { i18n });
}

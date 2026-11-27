import { useResolvedTheme } from '../theme/useAppTheme';

/** The app's resolved theme (the Theme setting), which is what every native screen paints. */
export function useColorScheme(): 'dark' | 'light' {
  return useResolvedTheme();
}

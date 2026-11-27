import { shellThemeScript, shellThemeStatement } from '../ShellTheme';

describe('shell theme script', () => {
  it('is a statement the before-content hook can run (it ends in a value)', () => {
    expect(shellThemeScript({ theme: 'light', resolved: 'light' })).toBe(
      'window.__QRL_SHELL_THEME__ = {"theme":"light","resolved":"light"}; true;',
    );
  });

  it('is null for anything that is not a valid snapshot', () => {
    expect(shellThemeScript(undefined)).toBeNull();
    expect(shellThemeScript('dark')).toBeNull();
    expect(shellThemeScript(null)).toBeNull();
    expect(shellThemeStatement({ theme: '"};alert(1);//', resolved: 'dark' })).toBeNull();
    expect(shellThemeStatement({ theme: 'dark', resolved: '</script>' })).toBeNull();
    expect(shellThemeStatement({ theme: 'x', resolved: 'dark' })).toBeNull();
    expect(shellThemeStatement({ theme: 'dark', resolved: 'system' })).toBeNull();
  });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { transformMainActivity } = require('../../plugins/withBackgroundOnBack.js') as {
  transformMainActivity: (contents: string) => string;
};

/**
 * The Expo SDK 54 template's MainActivity, as prebuild writes it. The plugin
 * runs against generated source, so the fixture is what matters.
 */
const TEMPLATE = `package com.chiefdg.myqrlwallet

import android.os.Build
import android.os.Bundle

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) {
        // For non-root activities, use the default implementation to finish them.
        super.invokeDefaultOnBackPressed()
      }
      return
    }

    // Use the default back button implementation on Android S
    // because it's doing more than [Activity.moveTaskToBack] in fact.
    super.invokeDefaultOnBackPressed()
  }
}
`;

describe('withBackgroundOnBack config plugin', () => {
  it('backgrounds the app on every API level', () => {
    // The template moves the task to the back only up to API 30. From
    // Android 12 it finishes the activity, so a back press at the wallet root
    // threw away the loaded document and the unlocked session, and returning
    // meant a cold start and another Device Login prompt.
    const result = transformMainActivity(TEMPLATE);
    expect(result).toContain('if (!moveTaskToBack(true)) {');
    expect(result).not.toContain('Build.VERSION.SDK_INT <= Build.VERSION_CODES.R');
    expect(result).not.toContain('moveTaskToBack(false)');
  });

  it('keeps the default behaviour for a non-root activity', () => {
    // moveTaskToBack returns false there, and finishing is the right answer.
    const result = transformMainActivity(TEMPLATE);
    expect(result).toMatch(/if \(!moveTaskToBack\(true\)\) \{\s*super\.invokeDefaultOnBackPressed\(\)\s*\}/);
  });

  it('replaces the method and nothing else', () => {
    const result = transformMainActivity(TEMPLATE);
    expect(result).toContain('override fun getMainComponentName(): String = "main"');
    expect(result).toContain('setTheme(R.style.AppTheme)');
    expect(result).toContain('class MainActivity : ReactActivity() {');
    // One method, and the class still closes.
    expect(result.match(/override fun invokeDefaultOnBackPressed\(\)/g)).toHaveLength(1);
    const braces = [...result].reduce(
      (depth, character) =>
        character === '{' ? depth + 1 : character === '}' ? depth - 1 : depth,
      0,
    );
    expect(braces).toBe(0);
  });

  it('takes the template comment with it', () => {
    const result = transformMainActivity(TEMPLATE);
    expect(result).not.toContain('Align the back button behavior with Android S');
    expect(result).toContain('backgrounds the app rather than finishing');
  });

  it('is idempotent, because prebuild can run over the same tree twice', () => {
    const once = transformMainActivity(TEMPLATE);
    expect(transformMainActivity(once)).toBe(once);
  });

  it('fails the prebuild when the template changed shape', () => {
    // Doing nothing quietly would ship an app that finishes its activity on
    // every back press at the wallet root.
    const withoutMethod = TEMPLATE.replace(
      /override fun invokeDefaultOnBackPressed\(\)[\s\S]*?\n  \}\n/,
      '',
    );
    expect(() => transformMainActivity(withoutMethod)).toThrow(/is not in MainActivity/);
    expect(() => transformMainActivity('')).toThrow(/source is empty/);
  });
});

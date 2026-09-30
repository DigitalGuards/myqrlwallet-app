/**
 * Back at the wallet's root sends the app to the background, on every API
 * level.
 *
 * The page answers a NATIVE_BACK press with BACK_AT_ROOT when it has nothing
 * left to go back to, and the app then asks Android to leave. The Expo
 * template's MainActivity only moves the task to the back up to API 30; from
 * Android 12 it calls through to the default implementation, which finishes
 * the activity. Reopening the app then rebuilds the activity, re-reads the
 * bundled document and asks for Device Login again, so leaving and coming
 * straight back costs a full cold start and an unlock.
 *
 * android/ is generated, so this is a config plugin rather than an edit.
 */
const METHOD_SIGNATURE = 'override fun invokeDefaultOnBackPressed()';

const REPLACEMENT_BODY = `  /**
   * Back at the root of the wallet backgrounds the app rather than finishing
   * the activity. Finishing it would throw away the loaded document and the
   * unlocked session, so returning would mean a cold start and another Device
   * Login prompt. The Expo template does this only up to API 30; the wallet
   * wants it everywhere.
   *
   * moveTaskToBack returns false for a non-root activity, and the default
   * implementation is the right answer for those.
   */
  override fun invokeDefaultOnBackPressed() {
    if (!moveTaskToBack(true)) {
      super.invokeDefaultOnBackPressed()
    }
  }`;

/** The index just past the block that opens at `openIndex`. */
function findBlockEnd(contents, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < contents.length; index += 1) {
    const character = contents[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** The start of the doc comment attached to the method, if there is one. */
function findAttachedComment(contents, methodStart) {
  const before = contents.slice(0, methodStart);
  const commentEnd = before.lastIndexOf('*/');
  if (commentEnd === -1) return methodStart;
  // Only a comment that sits directly above the method, with nothing but
  // whitespace between, belongs to it.
  if (before.slice(commentEnd + 2).trim() !== '') return methodStart;
  const commentStart = before.lastIndexOf('/**', commentEnd);
  return commentStart === -1 ? methodStart : commentStart;
}

/**
 * Rewrite MainActivity so a root back press backgrounds the app.
 *
 * Throws when the method is not there. A template that changed shape must
 * fail the prebuild rather than quietly produce an app that finishes its
 * activity on every back press at the wallet's root.
 */
function transformMainActivity(contents) {
  if (typeof contents !== 'string' || contents.length === 0) {
    throw new Error('withBackgroundOnBack: MainActivity source is empty');
  }
  if (contents.includes('moveTaskToBack(true)')) {
    // Already applied. Prebuild can run more than once over the same tree.
    return contents;
  }

  const methodStart = contents.indexOf(METHOD_SIGNATURE);
  if (methodStart === -1) {
    throw new Error(
      `withBackgroundOnBack: ${METHOD_SIGNATURE} is not in MainActivity. ` +
        'The Expo template changed, so back at the wallet root would finish ' +
        'the activity instead of backgrounding the app. Update this plugin.',
    );
  }

  const openIndex = contents.indexOf('{', methodStart);
  if (openIndex === -1) throw new Error('withBackgroundOnBack: method has no body');
  const endIndex = findBlockEnd(contents, openIndex);
  if (endIndex === -1) throw new Error('withBackgroundOnBack: method body is unbalanced');

  const replaceFrom = findAttachedComment(contents, methodStart);
  const indent = contents.slice(contents.lastIndexOf('\n', replaceFrom) + 1, replaceFrom);
  return contents.slice(0, replaceFrom - indent.length) + REPLACEMENT_BODY + contents.slice(endIndex);
}

const withBackgroundOnBack = (config) => {
  // Required here rather than at module scope so the pure transform above can
  // be loaded, and tested, without pulling in the config-plugin runtime.
  const { withMainActivity } = require('expo/config-plugins');
  return withMainActivity(config, (mainActivityConfig) => {
    if (mainActivityConfig.modResults.language !== 'kt') {
      throw new Error(
        'withBackgroundOnBack: MainActivity is not Kotlin, which this plugin expects',
      );
    }
    mainActivityConfig.modResults.contents = transformMainActivity(
      mainActivityConfig.modResults.contents,
    );
    return mainActivityConfig;
  });
};

module.exports = withBackgroundOnBack;
module.exports.transformMainActivity = transformMainActivity;

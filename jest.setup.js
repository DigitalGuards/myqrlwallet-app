// Expo SDK 57 installs `fetch` as a lazy global. When a test file ends, jest
// resets the module registry and reads every enumerable global, so a getter
// nobody touched would load Expo's fetch module after the file's console has
// closed. jest then fails the run with "Cannot log after tests are done".
// Resolving it here, while the test environment is live, keeps teardown quiet.
void globalThis.fetch;

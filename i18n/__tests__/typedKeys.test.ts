import { resolve } from 'node:path';
import ts from 'typescript';

it('rejects unknown translation keys, including calls with a default value', () => {
  const root = resolve(__dirname, '../..');
  const fixture = resolve(root, 'i18n/typed-keys.fixture.ts');
  const source = `
    import { t } from './index';
    t('settings.removeWarning');
    t('errors.attempts', { count: 2 });
    t('unknown.key');
    t('unknown.key', { defaultValue: 'Fallback' });
  `;
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    esModuleInterop: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, shouldCreateNewSourceFile) =>
    name === fixture
      ? ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true)
      : originalGetSourceFile(name, version, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixture, resolve(root, 'i18n/i18next.d.ts')], options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter(error => error.file?.fileName === fixture);
  expect(errors).toHaveLength(2);
  for (const error of errors) {
    expect(ts.flattenDiagnosticMessageText(error.messageText, '\n')).toContain('unknown.key');
  }
});

const { createRequire } = require('node:module');
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactPlugin = require('eslint-plugin-react');
const globals = require('globals');

// Expo already locks React Hooks 7, including the reference compiler checks.
// Resolve its declared dependency without changing the dependency graph.
const expoRequire = createRequire(require.resolve('eslint-config-expo'));
const reactHooksPlugin = expoRequire('eslint-plugin-react-hooks');
const strictFiles = ['**/*.{ts,tsx}'];
const testFiles = ['**/__tests__/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'];
const toolingFiles = [
  '**/*.config.{js,cjs,mjs,ts}',
  'scripts/**/*.{js,cjs,mjs,ts}',
  'plugins/**/*.{js,ts}',
];

const baseConfig = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.expo/**', 'android/**', 'ios/**'],
  },
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: globals.es2021,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // Preserve the existing unused-binding options, which are stricter than
      // the reference's allowances for underscore-prefixed local bindings.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-require-imports': [
        'error',
        {
          allow: [
            '\\.png$', '\\.jpg$', '\\.jpeg$', '\\.gif$', '\\.svg$',
            '\\.ttf$', '\\.otf$', '\\.woff$', '\\.woff2$',
          ],
        },
      ],
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: strictFiles,
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      // Expo Router and Metro own module exports and refresh behavior.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports', disallowTypeAnnotations: false },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression',
          message: 'Double type assertions are banned. Narrow unknown input with a guard.',
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,jsx}'],
    ignores: toolingFiles,
    languageOptions: {
      // React Native supplies these globals; Node tooling has its own block.
      globals: {
        ...globals['shared-node-browser'],
        __DEV__: 'readonly',
        global: 'readonly',
        require: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        requestIdleCallback: 'readonly',
        cancelIdleCallback: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        alert: 'readonly',
        XMLHttpRequest: 'readonly',
      },
    },
  },
  {
    files: strictFiles,
    ignores: testFiles,
    rules: {
      // Retain the current native callback options: stricter options create
      // source findings under already enforced rules. Those findings cannot
      // enter the ratchet. Tests receive the full strict preset defaults.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false, properties: false } },
      ],
    },
  },
  {
    files: ['**/*.{js,cjs,mjs,jsx}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [...toolingFiles, 'jest.setup.js'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: [
      '**/*.config.{js,cjs}', 'scripts/**/*.{js,cjs}', 'plugins/**/*.js', 'jest.setup.js',
    ],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: toolingFiles,
    rules: { 'no-console': 'off' },
  },
  {
    files: [...testFiles, '**/*.{test,spec}.{js,jsx}', 'jest.setup.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  // The logger is the existing console boundary.
  { files: ['services/Logger.ts'], rules: { 'no-console': 'off' } },
  {
    files: ['test-utils/malformed.ts'],
    rules: {
      // Malformed test fixtures use this single assertion boundary.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as' }],
    },
  },
  {
    // Metro types bundled asset requires as any. Callers use typed constants.
    files: ['constants/Assets.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    // Cold-start sequencing depends on InteractionManager timing. Preserve
    // the existing exception until its replacement has device validation.
    files: ['app/_layout.tsx', 'app/(tabs)/index.tsx'],
    rules: { '@typescript-eslint/no-deprecated': 'off' },
  },
);

// Existing lint debt, including tests. Entries may only be removed.
// Regenerate with npm run lint:ratchet:update after fixing a file/rule pair.
// BEGIN LINT RATCHET
const lintRatchet = [
  {
    "files": [
      "components/ChangePinOverlay.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-imports": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    "files": [
      "components/PinEntryModal.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-imports": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    "files": [
      "components/QRLWebView.tsx"
    ],
    "rules": {
      "@typescript-eslint/no-unnecessary-condition": "off"
    }
  },
  {
    "files": [
      "components/QRScannerModal.tsx"
    ],
    "rules": {
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    "files": [
      "components/QuantumLoadingScreen.tsx"
    ],
    "rules": {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "react-hooks/refs": "off"
    }
  },
  {
    "files": [
      "services/EmbeddedNavigationPolicy.ts"
    ],
    "rules": {
      "@typescript-eslint/no-unnecessary-condition": "off"
    }
  },
  {
    "files": [
      "services/ForegroundAuthorization.ts"
    ],
    "rules": {
      "@typescript-eslint/no-unnecessary-condition": "off"
    }
  },
  {
    "files": [
      "services/NativeBridge.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-unnecessary-condition": "off"
    }
  },
  {
    "files": [
      "services/__tests__/BiometricService.foreground.test.ts"
    ],
    "rules": {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-enum-assignment": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/BiometricService.migration.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/BiometricService.pinChange.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/BiometricService.probe.test.ts"
    ],
    "rules": {
      "@typescript-eslint/no-unsafe-enum-assignment": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/BiometricService.promptLifecycle.test.ts"
    ],
    "rules": {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  },
  {
    "files": [
      "services/__tests__/ChangePinOverlay.test.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "no-restricted-syntax": "off"
    }
  },
  {
    "files": [
      "services/__tests__/DAppConnectionStore.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off"
    }
  },
  {
    "files": [
      "services/__tests__/DAppDeepLink.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off"
    }
  },
  {
    "files": [
      "services/__tests__/DeviceLoginState.test.ts"
    ],
    "rules": {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/Diagnostics.test.ts"
    ],
    "rules": {
      "@typescript-eslint/no-confusing-void-expression": "off"
    }
  },
  {
    "files": [
      "services/__tests__/EmbeddedStorageMigration.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "no-restricted-syntax": "off"
    }
  },
  {
    "files": [
      "services/__tests__/EmbeddedWalletDocument.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-call": "off"
    }
  },
  {
    "files": [
      "services/__tests__/EmbeddedWalletProfile.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "no-restricted-syntax": "off"
    }
  },
  {
    "files": [
      "services/__tests__/ForegroundAuthorization.test.ts"
    ],
    "rules": {
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/NativeBridge.correlation.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/NativeBridge.deviceCredential.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/NativeBridge.externalBoundary.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-restricted-syntax": "off"
    }
  },
  {
    "files": [
      "services/__tests__/NativeBridge.walletWipe.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/NativeConfig.security.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "no-restricted-syntax": "off"
    }
  },
  {
    "files": [
      "services/__tests__/NativeWalletProfile.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off"
    }
  },
  {
    "files": [
      "services/__tests__/QRLWebView.embedded.test.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-restricted-syntax": "off"
    }
  },
  {
    "files": [
      "services/__tests__/QRLWebView.lifecycle.test.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/QrlAddress.test.ts"
    ],
    "rules": {
      "@typescript-eslint/no-unnecessary-template-expression": "off"
    }
  },
  {
    "files": [
      "services/__tests__/SeedStorageService.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/require-await": "off"
    }
  },
  {
    "files": [
      "services/__tests__/WalletRemoval.test.ts"
    ],
    "rules": {
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/WalletScreen.deviceLoginSetup.test.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/WalletScreen.lifecycle.test.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/WalletScreen.promptReturn.test.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/WalletScreen.reauth.test.tsx"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    "files": [
      "services/__tests__/WebViewService.contacts.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off"
    }
  },
  {
    "files": [
      "services/__tests__/withBackgroundOnBack.test.ts"
    ],
    "rules": {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-regex-spaces": "off"
    }
  }
];
// END LINT RATCHET

module.exports = [...baseConfig, ...lintRatchet];
module.exports.baseConfig = baseConfig;
module.exports.lintRatchet = lintRatchet;
module.exports.strictFiles = strictFiles;

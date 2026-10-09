const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const globals = require('globals');

module.exports = [
  // Base JS/TS configuration
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '.expo/**', 'android/**', 'ios/**'],
  },
  
  // Main configuration for all files
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        __DEV__: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // No type laundering (owner mandate). Wire input is unknown and gets
      // runtime guards; assertions, any, non-null and ts-comments are errors.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],

      // React Native handler idioms: `onPress={() => setX(1)}` returns void by
      // design, and async handlers on JSX props and Alert button objects are
      // the norm (each body owns its try/catch). Floating promises and promise args elsewhere stay errors.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false, properties: false } }],

      // Defensive checks on native-module results are deliberate (same call as
      // the connect SDK profile).
      '@typescript-eslint/no-unnecessary-condition': 'off',

      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-require-imports': ['error', { 
        allow: ['\\.png$', '\\.jpg$', '\\.jpeg$', '\\.gif$', '\\.svg$', '\\.ttf$', '\\.otf$', '\\.woff$', '\\.woff2$'] 
      }],
      
      // React rules
      'react/prop-types': 'off', // TypeScript handles this
      'react/react-in-jsx-scope': 'off', // Not needed in React 17+
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      
      // General rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  
  // Test files specific config
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  
  // Plain JS (configs, scripts, plugins) is outside the TypeScript program's
  // type information; the type-aware rules cannot run there.
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Tests mock native modules and exercise malformed input, so assertions,
  // loose mock typing and async stubs are legitimate there. Production code
  // keeps the full rule set.
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', 'jest.setup.js'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-unnecessary-template-expression': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      'no-regex-spaces': 'off',
      '@typescript-eslint/no-unsafe-enum-assignment': 'off',
    },
  },

  // The logger is the one sanctioned console wrapper.
  {
    files: ['services/Logger.ts'],
    rules: { 'no-console': 'off' },
  },

  // Asset wrapper: Metro types `require()` of a bundled asset as `any`.
  // Nothing else in the app is exempt; every other file imports the typed
  // constants from here.
  {
    files: ['constants/Assets.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // Cold-start sequencing on iOS depends on InteractionManager timing (see the
  // comments at each call site). Replacing the deprecated API changes when
  // TurboModule work starts, so the migration needs a device test of its own.
  {
    files: ['app/_layout.tsx', 'app/(tabs)/index.tsx'],
    rules: { '@typescript-eslint/no-deprecated': 'off' },
  },

  // Config files - allow CommonJS require()
  {
    files: [
      'eslint.config.js',
      'metro.config.js',
      '**/*.config.js',
      '**/*.config.ts',
      'scripts/**/*.js',
      'plugins/**/*.js',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
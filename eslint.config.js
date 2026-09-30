import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/data/**',
      'apps/web/public/**',
      'packages/physics/src/frames/nut00b-data.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The physics core is pure: no wall-clock reads, no I/O.
    files: ['packages/physics/src/**/*.ts'],
    ignores: ['packages/physics/src/time/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Physics code must not read the wall clock. Take time from the master clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Physics code must not read the wall clock. Take time from the master clock.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Physics code must be deterministic: Math.random is forbidden.',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // The browser is a renderer, never the simulation engine (ADR 0002): it may use only the pure
      // clock helper from the physics package, never its scientific modules.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@simulation/physics',
              message:
                'The web app must not import the physics core. Use @simulation/physics/time only.',
            },
            {
              name: '@simulation/environment',
              message: 'The web app must not import the engine. Talk to the server API.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);

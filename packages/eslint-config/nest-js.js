import globals from 'globals';
import tseslint from 'typescript-eslint';

import baseConfig from './index.js';

/** @type {import("eslint").Linter.Config[]} */
export const nestJsConfig = tseslint.config(
  ...baseConfig,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
    },
  },
);

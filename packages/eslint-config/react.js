import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

import baseConfig from './index.js';

/** @type {import("eslint").Linter.Config[]} */
export default tseslint.config(...baseConfig, reactHooks.configs.flat.recommended, reactRefresh.configs.vite, {
  rules: {
    'react-refresh/only-export-components': 'off',
  },
});

import reactConfig from '@repo/eslint-config/react';

/** @type {import("eslint").Linter.Config[]} */
export default [...reactConfig, { ignores: ['dist/**', 'vite.config.ts', 'eslint.config.mjs'] }];

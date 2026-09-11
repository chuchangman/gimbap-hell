import organizeImportsPlugin from 'prettier-plugin-organize-imports';

// prettier-plugin-tailwindcss 는 "organize-imports 도 켜져 있나?" 를 각 플러그인의
// `.name` 으로 판별한다 (findEnabledPlugin). 그냥 import 하면 `.name` 이 없어서
// 못 찾고 parser 훅을 이어 붙이는 대신 덮어써 버린다. 이름을 직접 달아준다.
const organizeImports = { ...organizeImportsPlugin, name: 'prettier-plugin-organize-imports' };

/** @type {import("prettier").Config} */
export default {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  trailingComma: 'all',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  endOfLine: 'auto',
  plugins: [organizeImports],
};

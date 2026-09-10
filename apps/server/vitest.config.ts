import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig 의 "@/*" 별칭. Vite 가 이제 기본으로 지원하므로
  // vite-tsconfig-paths 플러그인 없이 옵션만 켠다.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    // 데코레이터 메타데이터. NestJS 런타임 밖에서 프로바이더를 import 할 때 필요하다.
    setupFiles: ['reflect-metadata'],
    root: './',
    include: ['**/*.spec.ts'],
  },
});

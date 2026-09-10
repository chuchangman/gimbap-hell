import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(import.meta.dirname, './src') }],
  },
  server: {
    host: '0.0.0.0',
    // 개발 중에는 API·소켓을 새 서버로 넘긴다 (레거시와 같은 3211 포트).
    proxy: {
      '/socket.io': { target: 'http://localhost:3211', ws: true },
      '/health': 'http://localhost:3211',
      '/ready': 'http://localhost:3211',
      '/leaderboard.json': 'http://localhost:3211',
      '/assets': 'http://localhost:3211',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // jsdom 에 없는 2D 캔버스를 결정적인 스텁으로 채운다 (레거시 Panel 이 쓴다)
    setupFiles: ['./src/testing/canvas-stub.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    /* 동등성 테스트가 레거시 public/js/*.js 를 그대로 읽는다.
       그쪽은 동봉한 vendor 사본을 절대경로로 import 하므로 여기서만 이어준다.
       앱 빌드에는 영향이 없다 (test 블록 안이다). */
    alias: [
      /* 레거시 모듈은 '@legacy/...' 로 부른다. 상대경로가 아니라
         비상대 지정자여야 TypeScript 가 앰비언트 선언
         (src/testing/legacy-modules.d.ts)을 써 준다. */
      {
        find: /^@legacy\//,
        replacement: path.resolve(import.meta.dirname, '../../public/js/') + '/',
      },
      { find: '/vendor/three.module.min.js', replacement: 'three' },
      {
        find: '/vendor/loaders/GLTFLoader.js',
        replacement: 'three/examples/jsm/loaders/GLTFLoader.js',
      },
      {
        find: '/vendor/utils/SkeletonUtils.js',
        replacement: 'three/examples/jsm/utils/SkeletonUtils.js',
      },
      {
        find: '/vendor/utils/BufferGeometryUtils.js',
        replacement: 'three/examples/jsm/utils/BufferGeometryUtils.js',
      },
    ],
  },
});

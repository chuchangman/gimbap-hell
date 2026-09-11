import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

/* 게임 에셋(GLB)은 `public/assets/` 에 있다 — Vite 의 기본 publicDir 이라
   빌드하면 그대로 `dist/assets/` 로 복사된다. 클라이언트가
   `/assets/manifest.json` 으로 찾으므로 경로가 바뀌면 안 되고,
   Vite 자기 산출물은 아래 `assetsDir` 로 갈라 둔다. */

export default defineConfig({
  plugins: [react()],
  build: {
    /* 기본값 'assets' 를 쓰면 publicDir 의 게임 에셋과 같은 폴더에 섞인다 */
    assetsDir: 'bundle',
  },
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(import.meta.dirname, './src') }],
  },
  server: {
    host: '0.0.0.0',
    // 개발 중에는 API·소켓을 서버로 넘긴다.
    proxy: {
      '/socket.io': { target: 'http://localhost:3211', ws: true },
      '/health': 'http://localhost:3211',
      '/ready': 'http://localhost:3211',
      '/leaderboard.json': 'http://localhost:3211',
      '/assets': 'http://localhost:3211',
    },
  },
});

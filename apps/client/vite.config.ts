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
    /* 기본 500kB 경고를 끈다. three 는 첫 화면부터 씬 전체를 그리는 데 필요해서
       더 쪼개도 초기 로딩이 줄지 않는다 — 청크만 늘고 요청 수가 는다.
       실제로 나가는 건 gzip 후 three 155kB + 앱 165kB 다. 이 수를 넘기면
       그때는 진짜 커진 것이니 경고가 다시 떠야 한다. */
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        /* three.js 는 번들의 대부분이고 거의 안 바뀐다. 앱 코드와 갈라 두면
           게임을 고쳐 배포해도 브라우저가 three 청크는 캐시에서 쓴다. */
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
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

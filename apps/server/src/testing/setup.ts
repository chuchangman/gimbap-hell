import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* 동등성 테스트가 레거시 leaderboard.mjs 를 호출한다. 그 모듈은
   GIMBAP_LEADERBOARD 가 없으면 저장소를 repo 의 data/leaderboard.json 으로
   잡고 add() 마다 실제로 파일을 쓴다 — 진짜 기록을 건드리게 된다.
   저장소는 첫 호출에 메모이즈되므로 spec 파일보다 먼저 여기서 경로를 돌린다.

   워커마다 별도 폴더를 쓴다 (vitest 는 테스트 파일을 병렬로 돌린다). */
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gimbap-test-ranking-'));
process.env.GIMBAP_LEADERBOARD = path.join(folder, 'leaderboard.json');
// 실수로 실제 Redis 로 나가지 않도록 자격증명도 비운다.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

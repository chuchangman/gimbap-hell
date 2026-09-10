# 프론트엔드 / 백엔드 분리 리팩토링 계획

브랜치: `refactor/fe-be-split` (main 에서 분기)
목표: **현재 기능을 하나도 잃지 않으면서** 하나의 `.mjs` 덩어리를
프론트엔드(React + R3F)와 백엔드(TypeScript)로 나눈다.

배포 영향 없음 — `.github/workflows/ci.yml` 의 deploy 잡은
`github.ref == 'refs/heads/main'` 일 때만 돌고 `render.yaml` 은 `autoDeploy: false` 다.
이 브랜치를 푸시해도 운영 배포는 나가지 않는다.

## 기준선 (2026-09-10)

- `npm test` → **58/58 통과**. 이 숫자가 떨어지면 그 단계는 실패다.
- 코드 규모: `server/*.mjs` 2,014줄 · `public/js/*.js` 5,712줄 ·
  `public/index.html` 298줄 · `public/css/style.css` 618줄 · `test/*.mjs` 1,811줄.
- 이미 공유되고 있는 계약: 서버가 `public/js/` 의 `config.js` · `game-rules.js` ·
  `spatial.js` 를 직접 import 한다. 이 경계가 그대로 공용 패키지가 된다.

## 무엇에 맞추는가

`~/Desktop/S15P21M101/web` 이 같은 팀의 현행 컨벤션이다. 거기에 맞춘다.

| 항목 | 참고 프로젝트 | 여기 |
|---|---|---|
| 구조 | `apps/{client,server}` + `packages/*` | 같음 |
| 패키지 스코프 | `@repo/*` | 같음 |
| 클라이언트 | React 19 · Vite · R3F(`@react-three/fiber` 9 / `drei` 10) · three 0.185 | 같음 (동봉 vendor 도 r185) |
| 서버 | NestJS 12 · `@nestjs/platform-socket.io` · vitest | 같음 |
| 태스크 러너 | turbo | 같음 |
| 포맷/린트 | prettier 100칸 · single quote · trailing comma / eslint flat config | 같음 |
| 패키지 매니저 | pnpm 11 | **npm workspaces** (아래 참고) |

**한 가지 다른 점 — 패키지 매니저.** 이 PC 에는 pnpm 이 없고, Node 26 에서
corepack 이 빠져 전역 설치가 필요하다. 게다가 Render 배포가 `npm ci` 로 묶여 있다.
구조·이름·프레임워크는 그대로 맞추고 패키지 매니저만 npm workspaces 를 쓴다.
나중에 pnpm 으로 바꾸는 건 `pnpm-workspace.yaml` 한 장이면 된다.

## 안전 장치 — 레거시를 먼저 지우지 않는다

새 스택이 같은 동작을 증명하기 전에는 `server/` · `public/` · `test/` 를 건드리지 않는다.
두 스택이 공존하는 동안 **동등성 테스트**가 값이 벌어지는 걸 막는다.

- `packages/game-core` 는 `public/js/config.js` 등의 TypeScript 이식본이다.
- `test/parity.test.mjs` 가 두 쪽의 상수·함수 결과가 같은지 비교한다.
- 레거시 58개 테스트는 마지막 단계까지 계속 통과해야 한다.

## 단계

### 1. 워크스페이스 뼈대  — `상태: 완료`
- [x] 루트 npm workspaces + turbo + prettier
- [x] `@repo/typescript-config` (base / react-library / vite / nest)
- [x] `@repo/eslint-config` (base / react / nest-js / prettier-base)
- [x] 레거시 `npm test` 가 그대로 통과하는지 확인

### 2. 공용 계약 패키지 — `상태: 완료`
- [x] `@repo/game-core` — `config.js` · `game-rules.js` · `spatial.js` ·
      `kitchen-layout.js` · `render-config.js` 를 TS 로 이식 (12개 모듈)
- [x] `@repo/types` — 소켓 와이어 타입 (`state` · `kitchen` · `positions` · 이벤트 페이로드,
      `ServerToClientEvents` / `ClientToServerEvents`, `/health` 응답)
- [x] `test/parity.test.mjs` — 레거시 JS 와 새 TS 의 값이 같음을 고정.
      상수 전량 + 함수 26종을 약 2,000개 입력으로 훑는다
      (`clearPosition` 은 37×45 격자 1,665점).
- [x] 레거시 58 + 동등성 12 = **70개 통과**. typecheck · lint · prettier 통과.

`render-utils.js` 는 three.js 객체를 받으므로 공용 패키지에 넣지 않았다.
서버는 이 함수를 쓰지 않는다 — 4단계에서 `apps/client` 로 옮긴다.

`npm test` 앞에 `pretest: turbo run build` 를 달았다. `dist/` 는 커밋하지 않으므로
테스트가 스스로 빌드해야 하고, turbo 캐시가 있어 두 번째부터는 즉시 끝난다.
turbo 2.10 이 워크스페이스를 찾으려면 `packageManager` 필드가 필요해 함께 넣었다.

### 3. 백엔드 `apps/server` — `상태: 대기`
- [ ] NestJS 12 뼈대 (`main.ts` · `AppModule` · config)
- [ ] `RoomsService`(Room) · `KitchenService` · `WaveService` · `MovementService`
- [ ] `GameGateway` — 지금과 **완전히 같은** 이벤트/페이로드
      (`hello` `state` `kitchen` `positions` `toast` `waveEnd` `swing` `hit`
       `position:correct` `server:closing`)
- [ ] 소켓 어댑터 — origin 검사 · connectionStateRecovery · 레이트 리밋
- [ ] `LeaderboardService` + `RankingStore` (파일 / Upstash Redis)
- [ ] `HealthController` (`/health` `/ready` `/leaderboard.json`)
- [ ] 정적 서빙 — Vite 빌드 산출물 + 기존 CSP/ETag/압축 정책 유지
- [ ] 레거시 `test/*.mjs` 시나리오를 vitest 로 이식 (58개 전부)

### 4. 프론트엔드 `apps/client` — `상태: 대기`
- [ ] Vite + React 19 + TS 뼈대, `@/` alias
- [ ] `features/net` — 소켓 훅 (`net.js` 이식: 보간·시계 동기·복구)
- [ ] `features/world` — R3F 씬 (`world.js` 2,975줄 → 컴포넌트 분해)
- [ ] `features/player` — 1인칭 이동·충돌·조준 (`player.js`)
- [ ] `features/kitchen` — 상호작용 해석 (`kitchen.js`)
- [ ] `features/ui` — HUD · 로비 · 주문서 · 결과 · 랭킹 (`ui.js` + `index.html` + `style.css`)
- [ ] `features/customize` — 캐릭터 커스터마이즈 (`customize.js`)
- [ ] `features/assets` — GLB 로더 (`assets.js`)

### 5. 동등성 검증과 마무리 — `상태: 대기`
- [ ] 브라우저 QA (`tools/release-browser-qa.cjs`) 를 새 스택 기준으로 통과
- [ ] 새 스택 + 레거시 동시 실행 비교 (같은 방, 같은 조작, 같은 결과)
- [ ] CI 워크플로에 워크스페이스 잡 추가
- [ ] Render 배포 설정 갱신 (빌드: 클라이언트 build → 서버 build)
- [ ] 레거시 `server/` · `public/js/` · `test/*.mjs` 제거

## 완료 조건

`apps/server` 와 `apps/client` 만으로 지금 게임이 **똑같이** 돌아간다.
README 의 조작·웨이브·공정·랭킹·복구 동작이 전부 살아 있고,
58개 시나리오에 해당하는 검증이 새 스택에서 통과한다.

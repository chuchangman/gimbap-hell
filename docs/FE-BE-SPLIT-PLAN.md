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

### 3. 백엔드 `apps/server` — `상태: 진행 중`

순수 로직을 먼저 옮기고 Nest 배선을 뒤에 붙인다. 방마다 인스턴스가 하나씩
필요한 `Room` · `Kitchen` · `WaveRunner` 는 Nest 프로바이더가 아니라 순수
클래스로 둔다 (프로바이더는 기본이 싱글턴이다). 이들을 들고 있는
`RoomsService` 만 `@Injectable()` 이다.

- [x] NestJS 12 뼈대 — `main.ts` · `AppModule` · `ConfigModule` 에
      `registerAs('runtime', …)` 로 운영 설정 주입. 실제로 뜨고 listen 한다.
- [x] `config/runtime.config.ts` — `runtime-config.mjs` 이식. PORT 0 · 빈 문자열 ·
      16진수 표기 · recovery 의 Number-or-default 순서를 spec 으로 고정했다.
- [x] `common/protocol.ts` — `protocol.mjs` 이식 (와이어 검증 · 토큰 버킷 · origin).
- [x] `domain/movement.ts` — `movement.mjs` 이식 (속도·공중시간·충돌 판정).
- [x] `modules/leaderboard/ranking-policy.ts` — 재시도 정책 이식.
- [x] 위 4개 모듈의 **레거시 대조 spec** 27개 통과. 값 비교가 아니라
      "레거시와 같은 답을 내는가" 를 훑는다 (protocol 은 액션 21종 × 필드 7종 ×
      값 21종, movement 는 점프·넉백·벽 통과·적립 시나리오를 프레임 단위로).
- [x] `domain/kitchen.ts` — `kitchen.mjs` 이식 (공정 상태 머신). 200줄짜리
      switch 를 설비별 private 메서드로 갈랐다. 검사 **순서**는 그대로다 —
      `sink:take` 가 손을 먼저 보고 `burner:take` 가 화구를 먼저 보는 차이까지 지켰다.
      시계를 주입할 수 있게 해서 테스트가 가짜 타이머로 묶는다.
- [x] `domain/waves.ts` — `waves.mjs` 이식 (손님·주문·인내심). 시계와 **난수**를
      주입할 수 있게 했다. 난수 소비 **순서**가 곧 이식 정확도다 — 객체 리터럴에서
      `id` 가 uid 를 올린 뒤 `seed` 가 올라간 uid 를 읽는 순서까지 지켰다.
- [x] `domain/room.ts` + `modules/game/rooms.service.ts` — `room.mjs` 이식.
      랭킹은 `RoomLeaderboard` 인터페이스로 역전시켜 주입한다 —
      `LeaderboardService` 가 이 모양을 만족하고, 테스트는 레거시 모듈을 꽂는다.
      시계와 난수도 주입 가능하다.
- [x] `GameGateway` + `GameLoopService` — 지금과 **완전히 같은** 이벤트/페이로드
      (`hello` `state` `kitchen` `positions` `toast` `waveEnd` `swing` `hit`
       `position:correct` `server:closing`). 틱 두 개(200ms 상태 · 67ms 위치)와
      서명 기반 중복 제거, volatile 위치 전송까지 그대로다.
- [x] 소켓 어댑터 — origin 검사 · connectionStateRecovery · 수용량 · 레이트 리밋
- [x] `LeaderboardService` + `RankingStore` (파일 / Upstash Redis).
      `Room` 이 랭킹을 의존하므로 순서를 앞으로 당겼다.
      저장소는 클로저 팩토리 형태를 그대로 유지했다 — 파일 원자성 · 저널 ·
      재시도 타이머가 얽혀 있어 클래스로 재구성하면 순서를 놓치기 쉽다.
      `RankingStore<T>` 로 제네릭화해 캐스팅 없이 `LeaderboardRow` 를 다룬다.
- [x] `HealthController` (`/health` `/ready` `/leaderboard.json`) — 이벤트 루프
      지연 · rss · 저장소 상태 · rejected 카운터까지 레거시와 같은 필드다.
- [x] 정적 서빙 — `http.mjs` 이식. CSP importmap sha256 해시 · ETag/304 ·
      brotli/gzip · 경로 이탈 차단 · HEAD 를 그대로 유지한다.
      **지금은 레거시 `public/` 을 서빙한다** (`GIMBAP_PUBLIC_ROOT`).
      4단계에서 `apps/client/dist` 로 옮긴다.
- [x] 레거시 소켓 통합 시나리오 9개를 vitest 로 이식하고 **새 서버에서 통과**
      (`src/game.integration.spec.ts`). 실제 자식 프로세스를 띄우고 실제
      socket.io 클라이언트로 붙는다.
- [ ] 나머지 레거시 `test/*.mjs` 시나리오 이식 (주방/웨이브/랭킹은 이미
      단위 spec 으로 덮였고, `smoke.mjs` 와 QA 픽스처가 남았다)

**주방 차분 테스트.** 분기가 많은 상태 머신은 손으로 쓴 사례로 안 덮인다.
레거시 `Kitchen` 과 새 `Kitchen` 을 같은 동작 열 4,000회로 나란히 돌리고
매 단계 반환값과 스냅샷 전체를 비교한다.

여기서 커버리지 단정이 실제 구멍을 잡았다 — 순수 무작위로는 `mat:roll` 과
`mat:take` 가 **한 번도 성공하지 못했다.** 밥이 나오려면 쌀 · 헹굼 5회 ·
취사 10초가 한 조립대에 정확히 모여야 하는데 무작위로는 그 정렬이 안 생긴다.
두 구현이 나란히 전부 거절하면 `toEqual` 은 그냥 통과하므로, 1000 스텝마다
실제 공정 한 줄을 큐에 밀어 넣어 깊은 상태까지 밟게 했다. 이제 17개 액션이
전부 성공 경로와 거절 경로를 밟고, 취사·조리·말기·빗자루 상태가 모두 등장한다.

전체 공정 테스트에도 같은 방어를 넣었다. 손에 완성 김밥이 있고 속에 햄이
들어 있고 밥솥에 3인분이 남았다는 것까지 단정한다 — 양쪽이 똑같이 실패해도
통과하는 테스트는 없는 것보다 나쁘다.

**웨이브 차분 테스트.** 손님 생성에 난수가 섞여 있어, 두 구현이 난수를
**같은 순서로 같은 횟수** 소비하는지가 곧 이식 정확도다. 같은 씨앗의 독립
생성기를 둘 만들어 하나는 새 구현에 주입하고 하나는 `Math.random` 스파이로
꽂는다. 순서가 한 번이라도 어긋나면 손님 외형과 주문 조합부터 갈라진다.

인원 1·3·6명으로 10웨이브를 끝까지 돌리고 매 틱 이벤트와 스냅샷 전체를
비교한다. 여기서도 커버리지 단정이 구멍 세 개를 연달아 잡았다.

1. 서빙을 하면 평판이 버텨 게임이 20분 넘게 이어지는데, 4,000틱(800초)
   상한으로는 10웨이브를 못 끝내고 있었다.
2. 손님을 한 대씩만 때리면 서빙이 먼저 끝나 **체력 0 격퇴 경로**
   (점수 -25 · 평판 -6)를 한 번도 밟지 못했다.
3. 서빙을 타격보다 먼저 하면 주문이 1줄이라 손님이 그 자리에서 `happy` 가
   되어 때릴 대상이 아예 남지 않았다.

지금은 6종 이벤트가 모두 등장하고 `happy` · `kicked` · `servedRolls` 가
모두 0보다 크며, 최종 점수와 평판까지 레거시와 일치한다.

**`Math` 전개 함정.** `vi.stubGlobal('Math', {...Math, random})` 는 안 된다.
`Math` 의 메서드는 열거 불가라 전개로 복사되지 않아 `Math.max` 부터 사라진다.
`vi.spyOn(Math, 'random')` 으로 필요한 것만 바꿔 끼운다.

**테스트가 실제 랭킹을 건드리던 문제.** 동등성 spec 이 레거시
`leaderboard.mjs` 의 `add()` 를 호출하는데, 그 모듈은 `GIMBAP_LEADERBOARD` 가
없으면 저장소를 저장소 안 `data/leaderboard.json` 으로 잡고 매번 **실제로
파일을 쓴다.** 저장소 인스턴스는 첫 호출에 메모이즈되므로,
`src/testing/setup.ts` 를 vitest `setupFiles` 에 걸어 spec 보다 먼저 경로를
임시 폴더로 돌리고 Upstash 자격증명도 비운다. 테스트 후 실제 파일이
7,855바이트 · 29건 · mtime 그대로임을 확인했다.

**저장소 시나리오 9개**는 차분 테스트로 묶지 않았다. 파일 원자성 · 재시도
타이머 · 저널이 섞여 있어 두 인스턴스를 나란히 돌리면 같은 경로를 두 번 쓴다.
대신 레거시 `test/ranking-store.test.mjs` 의 단정을 그대로 옮기고
(깨진 파일을 덮지 않음 · 쓰기 직렬화 · 응답 유실 재시도 멱등성 · 저널로
프로세스 재시작 생존 · 타임아웃 중단), 순수 `mergeRankings` 와 Lua 문자열만
레거시와 대조한다.

**Room 차분 테스트에서 잡은 것들.** Room 은 주방·웨이브·이동·전투·랭킹을
묶는 조립점이라 조작 열을 흘리며 `publicState` · `kitchenState` · `positions` ·
`stateSignature` 를 매 단계 전부 비교한다. 여기서 **테스트가 조용히 통과하던
경로 두 개**를 찾았다.

1. 스폰(-1.6, 5.6)에서 왼쪽 설비로 직진하면 **조립대 테이블**
   (x -2.6..2.6, z 1.75..3.45)에 막힌다. 걷기가 도착하지 못했고 이후 모든
   동작이 양쪽에서 나란히 "가까이 오세요" 로 거절되며 통과하고 있었다.
   통로 `x=-4.5` 로 우회시키고, `walkTo` 가 **도착 자체를 단정**하게 했다.
2. `performance.now` 를 상수로 스파이하니 `validateMove` 의 `elapsed` 가 항상
   0이 되어 이동 토큰이 회복되지 않았다. 다섯 걸음(1.5m)에서 속도 제한에
   걸려 멈췄는데, 역시 양쪽이 나란히 막혀 통과했다. 단조 시계를 가짜 타이머와
   같은 양만큼 함께 전진시킨다.

지금은 각 단계가 의도한 결과를 냈는지도 함께 못 박는다 — 쌀을 실제로 들었고,
5번째 헹굼에 완료 문구가 뜨고, 취사가 5인분을 내고, 김 없이 밥을 올리면
거절되고, 바닥에 버리면 `mess` 가 1이 된다.

게임 오버 결과는 랭킹에서 온 값(`entryId` · `rank` · `board` · `storage`)을
빼고 비교한다. 두 방이 각각 `add()` 를 호출해 UUID 가 달라지기 때문이다.
점수 계산(`score = max(0, rawScore - mess×5)`)과 집계는 전부 단정한다.

**중간 목표 달성 — 새 서버가 레거시 클라이언트를 그대로 돌린다.**
`apps/server` 가 `public/` 을 서빙하고 레거시 소켓 계약을 모두 지킨다.
레거시 `test/server.integration.test.mjs` 의 9개 시나리오가 새 서버에서
그대로 통과한다: 원시 경로 이탈 차단 6종 · 304 재검증 · gzip · glb MIME ·
HEAD · 6인 정원 · 방장 권한 · 해금 · 레이트 리밋 · 오리진 거부 ·
연결 복구 · 근접 검사 우회 차단.

**Nest 덕타이핑 함정 — 끊김 핸들러가 두 번 돌았다.** 메서드 이름을
`handleDisconnect` 로 두면 Nest 가 이름만 보고 `OnGatewayDisconnect` 로
간주해 자기 리스너를 하나 더 붙인다. 우리는 `reason` 이 필요해서
`socket.on('disconnect')` 를 직접 등록했는데, 그 결과 한 번의 끊김에 핸들러가
두 번 돌았다. 두 번째 호출은 이미 일시정지된 상태를 보고 `autoPaused=false` 로
`pendingRecovery` 를 덮어써서, **방장이 복귀해도 일시정지가 풀리지 않았다.**
메서드 이름을 `onSocketDisconnect` 로 바꿔 Nest 가 잡지 못하게 했다.
통합 테스트가 이걸 잡았다 — 단위 테스트로는 드러나지 않는 종류의 결함이다.

**통합 테스트에 와이어 타입을 붙였다.** `any` 로 두면 `no-unsafe-*` 경고 91개가
나는데, 억제하는 대신 `@repo/types` 의 `PublicState` · `KitchenSnapshot` ·
`HelloPayload` · `RoomAck` · `HealthResponse` 를 붙였다. 서버가 보내는 형태가
바뀌면 이 테스트가 컴파일 단계에서 먼저 깨진다.

**레거시 대조 브리지.** `src/testing/legacy.ts` 가 `server/*.mjs` 를 읽는다.
타입 선언이 없어 정적 import 는 strict 에서 TS7016 으로 막히므로 지정자를
변수로 넘긴다. 이 파일의 인터페이스 목록이 곧 "아직 이식하지 못한 레거시
표면" 이다. 5단계에서 레거시와 함께 사라진다.

**알려진 권고.** `@nestjs/platform-express@12.0.1` 이 `multer` 를 `2.2.0` 으로
**정확히 고정**해 끌고 오는데, 이 버전에 DoS 권고 4건이 있다. 이 게임 서버에는
멀티파트 업로드 라우트가 없어(`FileInterceptor` 를 쓰는 핸들러가 없다) 취약
경로에 닿지 않는다. `overrides` 로 2.3.0 을 밀어넣어 봤지만 정확 고정과 충돌해
`npm ls` 가 invalid 로 남아 되돌렸다. 프레임워크가 핀을 올릴 때 함께 올린다.

### 4. 프론트엔드 `apps/client` — `상태: 진행 중`

**접근법: 충실한 이식(A).** 사용자 선택. `world.js` 의 GLB 로딩 · 저폴리 조형 ·
표정 시스템 · 틴트를 R3F 안으로 1:1 옮긴다. 씬 그래프를 선언적 JSX 로 다시
짜는 쪽(B)이 참고 프로젝트에 더 가깝지만, 조형 좌표가 미묘하게 달라져
"화면이 그대로"를 보장할 수 없다. 발표에 쓰는 화면이라 A 로 간다.

- [x] Vite 8 + React 19 + TS 뼈대, `@/` alias, dev proxy(소켓·/assets → 3211)
- [x] `features/net` — `net.js` 이식. 공유 상태 `S` 는 모듈 싱글턴으로 남긴다 —
      위치는 15Hz 로 들어오고 화면은 60Hz 이상이라 React state 로 두면
      초당 수십 번 리렌더가 난다. UI 가 필요한 값만 따로 꺼내 간다.
- [x] `features/net/interpolation.ts` — 레거시 net.js 안에서 모듈 전역이라
      테스트가 닿지 못했던 보간 버퍼를 순수 모듈로 뺐다. 알고리즘은 그대로다.
      눈에 잘 안 보이는 규칙 셋을 spec 으로 고정했다: 자리를 새 사람이
      물려받으면 옛 표본 버리기 · 늦게 온 패킷 버리기 · 오래된 표본을 정리하되
      앞뒤 두 개는 남기기(없는 미래를 지어내지 않도록). 9개 통과.
- [ ] `features/world` — R3F 씬 (`world.js` 2,975줄 → 컴포넌트 분해)
- [ ] `features/player` — 1인칭 이동·충돌·조준 (`player.js`)
- [ ] `features/kitchen` — 상호작용 해석 (`kitchen.js`)
- [ ] `features/ui` — HUD · 로비 · 주문서 · 결과 · 랭킹 (`ui.js` + `index.html` + `style.css`).
      CSS 는 Tailwind 로 다시 쓰지 않고 `style.css` 618줄을 그대로 옮긴다 —
      참고 프로젝트는 Tailwind 지만, 다시 쓰면 화면이 미묘하게 달라진다.
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

---

## 다음 세션 시작점 (2026-09-10 17:50 중단)

브랜치 `refactor/fe-be-split`, 커밋 9개, **푸시 안 함**. 워킹 트리 깨끗.
중단 시점 검증: 레거시 58 + 동등성 12 + 서버 65 + 클라이언트 9 = **144개 통과**,
build · typecheck · lint · prettier 전부 통과.

### 다시 시작하는 방법

```bash
git switch refactor/fe-be-split
npm install              # 워크스페이스 링크 (이미 되어 있으면 빨리 끝난다)
npm test                 # 레거시 58 + 동등성 12
npm run test:workspaces  # 서버 65 + 클라이언트 9 (turbo)
```

새 서버로 게임을 직접 띄워 보려면:

```bash
npm run build --workspace=@repo/server
node apps/server/dist/main.js     # 저장소 루트에서 띄워야 data/·public/ 이 맞는다
# → http://localhost:3211 에서 레거시 클라이언트가 새 백엔드로 돌아간다
```

### 바로 다음에 할 일 — 4단계 두 번째 슬라이스

1. `features/assets` — `public/js/assets.js` (211줄) 이식.
   GLB 매니페스트 로딩과 `asset()` · `partOf()` 조회. 에셋 161개가
   `public/assets/manifest.json` 에 등록되어 있고 56개 항목의 파일 존재는
   이미 확인된 상태다.
2. `features/world` — `public/js/world.js` (2,975줄). 가장 큰 덩어리다.
   충실한 이식(A)이므로 명령형 조형 코드를 `useMemo` 로 한 번 만들고
   `<primitive object={...} />` 로 붙이는 방식이 기본이다.
   덩어리별로 나눠 커밋할 것: 주방 설비 → 캐릭터/표정 → 재료/음식 → 손님.

### 남은 순서

`assets` → `world` → `player` → `kitchen` → `ui` → `customize` → 5단계
(브라우저 QA · CI 잡 추가 · Render 설정 · 레거시 제거).

### 잊지 말 것

- 레거시 `server/` · `public/` 은 **아직 지우지 않는다.** 동등성 테스트가
  그걸 읽어 대조한다. 지우는 건 5단계 마지막이다.
- `apps/server/src/testing/legacy.ts` 의 인터페이스 목록이 "아직 레거시에
  의존하는 표면" 이다. 5단계에서 이 파일이 비면 이식이 끝난 것이다.
- Node 는 `>=22.12.0` 로 올려 뒀지만 `render.yaml` 은 아직 `20.20.2` 다.
  CI 워크플로도 node 20 이다. 5단계에서 함께 올린다.
- 랭킹 파일 경로: 레거시는 모듈 위치 기준, 새 서버는 **cwd 기준**이다.
  저장소 루트에서 띄우면 같은 파일이고, 시작 로그에 실제 경로를 찍는다.

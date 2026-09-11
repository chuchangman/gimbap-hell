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

| 항목          | 참고 프로젝트                                                           | 여기                           |
| ------------- | ----------------------------------------------------------------------- | ------------------------------ |
| 구조          | `apps/{client,server}` + `packages/*`                                   | 같음                           |
| 패키지 스코프 | `@repo/*`                                                               | 같음                           |
| 클라이언트    | React 19 · Vite · R3F(`@react-three/fiber` 9 / `drei` 10) · three 0.185 | 같음 (동봉 vendor 도 r185)     |
| 서버          | NestJS 12 · `@nestjs/platform-socket.io` · vitest                       | 같음                           |
| 태스크 러너   | turbo                                                                   | 같음                           |
| 포맷/린트     | prettier 100칸 · single quote · trailing comma / eslint flat config     | 같음                           |
| 패키지 매니저 | pnpm 11                                                                 | **npm workspaces** (아래 참고) |

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

### 1. 워크스페이스 뼈대 — `상태: 완료`

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

**800줄 기하 코드는 손으로 옮기지 않았다.** 방·설비 구간은 좌표가 촘촘한
순수 명령형 코드다. 손으로 다시 타이핑하면 오타 하나가 조용히 섞이는데,
그게 정확히 이 작업의 가장 큰 위험이다. 그래서 원본 구간을 **잘라내 기계적으로
변환**했다 — 임포트 헤더를 붙이고, export 를 달고, 매개변수 타입을 붙이고,
타입 오류 187개를 0까지 줄였다. 전사 오류가 원리적으로 생기지 않는다.

정확성은 씬 전체 대조가 증명한다. `initWorld` 이 지은 메시 300개 이상을
좌표·회전·배율·정점·재질까지 통째로 비교하고, 배경색·안개·조준 대상의
순서와 데이터·그림자 플래그까지 함께 못 박는다. 두 씬이 서로 다른 객체인지도
단정한다 — 같은 객체를 자기 자신과 비교하면 무조건 통과하기 때문이다.

레거시가 쓰던 쉼표 연산자(`if (bm) a, b;`) 한 곳만 블록으로 바꿨다.
동작은 같고 린트가 잡아서다.

**월드 이식의 검증 방법 — 눈이 아니라 정점으로 본다.**
탐침으로 확인한 것: 레거시 `world.js` 는 jsdom 에서 그대로 import 되고
`makeItemMesh` · `previewBody` 가 캔버스 없이 실행된다. 그래서 2,975줄을
"화면을 봐서" 가 아니라 **같은 입력으로 만든 메시 트리를 통째로 비교**해
검증할 수 있다.

`src/testing/mesh-snapshot.ts` 가 그 도구다. 객체 트리를 좌표 · 회전 · 배율 ·
지오메트리 정점(또는 파라미터) · 재질 색 · 투명도까지 뽑아 deepEqual 로 견준다.
부동소수는 6자리에서 반올림한다 — 같은 식을 다른 순서로 계산하면 마지막
비트가 갈릴 수 있는데 화면에서는 의미가 없다.

`countMeshes` 로 "정말 뭔가 만들어졌는지" 도 함께 단정한다. 양쪽이 나란히
빈 그룹을 내면 `toEqual` 은 그냥 통과하기 때문이다.

**5만 줄 트리에서 차이를 찾는 법.** 씬 스냅샷이 55,000줄이라 vitest 의 diff 가
잘려서 "어디가 다른지" 를 알 수 없었다. `firstDifference(a, b)` 를 만들어 처음
갈리는 경로를 짚게 했다.

첫 사용에서 바로 원인이 나왔다 —
`$.children[304].children[0].children[12].children[0].scale[0]: 1.177185 vs null`.
손님 테두리 배율이 레거시에서만 NaN 이었고, 범인은 이식본이 아니라 **내가 만든
가짜 렌더러**였다. 레거시 `syncCustomers` 가
`renderer.domElement.clientHeight` 로 화면 픽셀 기준 두께를 환산하는데,
스텁의 `domElement` 가 비어 있어 `Math.max(1, undefined)` 가 NaN 이 됐다.
스텁에 실제 값을 넣어 해결했다. 이식본 쪽은 `scene.setViewportHeight()` 로
R3F 캔버스가 높이를 알려주게 했다 — 렌더러를 직접 들고 있지 않기 때문이다.

**클라이언트 쪽 레거시 대조 브리지.** 서버와 사정이 다르다. 서버는 지정자를
변수로 넘겨 TS7016 을 피했지만, 클라이언트는 레거시 모듈이 동봉 vendor 사본을
절대경로로 import 하므로 Vite 가 변환해 줘야 한다 — 동적 import 로는 별칭이
안 걸린다. 그래서 비상대 지정자 `@legacy/...` 로 부르고,
`src/testing/legacy-modules.d.ts` 의 앰비언트 선언이 타입을,
`vite.config` 의 `test.alias` 가 실제 파일 연결을 맡는다. 앱 빌드에는 영향이 없다.

**레거시 대조 브리지.** `src/testing/legacy.ts` 가 `server/*.mjs` 를 읽는다.
타입 선언이 없어 정적 import 는 strict 에서 TS7016 으로 막히므로 지정자를
변수로 넘긴다. 이 파일의 인터페이스 목록이 곧 "아직 이식하지 못한 레거시
표면" 이다. 5단계에서 레거시와 함께 사라진다.

**알려진 권고.** `@nestjs/platform-express@12.0.1` 이 `multer` 를 `2.2.0` 으로
**정확히 고정**해 끌고 오는데, 이 버전에 DoS 권고 4건이 있다. 이 게임 서버에는
멀티파트 업로드 라우트가 없어(`FileInterceptor` 를 쓰는 핸들러가 없다) 취약
경로에 닿지 않는다. `overrides` 로 2.3.0 을 밀어넣어 봤지만 정확 고정과 충돌해
`npm ls` 가 invalid 로 남아 되돌렸다. 프레임워크가 핀을 올릴 때 함께 올린다.

### 4. 프론트엔드 `apps/client` — `상태: 완료`

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
- [x] `features/world` — `world.js` 2,975줄. 6개 슬라이스로 나눴다.
  - [x] **기반** — `scene` · `geometry`(모서리 깎은 상자) · `materials`(공유 재질) ·
        `primitives`(box/cap/cyl/dispose/station/hitProxy)
  - [x] **음식/재료** — `fillPiece` · `fillLaid` · `rollFace` · `gimbapSlice` ·
        `makeItemMesh`. 레거시와 **정점 단위로 대조**해 통과.
  - [x] **방/설비** — `panel`(캔버스 라벨/게이지) · `street`(통창 밖 거리) ·
        `room`(방·조명·안개·간판·조리대) · `stations`(냉장고·싱크대·밥솥·가스렌지·
        도마·조립대·음쓰통·빗자루·서빙대) · `hand`(1인칭 손·팔) · `registry`.
        **씬 전체(메시 300개 이상)를 레거시와 정점까지 대조**해 통과.
  - [x] **설비 동기화** — `syncFridge` · `syncSink` · `syncCookers` · `syncBurners` ·
        `syncBoards` · `syncMats` · `syncBrooms` + `tint`(render-utils 이식).
  - [x] **캐릭터/표정** — `makeBody` · `makeFace` · `setFace` · `buildHair` ·
        `buildFaceStyle` · `buildTop` · `customerLook` · `applyLook` ·
        `accessorize` · `poseLimbs` · `makeOutline` · `makeHpBar` · 미리보기.
        `previewBody` 로 **조합을 축별로 바꿔가며 레거시와 정점 대조** —
        머리 9 · 얼굴 5 · 표정 8 · 상의 6 · 하의 3 · 색 팔레트 전부,
        혼합 3종, 망가진 조합 4종, 걷기/들기 애니메이션 6시점 × 4모드.
  - [x] **손님 · 원격 플레이어 · 렌더 루프** — `makeCustomer` · `customerPos` ·
        `syncCustomers` · `makeAvatar` · `updateRemotes` · `remoteSwing` ·
        `stepWorld`(= 레거시 `render` 에서 `renderer.render` 만 뺀 것).
        `customerLook` · `makeOutline` · `makeHpBar` 도 여기서 씬 대조로 검증됐다.

**`world.js` 2,975줄 이식 완료.** 한 프레임 돌린 뒤 씬 전체를 비교한다 —
손님 2명 + 설비 전부 + 손에 든 김밥이 있는 프레임을 3프레임 연속으로,
손님 상태 5종(입장·대기·만족·화남·쫓겨남) 각각, 빗자루 스윙 on/off,
손님이 사라진 뒤 정리까지.

- [x] `features/player` — `player.js` 이식 (1인칭 이동 · 충돌 · 조준 · 스윙).
      메시가 아니라 **같은 입력에 같은 자세**로 검증한다. 두 구현이 같은 jsdom
      document 에 리스너를 달아서 키 이벤트 한 번에 양쪽이 함께 반응한다 —
      입력 경로까지 같이 검증된다. WASD 4방향 · 달리기+대각+점프 · 시점 4각도 ·
      벽 충돌 120프레임 · 넉백 포물선 60프레임 · 서버 보정 · 동료 충돌 ·
      로비/오버레이 차단, 그리고 **이동 패킷의 시점과 내용**까지 비교한다.
- [x] `features/kitchen` — `kitchen.js` 이식 (상호작용 해석 · 진행도 조회).
      `world` 의 `sync*` 와 손님 슬라이스가 `focusNow` · `unlockedFills` 를
      의존해서 순서를 앞으로 당겼다.
      `StationRef` 를 판별 유니온으로 바꿨다 — 레거시는 필드가 전부 optional
      이라 오타가 조용히 `undefined` 로 흘렀는데, 이제 `switch (st.kind)` 안에서
      필요한 필드가 반드시 있다.
      `resolveAction` 을 **주방 10상태 × 손 15가지 × 설비 21곳 = 3,150 조합**으로
      훑어 레거시와 문구·키·disabled·danger 까지 대조했다. 조회 함수
      (`bapReady` · `cookerProgress` · `rollProgress` · `burnerInfo` · `boardInfo` ·
      `missingFills` · `serveTarget` · `focusNow`)도 같은 조합으로 대조했다.
- [x] `features/ui` — HUD · 로비 · 주문서 · 결과 · 랭킹 (`ui.js` + `index.html` + `style.css`).
      1,438줄이라 둘로 나눴다.
  - [x] **(a) 화면 뼈대 + CSS** — `index.html` 의 `<body>` 를 `Shell` ·
        `Hud` · `JoinScreen` · `LobbyScreen` · `ResultScreen` · `HelpOverlay`
        컴포넌트로 옮기고, `style.css` 618줄을 **그대로 복사**했다
        (`src/styles/style.css`). Tailwind 로 다시 쓰지 않는다 — 참고
        프로젝트는 Tailwind 지만, 다시 쓰면 화면이 미묘하게 달라진다.
        검증은 레거시 `index.html` 을 `?raw` 로 읽어 **DOM 트리를
        태그 · 속성 · 글자까지 대조**한다(`dom-snapshot.ts`). 요소 303개 ·
        id 51개가 순서까지 같다. 여기에 더해 `ui.js` · `customize.js` 소스에서
        선택자를 **정규식으로 긁어내** 54개가 새 뼈대에서 전부 찾아지는지 본다 —
        트리가 같아도 정작 스크립트가 잡는 자리가 빠지면 조용히 죽는다.
        `<tbody>` 는 직접 썼다. HTML 파서는 `<table><tr>` 사이에 끼워 넣지만
        JSX 는 쓴 그대로 만든다.
        (돌연변이 5종 — id 오타 · class 누락 · 글자 변경 · `<tbody>` 제거 ·
        `data-time` 오타 — 을 심어 테스트가 잡는지 확인했다.) 6개 통과.
  - [x] **(b) `ui.js` 이식** — `toast` · `showScreen` · `route` · `renderPause` ·
        `toggleHelp` · `renderLobby` · `renderHUD` · `wavePop` ·
        `loadLobbyBoard` · `renderBoard` · `renderResult` · `initUI`.
        명령형 그대로 뒀다 — HUD 는 매 프레임 불리면서 innerHTML 을 문자열
        캐시와 비교해 바뀐 자리만 건드린다. React 상태로 바꾸면 같은 그림이
        나온다는 보장을 잃는다.
        검증은 같은 상태 스냅샷을 양쪽 `S` 에 심고 **33단계 대본**을 차례로
        먹인 뒤 단계마다 화면을 `describeElement` 로 통째로 대조한다.
        로비(혼자/5명/끊긴 사람/지난 영업) · HUD(준비·웨이브·손 5종·조준
        문구 4종·손님 조준·평판 낮음·일시정지 방장/손님) · 웨이브 팝업 3종 ·
        토스트 7개(5개 상한) · 도움말 · 결과 4종(폐업·완주 1위·기록 없음·
        저장 실패) · 로비 랭킹 3종(10줄 초과·없음·실패) · 입장 폼 4종.
        (돌연변이 13종을 심어 확인했다. 처음엔 바 색 경계 · 초 올림 · 품질
        색 경계 · HTML 이스케이프 4종이 **안 잡혀서** 픽스처를 보강했다 —
        pct 45%, 4.5초, 품질 85, 그리고 `&amp;`·`"`가 든 이름. `>` 와 `'` 는
        이스케이프를 빼도 DOM 이 같아 드러날 자리가 없다.)
        `camera` 는 레거시가 import 만 하고 안 써서 뺐다.
        레거시가 끊긴 사람 줄에 '연결 복구 중' 표를 **두 번** 붙이는 것도
        화면이 그대로여야 해서 그대로 옮겼다(`renderLobby` 주석).
        `style.css` 618줄이 원본과 바이트까지 같은지는 `test/parity.test.mjs`
        가 본다 — vitest 는 CSS 모듈을 비워서 반환해 클라이언트 쪽에서
        대조할 수 없었다. 4개 통과.
- [x] **조립점 (`main.js` 80줄)** — `features/app/boot.ts` + `App.tsx`.
      부팅 순서 · 소켓 배선 · `.fatal` 안내 · `window.GB` 훅.
      렌더러와 프레임 루프는 `features/world/renderer.tsx` 로 갈라 R3F 가 맡는다.
      **`<Canvas>` 대신 `createRoot` 로 기존 `canvas#gl` 에 붙인다** — `<Canvas>`
      는 div 두 겹으로 감싸서 레거시 DOM 과 달라지고 `#gl { position: fixed }`
      도 안 먹는다. 씬과 카메라는 `build.ts` 가 만든 것을 그대로 넘긴다.
      **렌더러도 직접 만들어 넘긴다**(`createRenderer`) — R3F 기본값에 기대면
      버전이 바뀔 때 톤매핑이 조용히 달라진다. 레거시가 건 값(antialias ·
      ACESFilmic · 노출 1.18 · 그림자 off · 픽셀비 상한 2)을 가짜 렌더러로
      받아 적어 **레거시 `initWorld` 와 대조**한다.
      검증은 양쪽 잎 모듈을 전부 가짜로 바꾸고 레거시 `main.js` 와 새 `boot()`
      를 차례로 돌려 (1) 호출 순서와 인자, (2) 등록한 소켓 이벤트와 **핸들러의
      동작**(내 스윙 무시 · 남의 피격 무시 · 떨어뜨림 토스트), (3) `window.GB`
      표면, (4) 실패 경로 2종의 `.fatal` 마크업, (5) 한 프레임의 호출 순서와
      dt(0.1초 상한)를 대조한다. `window.GB` 는 하드코딩 목록이 아니라
      **QA 도구 소스에서 `GB.xxx` 를 긁어내** 확인한다.
      (돌연변이 19종 — 부팅 순서 · `on` 누락 · `buildWorld` 누락 · fatal 문구 ·
      핸들러 조건 뒤집기 · GB 항목 누락 · dt 상한 제거 · 프레임 순서 ·
      렌더러 설정 7종 — 을 심어 전부 잡히는지 확인했다.) 13개 통과.

**4단계 완료.** `apps/client` 만으로 화면 · 3D · 입력 · 주방 · UI 가 전부 선다.

- [x] `features/customize` — `customize.js` 이식 (입장 화면 캐릭터 꾸미기).
      `ui.js` 가 이 모듈을 의존해서 `ui` 보다 먼저 옮겼다.
      3D 미리보기는 명령형 three 코드 그대로 둔다 — R3F 로 다시 짜면
      `fitPreview` 의 카메라 맞춤이 미묘하게 달라져 고른 모습과 실제가 어긋난다.
      DOM 은 5단계에서 React 가 그리고, 이 모듈이 그 위에 값을 칠한다.
      검증은 **레거시 `index.html` 의 `.customize` 마크업을 그대로 읽어** 심고
      같은 조작 22단계(화살표 · 색 견본 5줄 · 회전/걷기/정면 · 드래그 ·
      ←→ 키 · 기본 조합 · 게 후드 · 랜덤)를 두 구현에 차례로 먹인 뒤,
      단계마다 **렌더러에 넘어온 씬을 정점까지** · 카메라 투영행렬 ·
      칠해진 DOM · `currentLook()` · `localStorage` 저장값을 대조한다.
      랜덤 조합은 씨앗이 같은 LCG 를 양쪽에 물려 **난수 소비 순서까지** 본다.
      저장값 되살리기 4종(정상 · 범위 초과 · 빈 객체 · 깨진 JSON)과
      WebGL 실패 시 미리보기만 접는 경로도 함께 고정했다. 10개 통과.
      (돌연변이 4종 — 카메라 여백 · 드래그 감도 · 받침 두께 · 기본 yaw —
      을 심어 테스트가 실제로 잡는지 확인했다.)
- [x] `features/assets` — `assets.js` 이식. import 경로만 바뀐다
      (동봉 vendor 사본 → `three` 패키지). `CONTRACT` 60여 항목·숫자 200개를
      레거시와 deep-equal 로 대조해 고정했다 — 손으로 옮기면 반드시 한둘 틀린다.
      `checkContract` 의 크기 허용폭(2배)과 부품 누락 경고, `partOf` 의 탐색
      순서도 함께 고정했다. 20개 통과.

### 5. 동등성 검증과 마무리 — `상태: 진행 중`

- [x] **브라우저 QA 를 새 스택 기준으로 통과** — `npm run qa:browser:next` ·
      `npm run qa:character:next` 가 레거시와 나란히 PASS 한다.
      QA 픽스처(`tools/lib/qa-server.cjs`)에 스택 선택을 넣었다 —
      `--stack=next` 플래그(윈도우 npm 스크립트용) 또는 `QA_STACK` 환경변수.
      새 스택은 `apps/server/dist/main.js` 를 띄우고
      `GIMBAP_PUBLIC_ROOT=apps/client/dist` 로 Vite 빌드를 서빙한다.
      빌드가 없으면 기동 실패 대신 "빌드부터 하라" 고 먼저 알려 준다.
  - [x] **에셋 경로 분리** — Vite 산출물을 `dist/bundle/` 로 보내고
        게임 GLB 166개는 `dist/assets/` 로 복사한다(`vite.config.ts` 의
        `copyGameAssets`). 기본값 `assets` 를 쓰면 둘이 한 폴더에 섞인다.
  - [x] **서빙 검사**(`apps/server/src/static.client.spec.ts`, 6개) — 브라우저
        없이 확인 가능한 것 전부: index.html · 번들 · CSS · `/assets/manifest.json` ·
        실제 GLB · 컨트롤러 경로 · 404/디렉터리 탈출. CSP 는 브라우저에서만
        터지므로 index.html 이 부르는 자원을 전부 훑어 같은 출처인지, 인라인
        `<script>`·`<style>` 이 없는지 본다. (`@repo/server` 가 `@repo/client` 를
        devDependency 로 잡는다 — 서버가 클라이언트 빌드를 서빙하니 turbo 가
        순서를 알아야 한다.)
  - [x] **찾은 버그 1: 카메라 종횡비** — R3F 에 크기를 맡기면
        `canvas.parentElement`(`#app`)를 재는데 그 안이 전부 `position: fixed`
        라 높이가 0 이다. `camera.aspect` 가 Infinity 가 되어 투영행렬이 깨지고
        **화면은 멀쩡한데 조준(레이캐스트)이 통째로 죽었다.** 브라우저 QA 가
        냉장고를 못 집고 멈춰서 드러났다. 레거시 `resize()` 처럼 창 크기를
        직접 주고, 창 크기가 바뀌면 `setSize` 로 따라가게 고쳤다.
        회귀 테스트를 붙였다(`renderer.spec.ts` — 높이 0 인 부모를 흉내 낸다).
  - [x] **찾은 버그 2: QA 도구가 모듈 경로에 묶여 있었다** — 도구가
        `/js/net.js` · `/vendor/three.module.min.js` · `/js/world.js` 를 직접
        import 했다. 번들러가 붙으면 그런 경로가 없다. `window.GB` 에 `emit` 과
        `preview`(THREE · previewBody · animatePreviewBody · disposePreviewBody ·
        PARTS · DEFAULT_LOOK)를 **양쪽 스택에 대칭으로** 내보내고 도구가 그걸
        쓰게 했다. 레거시 기준선도 그대로 PASS 한다.
- [ ] 새 스택 + 레거시 동시 실행 비교 (같은 방, 같은 조작, 같은 결과)
- [x] **CI 워크플로에 워크스페이스 잡 추가** — `스모크 테스트` 잡이
      `검증` 잡이 되어 `build` · `typecheck` · `lint` · `format:check` ·
      `verify`(레거시 + 워크스페이스)를 전부 돌린다. Node 는 20 → 22.12.0.
      **워크플로 전체에서 Node 버전을 `env.NODE_VERSION` 한 곳에만 적는다** —
      잡마다 적으면 한쪽만 올리고 잊는다.
      브라우저 QA 는 CI 에서 안 돌린다(실제 Chrome + Playwright 가 필요한
      로컬 전용 도구다). 릴리스 전에 손으로 돌린다.
- [x] **Render 배포 설정 갱신** — 빌드 `npm ci && npm run build`,
      시작 `npm start`(= `node apps/server/dist/main.js`), Node 22.12.0,
      그리고 `GIMBAP_PUBLIC_ROOT=apps/client/dist`.
      정적 루트 **기본값도** 레거시 `public/` 에서 `apps/client/dist` 로 옮겼다 —
      기본값이 레거시면 배포는 성공하는데 옛 화면이 나가서 알아채기 어렵다.
      루트 `npm start` 가 새 서버를 가리키고, 레거시는 `npm run start:legacy` 다.
  - [x] **설정 어긋남을 테스트로 막는다**(`test/release-config.test.mjs`, 5개) —
        Node 버전이 `engines` · CI · Render 세 곳에서 같은 값인지, CI 가 부르는
        npm 스크립트가 실제로 있는지(오타 하나면 CI 가 통째로 건너뛴다),
        Render 가 빌드한 뒤 새 서버를 띄우고 새 화면을 서빙하는지,
        `autoDeploy: false` 와 `needs: [verify, redis-test]` 로 배포 게이트가
        살아 있는지. (돌연변이 9종을 심어 전부 잡히는지 확인했다.)
  - [x] 저장소 루트의 문서 6개 서식 정리 — 이제 `format:check` 가 CI 게이트다.
- [ ] 레거시 정리 — **사용자 선택: 지우지 않고 테스트 픽스처로 남긴다.**
      골든 스냅샷으로 대체하면 8~10MB JSON 을 커밋해야 하는데(빈 월드 씬 하나가
      498KB · 캐릭터 65조합 932KB · 재료 319KB, `build.spec` 은 손님이 찬 씬을
      12장 비교한다), 레거시 소스는 432KB(8,647줄)뿐이고 정확하며 읽을 수 있다.
      전체 248개 중 약 150개가 레거시와의 차분 테스트다.
  - [x] **게임 에셋을 레거시에서 떼어냈다** — `public/assets` →
        `apps/client/public/assets`. Vite 의 기본 publicDir 이라 빌드하면
        그대로 `dist/assets/` 로 간다(복사 플러그인 삭제). 이제 레거시 트리는
        서빙할 것이 없어 **파일로만 읽는 픽스처**가 된다.
        QA 서버 픽스처에서 `legacy` 스택을 걷어냈다 — 새 스택 하나만 띄운다.
        GLB MIME/HEAD 검사는 `static.client.spec.ts` 로 옮겼다.
  - [ ] 레거시 트리를 `legacy/` 로 옮겨 "테스트 전용" 임을 분명히 한다

## 완료 조건

`apps/server` 와 `apps/client` 만으로 지금 게임이 **똑같이** 돌아간다.
README 의 조작·웨이브·공정·랭킹·복구 동작이 전부 살아 있고,
58개 시나리오에 해당하는 검증이 새 스택에서 통과한다.

---

## 다음 세션 시작점 (2026-09-11 12:05)

브랜치 `refactor/fe-be-split`, **푸시 안 함**. 워킹 트리 깨끗.
현재 검증: 루트 79(레거시 스모크·통합 + 동등성 + QA 픽스처 + 배포 설정) +
서버 72 + 클라이언트 98 = **249개 통과**.
build · typecheck · lint · **format:check** 전부 통과 (서식도 이제 CI 게이트다).

브라우저 QA 도 레거시·새 스택 양쪽에서 PASS 한다.

**5단계에서 남은 것은 레거시 제거 하나뿐이다.**

### 다시 시작하는 방법

```bash
git switch refactor/fe-be-split
npm install
npm run build
npm run verify            # 루트 79 + 서버 72 + 클라이언트 98
npm run qa:browser:next   # 실제 Chrome (레거시는 npm run qa:browser)
npm start                 # = node apps/server/dist/main.js → http://localhost:3211
```

### 바로 다음에 할 일 — 레거시 제거 (5단계 마지막)

**먼저 확인할 것.** 지우면 동등성 테스트의 비교 대상이 사라진다.
`main` 에 올려 CI 가 초록이고 Render 배포가 한 번 성공하는 걸 본 뒤에 지운다.
(지금은 푸시하지 않는 상태라, 푸시 여부는 사용자에게 확인할 것.)

지울 것:

1. `server/` · `public/js/` · `public/css/` · `public/index.html`
2. `public/assets/` 는 **지우지 말고 옮긴다** → `apps/client/public/assets/`.
   옮긴 뒤 `vite.config.ts` 의 `copyGameAssets` 플러그인을 지운다
   (Vite 의 기본 `publicDir` 이 그대로 `dist/assets` 로 복사한다).
3. `test/*.mjs` 중 레거시 대상: `smoke` · `game-rules` · `runtime-config` ·
   `protocol` · `server.integration` · `ranking-store` · `spatial` · `layout` ·
   `render-utils` · `parity`. 남길 것: `qa-fixtures` · `release-config`.
   (루트 `package.json` 의 `test` 스크립트도 함께 줄인다.)
4. 각 워크스페이스의 레거시 대조 장치:
   - `apps/client/vite.config.ts` — `test.alias` 의 `@legacy/*` 와 vendor 매핑,
     `server.fs.allow`, `copyGameAssets`
   - `apps/client/src/testing/legacy-modules.d.ts`
   - `apps/server/src/testing/legacy.ts`
   - `*.spec.ts` 안의 레거시 비교 블록 — **여기가 가장 큰 판단**이다.
     비교 대상이 사라지면 그 테스트들은 의미를 잃는다. 두 갈래다:
     (a) 지운다 — 테스트 수가 249 → 100 아래로 떨어진다.
     (b) 레거시 결과를 **고정 스냅샷으로 떠서** 파일에 박고 계속 비교한다 —
     이식이 옳았다는 증거를 남긴다. `mesh-snapshot` 결과는 씬 하나가
     5만 줄이라 용량을 먼저 재 볼 것.
     사용자에게 어느 쪽인지 물을 것.
5. `tools/lib/qa-server.cjs` 의 `legacy` 스택 항목과 `--stack` 분기,
   `package.json` 의 `qa:browser` · `qa:character` · `start:legacy`.

### 남은 순서

5단계 — 브라우저 QA ✅ → CI 잡 ✅ → Render 설정 ✅ → **레거시 제거**.

### 잊지 말 것

- 레거시 `server/` · `public/` 은 **아직 지우지 않는다.** 동등성 테스트가
  그걸 읽어 대조한다. 지우는 건 5단계 마지막이다.
- `apps/server/src/testing/legacy.ts` 의 인터페이스 목록이 "아직 레거시에
  의존하는 표면" 이다. 5단계에서 이 파일이 비면 이식이 끝난 것이다.
- Node 는 `>=22.12.0` 로 올려 뒀지만 `render.yaml` 은 아직 `20.20.2` 다.
  CI 워크플로도 node 20 이다. 5단계에서 함께 올린다.
- `apps/client/vite.config.ts` 의 `server.fs.allow` 와 `test.alias`,
  `src/testing/legacy-modules.d.ts` 도 레거시를 읽으려고 둔 것이다.
  5단계에서 레거시가 사라질 때 함께 지운다.
- 랭킹 파일 경로: 레거시는 모듈 위치 기준, 새 서버는 **cwd 기준**이다.
  저장소 루트에서 띄우면 같은 파일이고, 시작 로그에 실제 경로를 찍는다.

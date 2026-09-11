# 레거시 스택 — 테스트 픽스처

여기 있는 코드는 **더 이상 배포되지 않습니다.** 게임은 `apps/server` 와
`apps/client` 로 돌아갑니다 (`npm start`, `render.yaml`).

그런데도 지우지 않은 이유는 하나입니다. 새 스택의 테스트 약 150개가
**이 코드와 결과를 직접 대조**하기 때문입니다 — 씬 트리를 정점까지,
DOM 을 태그·속성·글자까지, 주방 상호작용을 3,150 조합으로.

지우고 골든 스냅샷으로 바꾸는 것도 검토했지만 비용이 맞지 않았습니다.

| | 크기 | 읽을 수 있나 |
| --- | --- | --- |
| 이 트리 | 432KB · 8,647줄 | 예 |
| 같은 보장을 스냅샷으로 | 8~10MB JSON | 아니오 |

(빈 월드 씬 하나가 498KB, 캐릭터 65조합 932KB, 재료 319KB.
`build.spec.ts` 는 손님이 찬 씬을 12장 비교합니다.)

## 규칙

- **고쳐 쓰지 않습니다.** 비교 기준이라 바뀌면 기준이 아니게 됩니다.
- **서빙하지 않습니다.** 게임 에셋은 `apps/client/public/assets` 로 옮겼고,
  이 트리는 파일로만 읽힙니다. `npm run start:legacy` 로 옛 서버를 띄울 수는
  있지만 에셋이 없어 화면이 온전하지 않습니다 — 동작 확인용입니다.
- 서식 검사에서 제외합니다 (`.prettierignore`).

## 언제 지우나

새 스택이 한동안 운영에서 문제없이 돌고, 정점 단위 대조가 더 이상 필요
없다고 판단될 때. 그때 이 디렉터리와 함께 지울 것:

- `apps/client/vite.config.ts` 의 `test.alias`(`@legacy/*`) · `server.fs.allow`
- `apps/client/src/testing/legacy-modules.d.ts`
- `apps/server/src/testing/legacy.ts`
- `test/` 의 레거시 테스트와 `parity.test.mjs`
- 각 `*.spec.ts` 안의 레거시 비교 블록

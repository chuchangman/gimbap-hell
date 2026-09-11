/* ────────────────────────────────────────────────────────────
   클라이언트 튜닝값 — 손대고 싶어질 만한 숫자를 한곳에 모았다.

   여기 있는 건 "화면이 어떻게 보이고 얼마나 자주 갱신되는가" 뿐이다.
   게임 규칙(재료 · 공정 시간 · 웨이브 표 · 점수 · 설비 개수 · 배치)은
   `packages/game-core` 에 있고 서버와 함께 읽는다 — 규칙을 여기서
   고치면 서버와 어긋난다.

   서버 운영값(포트 · 복구 시간 · 랭킹 저장소)은
   `apps/server/src/config/runtime.config.ts` 다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from 'three';

/** 렌더러 — 톤매핑을 빼면 밝은 면이 하얗게 뜨고 로우폴리의 면 대비가 죽는다 */
export const RENDER = {
  antialias: true,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.18,
  /** 화면 배율 상한. 4K 에서 그대로 그리면 프레임이 반으로 떨어진다 */
  pixelRatioCap: 2,
  /** 탭이 쉬었다 돌아와도 한 프레임에 이보다 길게 굴리지 않는다 (초) */
  maxDeltaSec: 0.1,
} as const;

/** HUD · 토스트 · 랭킹 — 화면 갱신 주기와 표시 시간 */
export const UI = {
  /** 게임 중 HUD 갱신 주기(ms). 60Hz 로 다시 그릴 이유가 없다 */
  hudTickMs: 66,
  /** 토스트를 몇 개까지 쌓아 둘지 */
  toastMax: 5,
  /** 토스트가 머무는 시간(ms) */
  toastMs: 2600,
  /** 사라질 때 흐려지는 시간(ms). style.css 의 transition 과 맞춰야 한다 */
  toastFadeMs: 320,
  /** 대기실에 앉아 있는 동안 랭킹을 다시 받는 주기(ms) */
  leaderboardRefreshMs: 30000,
} as const;

/** 네트워크 표현 — 서버가 보낸 위치를 화면에서 어떻게 이어 붙일지 */
export const NETWORK = {
  /** 원격 플레이어 위치를 얼마나 오래 들고 있을지(ms). 보간에 쓴 뒤 버린다 */
  poseKeepMs: 1000,
} as const;

/** 파일과 저장소 경로 */
export const PATHS = {
  /** 게임 에셋 목록. apps/client/public/assets/ 에서 나간다 */
  assetManifest: '/assets/manifest.json',
  /** 고른 캐릭터 조합을 담아 두는 localStorage 키 */
  lookStore: 'gimbap:look',
} as const;

/**
 * 모델이 지켜야 할 규격.
 *   size  : 대략의 크기 (m). 두 배 넘게 어긋나면 경고한다
 *   origin: 원점을 어디 두는가
 *   parts : 코드가 이름으로 찾아 쓰는 노드. 없으면 그 기능만 죽는다
 *
 * 속재료(fill/*)는 길이 1 로 만든다. 김밥 단면(두께 0.12)과
 * 손에 든 재료(0.44)가 같은 모델을 늘여 쓰기 때문이다 —
 * 덕분에 단면에서 본 모양과 손에 든 모양이 저절로 이어진다.
 *
 * 레거시 public/js/assets.js 의 CONTRACT 를 그대로 옮겼다.
 */
export interface AssetSpec {
  size: [number, number, number];
  origin: string;
  parts: string[];
}

export const CONTRACT: Record<string, AssetSpec> = {
  /* ── 캐릭터 — 베이스는 리그, 기본 상·하의는 독립 메시 파츠 ── */
  'char/base': {
    size: [0.96, 2.19, 0.86],
    origin: '발바닥 한가운데, 얼굴 +z',
    parts: ['rig', 'body', 'head', 'legL', 'legR', 'armL', 'armR', 'baseTop', 'baseBottom'],
  },
  'char/hair/short': { size: [0.84, 0.6, 0.84], origin: 'char/base와 동일', parts: [] },
  'char/hair/bob': { size: [0.9, 0.55, 0.9], origin: 'char/base와 동일', parts: [] },
  'char/hair/bun': { size: [0.9, 0.55, 1.05], origin: 'char/base와 동일', parts: [] },
  'char/hair/spiky': { size: [0.9, 0.7, 0.9], origin: 'char/base와 동일', parts: [] },
  'char/hair/long': { size: [0.9, 1.1, 0.9], origin: 'char/base와 동일', parts: [] },
  'char/hair/chef': { size: [0.72, 0.55, 0.73], origin: 'char/base와 동일', parts: [] },
  'char/hair/crab': { size: [1.2, 0.85, 0.9], origin: 'char/base와 동일', parts: [] },
  'char/hair/cap': { size: [0.9, 0.75, 0.92], origin: 'char/base와 동일', parts: [] },
  ...Object.fromEntries(
    ['tee', 'apron', 'stripe', 'hoodie', 'vest', 'scout'].map((id) => [
      'char/top/' + id,
      {
        size: [0.91, 0.69, 0.49],
        origin: 'char/base와 동일',
        parts: ['garmentBody', 'sleeveL', 'sleeveR'],
      },
    ]),
  ),
  ...Object.fromEntries(
    ['shorts', 'trousers', 'cuffed'].map((id) => [
      'char/bottom/' + id,
      {
        size: [0.57, id === 'shorts' ? 0.35 : 0.58, 0.37],
        origin: 'char/base와 동일',
        parts: ['waist', 'trouserL', 'trouserR'],
      },
    ]),
  ),

  /* ── 속재료 — 길이 1.0 (y축), 원점 한가운데, 단면은 xz 평면 ── */
  'fill/danmuji': { size: [0.056, 1, 0.056], origin: '한가운데', parts: [] },
  'fill/ham': { size: [0.074, 1, 0.04], origin: '한가운데', parts: [] },
  'fill/egg': { size: [0.088, 1, 0.043], origin: '한가운데', parts: [] },
  'fill/crab': { size: [0.06, 1, 0.06], origin: '한가운데', parts: [] },
  'fill/cucumber': { size: [0.052, 1, 0.061], origin: '한가운데', parts: [] },
  'fill/spinach': { size: [0.086, 1, 0.064], origin: '한가운데', parts: [] },
  'fill/carrot': { size: [0.111, 1, 0.041], origin: '한가운데', parts: [] },
  'fill/fishcake': { size: [0.096, 1, 0.053], origin: '한가운데', parts: [] },

  /* ── 손질 전 원물 — 원점 한가운데, 긴 쪽이 x ── */
  'raw/danmuji': { size: [0.5, 0.15, 0.15], origin: '한가운데', parts: [] },
  'raw/ham': { size: [0.34, 0.11, 0.24], origin: '한가운데', parts: [] },
  'raw/egg': { size: [0.26, 0.33, 0.26], origin: '한가운데', parts: [] },
  'raw/cucumber': { size: [0.5, 0.16, 0.16], origin: '한가운데', parts: [] },
  'raw/spinach': { size: [0.52, 0.15, 0.3], origin: '한가운데', parts: [] },
  'raw/carrot': { size: [0.48, 0.17, 0.17], origin: '한가운데', parts: [] },
  'raw/fishcake': { size: [0.4, 0.06, 0.32], origin: '한가운데', parts: [] },

  /* ── 그 밖의 손에 드는 것 ── */
  'item/gim': { size: [0.64, 0.02, 0.52], origin: '한가운데', parts: [] },
  'item/rice': { size: [0.42, 0.14, 0.42], origin: '한가운데', parts: ['water'] },
  'item/bap': { size: [0.4, 0.22, 0.34], origin: '한가운데', parts: [] },
  'item/roll': { size: [0.68, 0.28, 0.28], origin: '한가운데, 긴 쪽 x', parts: [] },
  'item/plate': { size: [0.7, 0.07, 0.7], origin: '한가운데', parts: [] },
  'item/broom': { size: [0.34, 1.6, 0.14], origin: '자루 한가운데', parts: [] },
  'item/knife': { size: [0.12, 0.05, 0.58], origin: '칼날 바닥 한가운데', parts: [] },

  /* ── 1인칭 손 — 손목 원점, 손가락 +y, 손등 +z ── */
  'hand/fps-right': {
    // Three.js의 Box3는 현재 포즈뿐 아니라 morph target 범위도 포함한다.
    size: [0.15, 0.27, 0.11],
    origin: '손목 중심, 손가락 +y, 손등 +z, 단위 m',
    parts: ['RightHand_Skin'],
  },
  'hand/fps-right-grip': {
    size: [0.1, 0.15, 0.025],
    origin: '손목 중심, 손가락 +y, 손등 +z, 주먹 사진 포즈',
    parts: ['RightHand_Skin'],
  },

  /* ── 설비 — 바닥 한가운데가 원점(y=0). 충돌·상호작용·이름표는 코드가 맡는다 ── */
  'station/counter': { size: [1.0, 1.04, 1.0], origin: '바닥 한가운데', parts: [] },
  'station/cabinet': { size: [0.9, 0.67, 1.0], origin: '바닥 한가운데', parts: [] },
  'station/table': { size: [1.0, 0.67, 1.5], origin: '바닥 한가운데', parts: [] },
  'station/fridge': { size: [1.15, 2.9, 5.9], origin: '바닥 한가운데', parts: [] },
  'station/sink': { size: [1.3, 1.45, 1.7], origin: '바닥 한가운데', parts: [] },
  'station/cooker': { size: [1.3, 1.45, 2.1], origin: '바닥 한가운데', parts: ['lid'] },
  'station/stove': { size: [1.3, 1.1, 6.8], origin: '바닥 한가운데', parts: [] },
  'station/board': { size: [1.05, 0.07, 0.85], origin: '판 한가운데', parts: [] },
  'station/mat': { size: [0.72, 0.06, 0.72], origin: '판 한가운데', parts: [] },
  'station/bin': { size: [0.95, 1.02, 0.95], origin: '바닥 한가운데', parts: [] },
  'station/pot': { size: [0.6, 0.3, 0.54], origin: '바닥 한가운데', parts: ['water'] },
  'station/pan': { size: [0.6, 0.1, 0.9], origin: '바닥 한가운데', parts: [] },

  /* ── 방 — 각 면의 정중앙이 원점. 타일·몰딩은 벽 파일에 포함한다 ── */
  'room/floor': { size: [16.0, 0.11, 20.0], origin: '바닥 판 한가운데', parts: [] },
  'room/ceiling': { size: [16.0, 0.11, 20.0], origin: '천장 판 한가운데', parts: [] },
  'room/wall-back': { size: [16.0, 3.4, 0.18], origin: '벽 한가운데, 실내는 -z', parts: [] },
  'room/wall-front': { size: [16.0, 3.4, 0.18], origin: '벽 한가운데, 실내는 +z', parts: [] },
  'room/wall-left': { size: [0.18, 3.4, 20.0], origin: '벽 한가운데, 실내는 +x', parts: [] },
  'room/wall-right': { size: [0.18, 3.4, 20.0], origin: '벽 한가운데, 실내는 -x', parts: [] },
};

/** 이름이 char/character-* 인 손님 모델의 규격 (CONTRACT 에 개별 항목이 없다) */
export const CUSTOMER_CONTRACT: AssetSpec = {
  size: [1.9, 2.04, 0.55],
  origin: '발바닥 한가운데 (y=0), 얼굴 +z',
  parts: [
    'torso',
    'Head',
    'LeftUpLeg',
    'RightUpLeg',
    'LeftArm',
    'RightArm',
    'browL',
    'browR',
    'eyeL',
    'eyeR',
  ],
};

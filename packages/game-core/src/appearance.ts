/* ────────────────────────────────────────────────────────────
   캐릭터 파츠 — 머리카락 · 얼굴 · 상의

   플레이어가 고른 조합을 서버가 그대로 들고 있다가 모두에게 뿌린다.
   손님은 따로 보내지 않는다 — 이미 있는 seed 로 뽑는다.
   조합을 네트워크에 실으면 손님 한 명당 5바이트가 늘어나는데,
   seed 만 있으면 양쪽이 같은 값을 계산해 낼 수 있어서 0바이트다.

   고른 값은 인덱스로만 주고받는다 (h, hc, f, t, tc — 작은 정수 다섯 개).
   ──────────────────────────────────────────────────────────── */

/** 플레이어 눈높이(m).
   캐릭터 몸도 이 값에 눈을 맞춘다 — 서로 마주 봤을 때 눈높이가 어긋나면
   한쪽이 상대를 내려다보게 되어 어색하다.
   1인칭 카메라 높이와 아바타 몸 배율이 같이 쓴다. */
export const EYE = 1.82;

export interface PartDef {
  id: string;
  name: string;
}

export const PARTS = {
  hair: [
    { id: 'short', name: '짧은 머리' },
    { id: 'bob', name: '단발' },
    { id: 'bun', name: '쪽머리' },
    { id: 'spiky', name: '볼륨 머리' },
    { id: 'long', name: '긴 머리' },
    { id: 'chef', name: '요리사 모자' },
    { id: 'crab', name: '게 후드' },
    { id: 'cap', name: '야구모자' },
    { id: 'bald', name: '민머리' },
  ],
  face: [
    { id: 'plain', name: '기본' },
    { id: 'glasses', name: '안경' },
    { id: 'freckle', name: '주근깨' },
    { id: 'beard', name: '수염' },
    { id: 'blush', name: '볼터치' },
  ],
  /* 표정 — 눈·눈썹·입을 어떤 각도와 배율로 둘지 고른다.
     손님 얼굴은 상태에 따라 계속 바뀌지만(setFace) 내 캐릭터는 바뀔 일이 없어,
     여기서 고른 표정이 그대로 남는다. id 는 렌더러 FACE_POSE 의 키다. */
  expression: [
    { id: 'neutral', name: '기본' },
    { id: 'smile', name: '미소' },
    { id: 'happy', name: '활짝' },
    { id: 'smug', name: '새침' },
    { id: 'annoyed', name: '뚱함' },
    { id: 'angry', name: '매서움' },
    { id: 'shocked', name: '놀람' },
    { id: 'sleepy', name: '졸림' },
  ],
  top: [
    { id: 'tee', name: '티셔츠' },
    { id: 'apron', name: '앞치마' },
    { id: 'stripe', name: '줄무늬' },
    { id: 'hoodie', name: '후드' },
    { id: 'vest', name: '조끼' },
    { id: 'scout', name: '워크 재킷' },
  ],
  bottom: [
    { id: 'shorts', name: '반바지' },
    { id: 'trousers', name: '긴바지' },
    { id: 'cuffed', name: '롤업 팬츠' },
  ],
} satisfies Record<string, PartDef[]>;

export type PartSlot = keyof typeof PARTS;

export const PART_COLORS = {
  hair: [0x38312d, 0x715143, 0xb68b54, 0xd9d2c4, 0x9a5743, 0x566475],
  top: [0x718b80, 0xbd8860, 0xad7681, 0x666e79, 0x8d966c, 0xbe7665, 0x688e98, 0x95869d],
  bottom: [0x535d50, 0x515b67, 0x6d8397, 0x987758, 0x807178, 0xb98577, 0x638883, 0xb6ad96],
  skin: [0xdeb18e, 0xf0cfad, 0xc9926e, 0xa97050, 0x81583f, 0xa7b8a0, 0xccaeaa],
  shoes: [0x755447, 0x434a50, 0xd2c5a9, 0x657c6f, 0xa16755],
} satisfies Record<string, number[]>;

/** 인덱스 다섯 개로 표현한 외형 조합 */
export interface Look {
  h: number;
  hc: number;
  f: number;
  t: number;
  tc: number;
  b: number;
  bc: number;
  e: number;
  sc: number;
  shc: number;
}

export const DEFAULT_LOOK: Look = {
  h: 0,
  hc: 0,
  f: 0,
  t: 1,
  tc: 0,
  b: 0,
  bc: 0,
  e: 1,
  sc: 0,
  shc: 0,
};

/** 범위를 벗어난 값은 잘라낸다. 클라이언트가 보낸 값은 믿지 않는다 */
export function sanitizeLook(look: Partial<Look> | null | undefined): Look {
  const pick = (v: unknown, n: number): number => {
    const i = Math.floor(Number(v));
    return Number.isFinite(i) && i >= 0 && i < n ? i : 0;
  };
  const L = look || {};
  return {
    h: pick(L.h, PARTS.hair.length),
    hc: pick(L.hc, PART_COLORS.hair.length),
    f: pick(L.f, PARTS.face.length),
    t: pick(L.t, PARTS.top.length),
    tc: pick(L.tc, PART_COLORS.top.length),
    b: pick(L.b, PARTS.bottom.length),
    bc: pick(L.bc, PART_COLORS.bottom.length),
    // 표정은 나중에 생긴 항목이라, 저장해 둔 옛 조합에는 없다. pick 이 0 으로 떨군다.
    e: pick(L.e, PARTS.expression.length),
    sc: pick(L.sc, PART_COLORS.skin.length),
    shc: pick(L.shc, PART_COLORS.shoes.length),
  };
}

/**
 * 손님 조합 — seed 하나에서 결정적으로 뽑는다.
 * 서버와 클라이언트가 같은 값을 얻으므로 네트워크로 보낼 필요가 없다.
 */
export function lookFromSeed(seed: number): Omit<Look, 'e'> {
  const r = (n: number): number => {
    const x = Math.sin((seed + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    h: Math.floor(r(1) * PARTS.hair.length),
    hc: Math.floor(r(2) * PART_COLORS.hair.length),
    f: Math.floor(r(3) * PARTS.face.length),
    t: Math.floor(r(4) * PARTS.top.length),
    tc: Math.floor(r(5) * PART_COLORS.top.length),
    b: Math.floor(r(6) * PARTS.bottom.length),
    bc: Math.floor(r(7) * PART_COLORS.bottom.length),
    sc: Math.floor(r(8) * 5),
    shc: Math.floor(r(9) * PART_COLORS.shoes.length),
  };
}

/* ────────────────────────────────────────────────────────────
   캐릭터 — 몸 · 얼굴 · 표정 · 머리 · 옷 · 소품 · 팔다리 자세 · 테두리 · 체력바
   레거시 world.js 1891-2570 줄과 미리보기(2955-2975)를 그대로 옮겼다.
   ──────────────────────────────────────────────────────────── */
import { assetOrNull, partOf } from '@/features/assets/assets';
import { sharedGeo } from '@/features/world/geometry';
import { m1, mat, ownMat, tintAssetMaterials } from '@/features/world/materials';
import { box, cap, cyl, disposeObject } from '@/features/world/primitives';
import {
  CAMERA_VIEW,
  EYE,
  lookFromSeed,
  PART_COLORS,
  PARTS,
  sanitizeLook,
  type Look,
} from '@repo/game-core';
import * as THREE from 'three';

/* 테두리는 언제나 몸통 "바깥" 이라 배경 위에 얹힌다.
   손님 뒤 배경은 크림색 뒷벽(0xf0e6d2)과 옅은 걸레받이(0xcfe3dc) 뿐이라
   밝은 색을 쓰면 묻힌다 — 하늘색은 대비 1.17:1 로 조리 거리에서 안 보였다.
   짙은 보라는 뒷벽 대비 약 6.4:1 이고, 금색(조준)·분홍(자리 링)·빨강(진상) 과도 겹치지 않는다. */
export const OUTLINE_COLOR = 0x5b21d6;
export const OUTLINE_PX = 4; // 화면에서 유지할 테두리 두께(px)
export const OUTLINE_TAN = Math.tan((CAMERA_VIEW.fov * Math.PI) / 180 / 2);
export const OUTLINE_TIE = 0.4; // 동점자는 이만큼 흐리게

/* ────────────────────────────────────────────────────────────
   사람 — 손님과 동료 아바타가 같은 뼈대를 쓴다

   예전에는 원기둥 하나에 구 하나가 전부라
   걷는지 서 있는지, 화났는지, 누가 진상인지 알 수가 없었다.
   뼈대를 팔·다리 피벗으로 나누고 얼굴을 붙여 그 셋을 다 보이게 한다.

   ⚠ 실루엣은 반지름 0.30 · 높이 0~1.0 안에 들어와야 한다.
     손님 테두리(makeOutline)가 딱 그 크기의 역방향 헐이라
     팔이 그 밖으로 나가면 테두리가 팔만 빼먹고 그려진다.
   ──────────────────────────────────────────────────────────── */

/** makeBody 가 돌려주는 몸 한 채 */
export interface BodyParts {
  group: THREE.Group;
  rig: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  legRest: THREE.Quaternion[];
  armRest: THREE.Quaternion[];
  /** GLB 캐릭터를 쓸 때만 있다. 코드로 지은 몸에는 없다. */
  baseModel?: THREE.Object3D;
  fromAsset?: boolean;
}

/** makeFace 가 돌려주는 얼굴 */
export interface FaceParts {
  group: THREE.Group;
  eyes: THREE.Object3D[];
  brows: THREE.Object3D[];
  mouth: THREE.Object3D;
  openMouth: THREE.Object3D;
  mood: string | null;
  browBaseY: number;
  mouthBaseY: number;
}

export interface BodyOptions {
  build?: number;
  pants?: number;
}

export interface FaceOptions {
  mood?: string;
  brow?: number;
}

/** 손님 테두리(역방향 헐) */
export interface OutlineParts {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  r: number;
}

/** 손님 체력바 */
export interface HpBar {
  group: THREE.Group;
  segs: THREE.Mesh[];
  shown?: number;
}

const SKIN = 0xf6d9b0;
const PANTS = 0x3f4550;

/* 코드로 세운 몸은 눈이 y 1.302 에 온다 (얼굴 그룹 1.26 + 눈 0.042).
   플레이어 카메라는 EYE 높이에 있으므로, 그대로 두면 서로 눈높이가 어긋나
   상대를 내려다보게 된다. 몸 전체를 이 배율로 키워 눈을 맞춘다.
   ⚠ 이름표·체력바·말풍선은 같이 커지면 안 된다 — 배율 그룹 바깥에 둔다. */
/**
 * 몸의 기준점 — 머리카락·상의·소품·테두리가 전부 이 표를 보고 자리를 잡는다.
 *
 * PEAK처럼 머리가 크고 무게중심이 낮은 2등신이다. 머리 지름이 전체 키의
 * 40%쯤 되고, 몸과 팔다리는 짧고 묵직하게 이어진다.
 * 얼굴이 화면에서 크게 잡히므로 눈·눈썹만으로도 표정이 멀리서 읽힌다 —
 * 이게 이 비율을 고른 이유다.
 *
 * 예전 몸은 작게 세운 뒤 rig 를 통째로 1.398 배 키워 눈을 EYE 에 맞췄다.
 * 지금은 처음부터 실제 크기로 세운다. 소품 좌표를 그대로 눈으로 읽을 수 있고,
 * 배율이 끼어들지 않아 "여기 붙였는데 왜 저기 있지" 가 없어진다.
 */
export const BODY = {
  /* 눈은 EYE(1.82)에 고정이다 — 카메라가 거기 있으니 못 옮긴다.
     그래서 머리를 얼마나 높이 두느냐가 곧 "눈이 얼굴의 어디쯤 오는가" 다.
     머리 중심을 눈보다 살짝 위(1.84)에 두면 눈이 얼굴 한가운데에 오고,
     이마에 머리카락과 모자가 들어갈 자리가 생긴다. 1.70 이면 눈이 얼굴 위쪽에
     붙어서 머리카락을 얹을 데가 없어진다 — 한 번 그렇게 만들어 봤다. */
  headY: 1.76,
  headR: 0.43,
  headFlat: 0.94,
  faceZ: 0.37, // 눈·눈썹·입이 놓이는 얼굴 앞면
  browUp: 0.125,
  mouthDown: 0.175, // 눈 기준 위아래 간격
  torsoY: 1.05,
  torsoR: 0.295,
  torsoH: 0.32,
  shoulderY: 1.32,
  shoulderX: 0.33,
  armR: 0.088,
  upperArmH: 0.14,
  forearmR: 0.066,
  forearmH: 0.17,
  hipY: 0.7,
  hipX: 0.145,
  thighR: 0.098,
  thighH: 0.1,
  calfR: 0.074,
  calfH: 0.13,
  shoeR: 0.115,
};
// Must match the head/hair bake in build-clay-character-assets.py.
export const HEAD_SCALE = 0.875;
const HEAD_TOP = BODY.headY + BODY.headR * 0.98 * HEAD_SCALE;
const EYE_LOCAL = EYE - BODY.headY; // 얼굴 그룹 안에서의 눈 높이

/** 표정 기본값 — setFace 의 표가 비어 있을 때 쓰는 값 */
const FACE_NEUTRAL = [-0.03, 0.115, 0.94, Math.PI, 0.78, 0.28];

/**
 * 얼굴 한 벌 = [눈썹 안쪽 기울기, 눈썹 높이, 눈 세로배율, 입 뒤집기, 입 가로배율, 입 세로배율]
 *
 * 부호 규칙 — 잘못 넣으면 만족이 분노로 보인다. 한 번 데였다.
 *   눈썹 기울기 +  : 안쪽 끝이 내려간다 (화남)
 *   눈썹 기울기 −  : 안쪽 끝이 올라간다 (순함·놀람)
 *   입 뒤집기 π    : ∪ 웃는 입
 *   입 뒤집기 0    : ∩ 찡그린 입
 *   ⚠ 입 뒤집기는 0 또는 π 만 쓴다 — setFace 가 이 값으로 입 높이를 보정한다.
 *
 * 손님의 감정(neutral·annoyed·angry·happy·shocked)과 유저가 고르는 표정이
 * 같은 표를 쓴다. 손님은 상태가 바뀔 때마다 갈아끼우고, 내 캐릭터는 고른 것을
 * 그대로 둔다 — 그래서 표를 나눌 이유가 없다. 키는 config.js PARTS.expression 의 id.
 *
 * 클레이 에셋에는 얼굴 그림이 없으며, 모든 표정은 이 얼굴 파츠를 함께 쓴다.
 */
const FACE_POSE: Record<string, number[]> = {
  neutral: FACE_NEUTRAL,
  smile: [-0.1, 0.121, 0.88, Math.PI, 1.06, 0.46],
  happy: [-0.12, 0.129, 0.92, Math.PI, 1.12, 0.58],
  smug: [0.08, 0.124, 0.7, Math.PI, 0.78, 0.3],
  annoyed: [0.14, 0.103, 0.82, 0, 0.7, 0.28],
  angry: [0.28, 0.097, 0.79, 0, 0.78, 0.42],
  shocked: [-0.12, 0.15, 1.1, Math.PI, 0.55, 1.1],
  sleepy: [0.02, 0.107, 0.92, Math.PI, 0.57, 0.18],
};

/** 고른 표정의 이름. sanitizeLook 을 거친 값만 들어오므로 범위는 이미 안전하다 */
export const characterMood = (index: number): string => PARTS.expression[index].id;

/**
 * 사람 한 명.
 * 팔·다리를 피벗 그룹에 담아 돌려주는 게 핵심 — 걷기 모션이 이 피벗을 돌린다.
 */
export function makeBody(color: number, opts?: BodyOptions): BodyParts {
  const o = opts || {};

  /* Blender 베이스가 있으면 몸·옷·간단 리그를 통째로 사용한다.
     파일을 못 읽는 환경에서는 아래 코드 모델이 그대로 비상 대체가 된다. */
  const model = assetOrNull('char/base');
  if (model) {
    ownMat(model);
    const g = new THREE.Group();
    g.add(model);
    const w = o.build || 1;
    model.scale.set(w, 1, w);

    const rig = partOf(model, 'rig') || model;
    const torso = partOf(model, 'body') || partOf(model, 'torso') || model;
    const head = partOf(model, 'head') || model;
    const legs = [partOf(model, 'legL'), partOf(model, 'legR')].filter(
      (b): b is THREE.Object3D => !!b,
    );
    const arms = [partOf(model, 'armL'), partOf(model, 'armR')].filter(
      (b): b is THREE.Object3D => !!b,
    );
    return {
      group: g,
      rig,
      torso,
      head,
      legs,
      arms,
      legRest: legs.map((bone) => bone.quaternion.clone()),
      armRest: arms.map((bone) => bone.quaternion.clone()),
      fromAsset: true,
      baseModel: model,
    };
  }

  /* 바깥(g)에는 이름표·체력바처럼 크기가 고정돼야 하는 것, 안쪽(rig)에는 몸.
     소품과 옷은 rig 에 들어가므로 덩치 배율을 함께 받는다. */
  const g = new THREE.Group();
  const rig = new THREE.Group();
  g.add(rig);
  const w = o.build || 1; // 덩치 배율

  // 소매는 몸통보다 한 톤 어둡게 — 같은 색이면 팔이 몸통에 묻혀 안 보인다
  const sleeve = new THREE.Color(color).multiplyScalar(0.82).getHex();

  const torso = cap(BODY.torsoR * w, BODY.torsoH, color, 0, BODY.torsoY, 0, rig);

  /* 목은 없다. 2등신에서 목을 넣으면 머리가 떠 보이고, 머리 구가 몸통 위쪽을
     충분히 덮어서 이음매도 안 보인다. */
  const head = new THREE.Mesh(
    sharedGeo('head_sphere', () => new THREE.SphereGeometry(BODY.headR, 16, 12)),
    mat(SKIN),
  );
  head.position.y = BODY.headY;
  head.scale.set(HEAD_SCALE, 0.98 * HEAD_SCALE, BODY.headFlat * HEAD_SCALE);
  rig.add(head);

  /* 큰 머리와 짧은 몸 사이가 비어 보이지 않게 작은 칼라/목을 숨겨 넣는다.
     정면에서는 거의 안 보이지만 옆으로 돌 때 머리가 공중에 뜨는 느낌을 없앤다. */
  cap(0.105 * w, 0.1, SKIN, 0, 1.4, -0.015, rig, 9);

  const legs = [],
    arms = [];
  for (const s of [-1, 1]) {
    // 다리 — 반바지, 종아리, 신발을 한 피벗에 묶어 함께 걷는다.
    const hip = new THREE.Group();
    hip.position.set(s * BODY.hipX, BODY.hipY, 0);
    const thighTotal = BODY.thighH + BODY.thighR * 2;
    const calfTotal = BODY.calfH + BODY.calfR * 2;
    cap(BODY.thighR * w, BODY.thighH, o.pants || PANTS, 0, -thighTotal / 2, 0, hip);
    const calfTop = -thighTotal + 0.04;
    cap(BODY.calfR * w, BODY.calfH, SKIN, 0, calfTop - calfTotal / 2, 0.005, hip);

    /* PEAK 실루엣의 핵심인 넓은 신발. 앞쪽(+z)으로 살짝 내밀어 서 있을 때도
       발 방향이 읽히며, 걷는 중에는 다리 피벗과 함께 자연스럽게 따라간다. */
    const shoe = new THREE.Mesh(
      sharedGeo('character_shoe', () => new THREE.SphereGeometry(BODY.shoeR, 9, 6)),
      mat(new THREE.Color(o.pants || PANTS).multiplyScalar(0.64).getHex()),
    );
    shoe.position.set(0, calfTop - calfTotal + 0.035, 0.055);
    shoe.scale.set(1.05 * w, 0.68, 1.48);
    hip.add(shoe);
    rig.add(hip);
    legs.push(hip);

    // 팔 — 소매에서 맨팔로 가늘어졌다가 손에서 다시 둥글어지는 형태다.
    const sh = new THREE.Group();
    sh.position.set(s * BODY.shoulderX * w, BODY.shoulderY, 0);
    const upperR = BODY.armR * w;
    const foreR = BODY.forearmR * w;
    const upperTotal = BODY.upperArmH + upperR * 2;
    const foreTotal = BODY.forearmH + foreR * 2;
    cap(upperR, BODY.upperArmH, sleeve, 0, -upperTotal / 2, 0, sh);
    const foreTop = -upperTotal + 0.035;
    cap(foreR, BODY.forearmH, SKIN, 0, foreTop - foreTotal / 2, 0, sh);
    const hand = new THREE.Mesh(
      sharedGeo('character_hand', () => new THREE.SphereGeometry(0.092, 9, 6)),
      mat(SKIN),
    );
    hand.position.set(0, foreTop - foreTotal + 0.052, 0.012);
    hand.scale.set(0.98 * w, 1.08, 0.92);
    sh.add(hand);
    rig.add(sh);
    arms.push(sh);
  }

  return {
    group: g,
    rig,
    torso,
    head,
    legs,
    arms,
    legRest: legs.map((part) => part.quaternion.clone()),
    armRest: arms.map((part) => part.quaternion.clone()),
  };
}

/**
 * 얼굴 — 눈·눈썹·입.
 * 표정은 지오메트리를 새로 만들지 않고 각도와 배율만 바꿔서 낸다.
 * 손님이 열몇 명씩 서 있으므로 표정 하나 바뀔 때마다 메시를 새로 짜면 안 된다.
 */
export function makeFace(parent: THREE.Object3D, opts?: FaceOptions): FaceParts {
  const o = opts || {};
  /* 처음 지을 때의 표정. 손님은 안 넘겨서 neutral 로 시작하고 곧 상태가 덮어쓴다.
     내 캐릭터·동료 아바타는 유저가 고른 것을 넘기고, 그대로 남는다. */
  const mood = o.mood || 'neutral';

  /* 얼굴 그룹은 머리 한가운데에 둔다. 아래 좌표는 전부 머리 중심 기준이라
     BODY.headY 를 옮겨도 얼굴이 따라온다. */
  const f = new THREE.Group();
  f.position.set(0, BODY.headY, 0);
  f.scale.setScalar(HEAD_SCALE);
  parent.add(f);

  const eyes = [],
    brows = [];
  for (const s of [-1, 1]) {
    // Warm ivory eyes with a larger pupil: relaxed clay features, not googly eyes.
    const e = new THREE.Group();
    e.position.set(s * 0.15, EYE_LOCAL, BODY.faceZ);
    const white = new THREE.Mesh(
      sharedGeo('eye_white_clay', () => new THREE.SphereGeometry(0.067, 24, 16)),
      mat(0xf8f3e7, { flatShading: false }),
    );
    white.scale.set(0.95, 1.0, 0.4);
    e.add(white);
    const pupil = new THREE.Mesh(
      sharedGeo('eye_pupil_clay', () => new THREE.SphereGeometry(0.04, 20, 12)),
      mat(0x332d28, { flatShading: false }),
    );
    pupil.position.set(-s * 0.004, -0.002, 0.025);
    pupil.scale.z = 0.24;
    e.add(pupil);
    const closed = new THREE.Mesh(
      sharedGeo('clay_closed_eye', () => new THREE.TorusGeometry(0.043, 0.009, 8, 20, Math.PI)),
      mat(0x514237, { flatShading: false }),
    );
    closed.position.z = 0.011;
    closed.scale.y = 0.55;
    e.add(closed);
    e.userData.openParts = [white, pupil];
    e.userData.closed = closed;
    f.add(e);
    eyes.push(e);

    const b = new THREE.Mesh(
      sharedGeo('clay_brow', () => new THREE.CapsuleGeometry(0.01, 0.076, 4, 12)),
      mat(o.brow || 0x514237, { flatShading: false }),
    );
    b.geometry = sharedGeo('clay_brow_horizontal', () => b.geometry.clone().rotateZ(Math.PI / 2));
    b.position.set(s * 0.15, EYE_LOCAL + FACE_NEUTRAL[1], 0.354);
    f.add(b);
    b.userData.side = s;
    brows.push(b);
  }

  // 입은 반원 토러스 — z 로 뒤집으면 그대로 찡그린 입이 된다
  const mouth = new THREE.Mesh(
    sharedGeo('mouth_arc_clay', () => new THREE.TorusGeometry(0.082, 0.0105, 8, 24, Math.PI)),
    mat(0x67473b, { flatShading: false }),
  );
  mouth.position.set(0, EYE_LOCAL - BODY.mouthDown, 0.383);
  mouth.rotation.x = 0.45; // lower lip follows the round cheek instead of floating
  f.add(mouth);
  const openMouth = new THREE.Mesh(
    sharedGeo('clay_open_mouth', () => new THREE.SphereGeometry(0.035, 20, 16)),
    mat(0x67473b, { flatShading: false }),
  );
  openMouth.position.copy(mouth.position);
  openMouth.position.y -= 0.012;
  openMouth.scale.set(0.72, 1, 0.24);
  f.add(openMouth);

  const face = {
    group: f,
    eyes,
    brows,
    mouth,
    openMouth,
    mood: null,
    browBaseY: brows[0].position.y,
    mouthBaseY: mouth.position.y,
  };
  setFace(face, mood);
  return face;
}

/** 표정 — 각도와 배율만 건드린다 */
export function setFace(face: FaceParts | null | undefined, mood: string): void {
  if (!face || face.mood === mood) return; // 안 바뀌었으면 손대지 않는다
  face.mood = mood;

  const [tilt, browY, eyeY, mRot, mX, mY] = FACE_POSE[mood] || FACE_NEUTRAL;

  /* 눈썹 높이는 표의 값을 그대로 쓰지 않고 기본값과의 차이만 더한다.
     그래야 얼굴을 위아래로 옮겨도 표가 그대로 살아 있다. */
  face.brows.forEach((b) => {
    b.rotation.z = tilt * b.userData.side;
    b.position.y = face.browBaseY + (browY - FACE_NEUTRAL[1]) * 1.15;
    // Keep brows on the curved forehead when expressions raise them.
    b.position.z =
      Math.sqrt(Math.max(0.04, 1 - (0.15 / 0.43) ** 2 - (b.position.y / 0.425) ** 2)) * 0.4 + 0.014;
  });
  face.eyes.forEach((e, i) => {
    e.scale.set(1, eyeY * (mood === 'smug' && i === 0 ? 0.86 : 1), 1);
    const closed = mood === 'happy' || mood === 'sleepy';
    (e.userData.openParts as THREE.Object3D[] | undefined)?.forEach((o) => {
      o.visible = !closed;
    });
    if (e.userData.closed) {
      e.userData.closed.visible = closed;
      e.userData.closed.rotation.z = mood === 'sleepy' ? Math.PI : 0;
    }
  });
  face.mouth.visible = mood !== 'shocked';
  if (face.openMouth) face.openMouth.visible = mood === 'shocked';

  face.mouth.rotation.z = mRot;
  face.mouth.scale.set(mX, mY, 1);
  // 찡그린 입(∩)은 호가 위로 볼록해서, 같은 자리에 두면 웃는 입보다 높아 보인다
  face.mouth.position.y = face.mouthBaseY + (mRot === 0 ? -0.028 : 0);
}

/* ────────────────────────────────────────────────────────────
   캐릭터 파츠 그리기 — 머리카락 · 얼굴 · 상의

   플레이어가 고른 조합과 손님이 seed 로 받은 조합이 같은 함수를 쓴다.
   그래서 손님이 입은 옷을 플레이어도 그대로 고를 수 있다.

   ⚠ 머리카락은 이마를 가리면 안 된다.
     눈썹이 표정의 절반을 맡는데 머리와 눈썹이 둘 다 짙어서,
     닿는 순간 표정이 통째로 안 보인다. 그래서 앞쪽을 z −0.06 뒤로 물린다.
   ──────────────────────────────────────────────────────────── */

/** 머리카락 — 큰 머리 위에 얕은 돔처럼 얹는다 */
export function buildHair(
  kind: string,
  color: number,
  parent: THREE.Object3D,
): THREE.Object3D | void {
  if (kind !== 'bald') {
    const model = assetOrNull('char/hair/' + kind);
    if (model) {
      // 직접 만든 머리 파츠(custom)만 색을 바꾸고 원본 모자 텍스처는 유지한다.
      tintAssetMaterials(model, color, (_o, m) =>
        String(m.name || '')
          .toLowerCase()
          .includes('custom'),
      );
      parent.add(model);
      return model;
    }
  }

  // The fallback and GLB hair share the same head-centred scale.
  const g = new THREE.Group();
  g.scale.setScalar(HEAD_SCALE);
  g.position.y = BODY.headY * (1 - HEAD_SCALE);
  parent.add(g);

  /* 앞머리가 눈썹에 닿으면 표정이 통째로 죽는다 — 둘 다 짙어서 붙는 순간 구분이
     안 된다. 그래서 통짜 구가 아니라 위쪽만 남긴 돔을 쓴다. 돔의 아래 끝이
     눈썹 위에서 끊기므로, 머리를 아무리 키워도 이마를 덮지 않는다.

     ⚠ 돔 반지름은 반드시 머리보다 커야 한다. 작으면 머리 속에 들어가 한 올도
     안 보인다 — 오류도 안 나고 그냥 대머리가 된다. */
  const dome = (r: number, above: number, flat?: number) => {
    // above = 돔의 아래 끝이 머리 중심보다 몇 m 위인가. 이 값이 클수록 얕은 모자
    const t = Math.acos(Math.max(-1, Math.min(1, above / (r * 0.98))));
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 9, 0, Math.PI * 2, 0, t), mat(color));
    m.position.set(0, BODY.headY, -0.012);
    m.scale.set(1, 0.98, flat || 0.95);
    g.add(m);
    return m;
  };
  const R = BODY.headR + 0.014; // 머리보다 조금 크게 씌운다
  const CLEAR = EYE_LOCAL + BODY.browUp + 0.035; // 눈썹 윗변보다 3.5cm 위에서 끊는다

  switch (kind) {
    case 'short':
      dome(R, CLEAR);
      break;
    case 'bob':
      dome(R + 0.004, CLEAR);
      for (const s of [-1, 1])
        // 귀 옆으로 내려오는 단
        box(0.11, 0.34, 0.32, color, s * 0.415, 1.84, -0.04, g);
      break;
    case 'bun':
      dome(R, CLEAR);
      {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.145, 8, 6), mat(color));
        b.position.set(0, 2.02, -0.36);
        g.add(b);
      } // 뒤로 묶은 쪽
      break;
    case 'spiky':
      dome(R, CLEAR + 0.02);
      for (let i = 0; i < 5; i++) {
        // 위로 삐죽삐죽
        const p = cyl(0.072, 0.24, color, (i - 2) * 0.115, 2.3, -0.05, g, 5, 0.006);
        p.rotation.z = (i - 2) * 0.2;
      }
      break;
    case 'long':
      dome(R + 0.004, CLEAR);
      box(0.58, 0.64, 0.27, color, 0, 1.52, -0.3, g); // 등까지 내려오는 머리
      for (const s of [-1, 1]) box(0.12, 0.5, 0.3, color, s * 0.412, 1.78, -0.03, g);
      break;
    case 'bald':
    default:
      break; // 아무것도 안 얹는다
  }
}

/** 얼굴 소품 — makeFace 가 만든 눈·눈썹·입 위에 더한다 */
export function buildFaceStyle(kind: string, parent: THREE.Object3D, hairColor = 0x715143): void {
  const g = new THREE.Group();
  g.scale.setScalar(HEAD_SCALE);
  g.position.y = BODY.headY * (1 - HEAD_SCALE);
  parent.add(g);
  const FZ = BODY.faceZ;
  switch (kind) {
    case 'glasses':
      for (const s of [-1, 1]) {
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.092, 0.01, 8, 32),
          mat(0x514337, { flatShading: false }),
        );
        rim.position.set(s * 0.145, EYE, FZ + 0.05);
        g.add(rim);
      }
      box(0.11, 0.013, 0.015, 0x514337, 0, EYE, FZ + 0.05, g);
      for (const s of [-1, 1]) {
        const temple = box(0.19, 0.013, 0.014, 0x514337, s * 0.318, EYE, 0.292, g);
        temple.rotation.y = s * 0.7;
      }
      break;
    case 'freckle':
      for (let i = 0; i < 6; i++) {
        const s = i < 3 ? -1 : 1,
          k = i % 3;
        const x = s * (0.2 + k * 0.032),
          y = EYE - 0.1 + (k % 2) * 0.024;
        const z = 0.4 * Math.sqrt(1 - (x / 0.43) ** 2 - ((y - BODY.headY) / 0.425) ** 2) + 0.006;
        const dot = new THREE.Mesh(
          sharedGeo('clay_freckle', () => new THREE.SphereGeometry(0.009, 12, 8)),
          mat(0xa5765a, { flatShading: false }),
        );
        dot.position.set(x, y, z);
        dot.scale.z = 0.35;
        g.add(dot);
      }
      break;
    case 'beard':
      // 입 아래에서 시작해 턱을 감싼다. 더 키우면 입까지 먹어 표정이 죽는다
      {
        const b = new THREE.Mesh(
          new THREE.SphereGeometry(0.23, 24, 16),
          mat(hairColor, { flatShading: false }),
        );
        b.position.set(0, 1.505, 0.233);
        b.scale.set(1, 0.44, 0.46);
        g.add(b);
      }
      break;
    case 'blush':
      for (const s of [-1, 1]) {
        const cheek = new THREE.Mesh(
          new THREE.SphereGeometry(0.052, 24, 16),
          mat(0xc78977, { flatShading: false }),
        );
        cheek.position.set(s * 0.255, 1.705, 0.325);
        cheek.scale.set(1, 0.55, 0.16);
        cheek.rotation.y = s * 0.55;
        g.add(cheek);
      }
      break;
    case 'plain':
    default:
      break;
  }
}

/** 상의 — 짧고 둥근 몸통 위에 덧입힌다 */
export function buildTop(
  kind: string,
  color: number,
  g: THREE.Object3D,
  w: number,
): THREE.Object3D | null {
  const model = assetOrNull('char/top/' + kind);
  if (model) {
    // 앞치마의 흰 천은 유지하고 custom 재질로 만든 부분만 선택 색을 쓴다.
    tintAssetMaterials(model, color, (_o, m) =>
      String(m.name || '')
        .toLowerCase()
        .includes('custom'),
    );
    g.add(model);
    return model;
  }

  const R = (BODY.torsoR + 0.006) * (w || 1);
  const TOP = BODY.shoulderY + 0.025; // 실제 어깨선
  switch (kind) {
    case 'apron':
      box(0.34 * (w || 1), 0.52, 0.03, 0xf2eee4, 0, BODY.torsoY - 0.04, R, g); // 앞치마 천
      box(0.38 * (w || 1), 0.035, 0.03, 0xd8d2c4, 0, TOP - 0.03, R, g); // 목끈
      break;
    case 'stripe':
      for (let i = 0; i < 3; i++) cyl(R, 0.06, color, 0, BODY.torsoY - 0.2 + i * 0.2, 0, g, 12); // 가로 줄
      break;
    case 'hoodie':
      {
        const hd = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 5), mat(color));
        hd.position.set(0, TOP - 0.02, -0.13);
        hd.scale.set(1, 0.62, 0.75);
        g.add(hd);
      }
      box(0.05, 0.26, 0.03, 0xe8e2d6, 0, BODY.torsoY, R, g); // 앞 끈
      break;
    case 'vest':
      for (const s of [-1, 1])
        // 앞섶 두 짝
        box(0.11, 0.46, 0.03, color, s * 0.1, BODY.torsoY - 0.02, R, g);
      cyl(R + 0.006, 0.05, color, 0, TOP - 0.04, 0, g, 12); // 어깨 선
      break;
    case 'tee':
    default:
      cyl(R + 0.005, 0.055, color, 0, TOP - 0.03, 0, g, 12); // 목둘레
      break;
  }
  // 코드로 지은 경우 붙일 모듈이 없다
  return null;
}

/* 모자·헬멧을 쓰는 손님 — 머리카락을 지운다. 안 그러면 모자를 뚫고 나온다 */
const HEAD_COVER = new Set(['📦', '🥾', '🧃', '🎥', '🛵']);
const BALD = PARTS.hair.findIndex((p) => p.id === 'bald');

/* 그 손님을 그 손님이게 하는 부분은 seed 에 맡기지 않고 고정한다 */
const LOOK_FIX: Record<string, Partial<Look>> = {
  '👵': { h: 2, hc: 3 }, // 단골 할머니 — 흰 쪽머리
  '🧔': { f: 3 }, // 진상 아저씨 — 수염
  '🕶️': { f: 1 }, // 까다로운 손님 — 선글라스 자리에 안경
  '🧃': { t: 1 }, // 편의점 알바 — 앞치마
};

/**
 * 손님 조합 — seed 에서 뽑되 위 규칙으로 손본다.
 * 서버가 보내주는 값이 아니라 양쪽이 같은 seed 로 계산해 낸다.
 */
export function customerLook(emoji: string, seed: number): Omit<Look, 'e'> {
  const L = lookFromSeed(seed || 0);
  const fix = LOOK_FIX[emoji];
  if (fix) Object.assign(L, fix);
  if (HEAD_COVER.has(emoji)) L.h = BALD;
  return L;
}

/**
 * 고른 조합을 몸에 입힌다.
 * 머리카락·상의는 몸에, 얼굴 소품은 얼굴이 붙은 그룹에 얹는다.
 */
export function applyLook(
  b: BodyParts,
  look: Partial<Look> | null | undefined,
  build: number,
): void {
  if (!b || !look) return;
  const L = sanitizeLook(look);
  const into = b.rig || b.group;
  if (b.baseModel) {
    tintAssetMaterials(b.baseModel, PART_COLORS.skin[L.sc], (_, m) => m.name === 'skin');
    tintAssetMaterials(b.baseModel, PART_COLORS.shoes[L.shc], (_, m) => m.name === 'shoe');
    tintAssetMaterials(b.baseModel, PART_COLORS.top[L.tc], (o) => /^base(Top|Sleeve)/.test(o.name));
    tintAssetMaterials(b.baseModel, PART_COLORS.bottom[L.bc], (o) =>
      /^base(Bottom|Pants)/.test(o.name),
    );
  }
  buildHair(PARTS.hair[L.h].id, PART_COLORS.hair[L.hc], into);
  const top = buildTop(PARTS.top[L.t].id, PART_COLORS.top[L.tc], into, build || 1);
  if (top && partOf(top, 'garmentBody')) {
    shadeGarment(top, PART_COLORS.top[L.tc]);
    b.baseModel?.traverse((o) => {
      if (/^base(Top|Sleeve)/.test(o.name)) o.visible = false;
    });
    attachGarmentLimbs(top, 'sleeve', b.arms);
  }
  const bottom = assetOrNull('char/bottom/' + PARTS.bottom[L.b].id);
  if (bottom) {
    into.add(bottom);
    shadeGarment(bottom, PART_COLORS.bottom[L.bc]);
    b.baseModel?.traverse((o) => {
      if (/^base(Bottom|Pants)/.test(o.name)) o.visible = false;
    });
    attachGarmentLimbs(bottom, 'trouser', b.legs);
  }
  buildFaceStyle(PARTS.face[L.f].id, into, PART_COLORS.hair[L.hc]);
}

export function shadeGarment(root: THREE.Object3D, color: number | THREE.Color): void {
  tintAssetMaterials(root, color, (_, m) => m.name === 'custom');
  tintAssetMaterials(
    root,
    new THREE.Color(color).multiplyScalar(0.78),
    (_, m) => m.name === 'customShade',
  );
}

/** Modules export in the common foot coordinate system. attach preserves that
 * placement while making each sleeve/pant leg follow its own animated pivot. */
export function attachGarmentLimbs(
  module: THREE.Object3D,
  prefix: string,
  limbs: THREE.Object3D[],
): void {
  ['L', 'R'].forEach((side, i) => {
    const socket = partOf(module, prefix + side);
    if (socket && limbs[i]) limbs[i].attach(socket);
  });
}

/**
 * 손님 종류별 소품 — 이모지 하나로 갈린다.
 * 머리카락·얼굴·상의는 파츠(applyLook)가 맡고, 여기서는 진짜 소품만 붙인다.
 * 둘 다 머리에 얹으면 모자를 뚫고 머리가 솟는다.
 */
export function accessorize(emoji: string, b: BodyParts, color: number): void {
  const g = b.rig || b.group;
  const cap = (c: number) => {
    cyl(0.3, 0.13, c, 0, HEAD_TOP - 0.06, 0, g, 12);
    box(0.38, 0.035, 0.26, c, 0, HEAD_TOP - 0.1, 0.3, g); // 챙
  };
  const pack = (c: number) => box(0.38, 0.42, 0.18, c, 0, 0.92, -0.3, g);
  const ball = (c: number, r: number, x: number, y: number, z: number, sy?: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(c));
    m.position.set(x, y, z);
    if (sy) m.scale.set(1, sy, 1);
    g.add(m);
    return m;
  };

  switch (emoji) {
    /* ── 일반 손님 8종 ── */
    case '🎒':
      pack(0x8a4f3a);
      break;
    case '📦':
      box(0.36, 0.3, 0.28, 0xc9a26b, 0, 1.16, 0.34, g);
      cap(0x3f6b8f);
      break;
    case '👜':
      box(0.2, 0.17, 0.1, 0x7a4a6b, 0.34, 0.86, 0.06, g);
      break;
    case '💼':
      box(0.09, 0.44, 0.02, 0x8a2f38, 0, 1.06, 0.24, g); // 넥타이
      box(0.23, 0.18, 0.08, 0x3a2f28, 0.34, 0.72, 0, g);
      break; // 서류가방
    case '🥾':
      cap(0x4f8f58);
      pack(0x3f6b4a);
      break;
    case '🎈':
      cyl(0.006, 0.7, 0xbbbbbb, 0.3, 1.3, 0.1, g, 4); // 풍선 끈
      ball(0xd96a6a, 0.15, 0.3, 1.78, 0.1, 1.2);
      break;
    case '🧃':
      cap(0x3f8f8a);
      break; // 앞치마는 상의 파츠가 맡는다
    case '🏋️':
      b.torso.scale.set(1.1, 1, 1.1);
      break; // 떡 벌어진 어깨

    /* ── 카운터 진상 6종 ── */
    case '🧔':
      ball(color, 0.26, 0, 0.8, 0.1, 0.9);
      break; // 배 (수염은 얼굴 파츠)
    case '🕶️':
      break; // 선글라스는 얼굴 파츠가 맡는다
    case '👵':
      g.scale.setScalar(0.88);
      break; // 작은 키 (흰 쪽머리는 머리 파츠)
    case '🎥':
      cap(0x2f3540);
      box(0.19, 0.15, 0.22, 0x2a2a2e, 0, 1.3, 0.42, g); // 카메라
      cyl(0.06, 0.06, 0x14141a, 0, 1.3, 0.53, g, 10);
      break;
    case '⭐':
      ball(0xf0c53a, 0.085, 0.19, 1.14, 0.24); // 별 뱃지
      box(0.12, 0.2, 0.02, 0x24242a, -0.26, 0.98, 0.22, g);
      break; // 들고 있는 폰
    case '🛵':
      ball(0xd8443c, 0.448, 0, BODY.headY, 0); // 헬멧
      box(0.48, 0.17, 0.03, 0x1a1a20, 0, EYE, BODY.faceZ + 0.03, g);
      break;
    default:
      break;
  }
}

/**
 * 걷기 — 다리를 서로 반대로, 팔은 그 반대쪽으로 흔든다.
 * 뭘 들고 있으면 팔은 앞으로 모아 둔다. 안 그러면 든 물건이 팔에서 떨어져 나간다.
 * 돌려주는 값은 걸을 때 몸이 들썩이는 높이다.
 */
const LIMB_AXIS_X = new THREE.Vector3(1, 0, 0);
const LIMB_DELTA = new THREE.Quaternion();

export function poseLimbs(b: BodyParts, phase: number, walking: boolean, holding: boolean): number {
  if (!b) return 0;
  const sw = walking ? Math.sin(phase) * 0.62 : 0;
  /* GLB 뼈에는 Blender→glTF 축 변환용 기본 회전(현재 X축 180°)이 있다.
     rotation.x를 바로 대입하면 그 보정이 사라져 다리가 몸통 안으로 접힌다.
     원래 쿼터니언을 되살린 뒤 로컬 X축 보행 각도만 곱한다. */
  const pose = (
    part: THREE.Object3D | undefined,
    rest: THREE.Quaternion | undefined,
    angle: number,
  ) => {
    if (!part) return;
    if (rest) part.quaternion.copy(rest).multiply(LIMB_DELTA.setFromAxisAngle(LIMB_AXIS_X, angle));
    else part.rotation.x = angle;
  };
  pose(b.legs[0], b.legRest && b.legRest[0], sw);
  pose(b.legs[1], b.legRest && b.legRest[1], -sw);
  if (holding) {
    pose(b.arms[0], b.armRest && b.armRest[0], -0.95);
    pose(b.arms[1], b.armRest && b.armRest[1], -0.95);
  } else {
    pose(b.arms[0], b.armRest && b.armRest[0], -sw * 0.72);
    pose(b.arms[1], b.armRest && b.armRest[1], sw * 0.72);
  }
  return walking ? Math.abs(Math.sin(phase)) * 0.063 : 0;
}

export function makeOutline(parent: THREE.Object3D, build: number): OutlineParts {
  // depthTest 는 반드시 켠 채로 둔다. 볼록 셸의 BackSide 는 실루엣 전체를 덮으므로
  // 깊이 검사를 끄면 테두리가 아니라 손님이 통째로 단색 덩어리가 되고 벽까지 뚫는다.
  const skin = () =>
    new THREE.MeshBasicMaterial({
      color: OUTLINE_COLOR,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
  const g = new THREE.Group();

  // 몸통·머리가 재질을 따로 갖는다 — 손님이 나갈 때 disposeObject 가 같은 걸 두 번 놓지 않게
  const R = (BODY.shoulderX + BODY.armR + 0.055) * (build || 1);
  const bodyH = BODY.shoulderY + 0.1;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyH, 14), skin());
  body.position.y = bodyH / 2;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(BODY.headR * HEAD_SCALE + 0.02, 12, 8),
    skin(),
  );
  head.position.y = BODY.headY;

  g.add(body, head);
  g.visible = false;
  parent.add(g);
  return { group: g, body, head, r: R };
}

/**
 * 거리가 멀어져도 테두리가 화면에서 같은 두께로 보이게 배율을 구한다.
 * 고정 배율로 두면 조리대(10m 남짓)에서 2px 로 녹아버린다.
 */
export const rimScale = (kk: number, dist: number, r: number, max: number): number =>
  Math.min(max, 1 + (kk * dist) / r);

/**
 * 손님 머리 위 체력바 — 칸 하나가 빗자루 한 대다.
 * 손님은 카운터(+z)를 보고 서 있으니 평면을 그대로 붙이면 정면으로 보인다.
 */
export function makeHpBar(hpMax: number, parent: THREE.Object3D): HpBar {
  const W = 0.86,
    H = 0.09,
    GAP = 0.022;
  const sw = (W - GAP * (hpMax - 1)) / hpMax;
  const g = new THREE.Group();

  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.07, H + 0.07),
    new THREE.MeshBasicMaterial({
      color: 0x140f0b,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  g.add(bg);

  const segs = [];
  for (let i = 0; i < hpMax; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, H),
      new THREE.MeshBasicMaterial({ color: 0x58c07a }),
    );
    m.position.set(-W / 2 + sw / 2 + i * (sw + GAP), 0, 0.003);
    g.add(m);
    segs.push(m);
  }
  g.position.set(0, 2.42, 0.46); // 몸(2.13) 위
  parent.add(g);
  return { group: g, segs, shown: -1 };
}

/** 남은 칸 수에 따라 색을 바꾼다 — 한 대 남으면 빨강 */
export function paintHp(bar: HpBar, hp: number): void {
  if (bar.shown === hp) return; // 안 바뀌었으면 건드리지 않는다
  bar.shown = hp;
  const live = hp <= 1 ? 0xe05252 : hp <= 2 ? 0xf5b942 : 0x58c07a;
  bar.segs.forEach((m, i) => m1(m).color.setHex(i < hp ? live : 0x3a2f28));
}

/**
 * 입장 화면 미리보기용 몸 한 채.
 * 게임에서 쓰는 makeBody / applyLook 을 그대로 타므로
 * 여기서 보이는 모습이 실제로 보일 모습과 같다.
 */
export function previewBody(look: Partial<Look> | null | undefined): THREE.Group {
  const L = sanitizeLook(look);
  const b = makeBody(0xc9c2b4);
  makeFace(b.rig, { mood: characterMood(L.e) });
  applyLook(b, look, 1);
  b.group.userData.limbs = b;
  return b.group;
}

export function animatePreviewBody(
  group: THREE.Group,
  seconds: number,
  walking = false,
  holding = false,
): void {
  group.position.y = poseLimbs(group.userData.limbs, seconds * 7, walking, holding);
}

export function disposePreviewBody(group: THREE.Object3D): void {
  disposeObject(group);
}

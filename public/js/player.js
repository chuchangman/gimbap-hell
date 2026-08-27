/* ────────────────────────────────────────────────────────────
   1인칭 컨트롤러 — WASD 이동, 마우스 시점, 충돌, 조준 상호작용, 빗자루 스윙
   위치는 NET.tickMs 마다 서버에 보내고, 다른 사람은 서버가 알려준 위치로 그린다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from '/vendor/three.module.min.js';
import { COMBAT, QUEUE_Z, slotX, NET } from './config.js';
import {
  camera, interactables, solids, bumpHand, setSwingProgress, setArmBob
} from './world.js';
import { S, emit, myHand, isPlaying, remotePositions } from './net.js';
import { resolveAction, dropHand, swingBroom } from './kitchen.js';

const keys = Object.create(null);
const RADIUS = 0.34;      // 플레이어 반지름 (충돌)
const EYE = 1.62;         // 눈높이
const SPEED = 3.6;
const RUN = 6.2;
const REACH = 2.9;        // 상호작용 사거리

/* 점프 / 중력 / 넉백 */
const GRAVITY = -24;
const JUMP_V = 6.2;
const HIT_LAUNCH = 5.0;   // 빗자루에 맞으면 뜨는 높이
const AIR_CONTROL = 2.4;  // 공중에서 방향을 얼마나 바꿀 수 있나

let yaw = 0;              // yaw=0 → -z (서빙 창구) 를 본다
let pitch = 0;
let locked = false;
let bob = 0;
let height = 0;
let velY = 0;
let airborne = false;
const moveVel = { x: 0, z: 0 };
const knock = { x: 0, z: 0 };
let shakeUntil = 0;
let swingUntil = 0;
let lastSent = 0;

export const state = {
  target: null,
  prompt: null,
  canvas: null,
  overlayOpen: false,
  enabled: false,
  onToggleHelp: () => {},
  onCloseOverlay: () => {}
};

/* ──────────────── 입력 ──────────────── */
export function initPlayer(canvas) {
  state.canvas = canvas;

  canvas.addEventListener('click', () => {
    if (!state.overlayOpen && state.enabled) canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });

  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-1.35, Math.min(1.35, pitch));
  });

  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') state.onCloseOverlay();
      return;
    }
    keys[e.code] = true;

    if (e.code === 'Escape') { state.onCloseOverlay(); return; }
    if (e.code === 'KeyH' || e.code === 'Tab') { e.preventDefault(); state.onToggleHelp(); return; }
    if (state.overlayOpen || !state.enabled) return;

    if (e.code === 'KeyE') { e.preventDefault(); interact(); }
    else if (e.code === 'KeyQ') { dropHand(); bumpHand(); }
    else if (e.code === 'Space') e.preventDefault();
  });

  document.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // 좌클릭: 빗자루를 들었으면 휘두르기, 아니면 상호작용
  document.addEventListener('mousedown', (e) => {
    if (!locked || state.overlayOpen || !state.enabled || e.button !== 0) return;
    if (hasBroom()) swing();
    else interact();
  });
}

export function releaseLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}
export function isLocked() { return locked; }

const hasBroom = () => {
  const h = myHand();
  return !!h && h.id === 'broom';
};

export const isSwinging = () => performance.now() < swingUntil;

/* ──────────────── 🧹 스윙 ──────────────── */
/** 조준 방향 앞쪽에서 가장 가까운 동료를 찾는다 (서버가 다시 검사한다) */
function pickTarget() {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best = null, bestD = Infinity;
  const consider = (id, kind, x, z) => {
    const dx = x - camera.position.x;
    const dz = z - camera.position.z;
    const d = Math.hypot(dx, dz);
    if (d > COMBAT.range || d < 0.001) return;
    if ((dx / d) * fx + (dz / d) * fz < COMBAT.cone) return;
    if (d < bestD) { bestD = d; best = { id, kind }; }
  };

  for (const o of remotePositions()) {
    consider(o.id, 'player', o.x, o.z);   // 화면에 보이는 자리로 조준한다
  }
  // 카운터 손님도 때릴 수 있다
  const w = S.state && S.state.wave;
  for (const c of (w && w.customers) || []) {
    if (c.state !== 'wait') continue;
    consider(c.id, 'customer', slotX(c.slot), QUEUE_Z);
  }
  return best;
}

function swing() {
  if (performance.now() < swingUntil - 200 + COMBAT.cooldown) return;
  swingUntil = performance.now() + 260;

  // 십자선으로 손님을 정확히 겨냥했으면 그 손님이 우선이다
  const st = state.target && state.target.userData.station;
  if (st && st.kind === 'customer') return swingBroom(st.id, 'customer');

  const t = pickTarget();
  swingBroom(t ? t.id : null, t ? t.kind : null);
}

/** 서버가 알려준 방향으로 밀려난다 — 포물선을 그리며 날아간다 */
export function applyKnockback(dirX, dirZ, power) {
  knock.x = dirX * power;
  knock.z = dirZ * power;
  velY = HIT_LAUNCH;
  height = Math.max(height, 0.01);
  airborne = true;
  shakeUntil = performance.now() + 320;
}

function shakeOffset() {
  const left = shakeUntil - performance.now();
  if (left <= 0) return 0;
  return Math.sin(left * 0.09) * 0.04 * (left / 320);
}

/* ──────────────── 조준 ──────────────── */
const ray = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);

function aim() {
  ray.setFromCamera(CENTER, camera);
  const hits = ray.intersectObjects(interactables, false);
  for (const h of hits) {
    if (h.distance <= REACH) return h.object;
  }
  return null;
}

function interact() {
  const a = state.prompt;
  if (a && !a.disabled && a.run) {
    a.run();
    bumpHand();
  }
}

/* ──────────────── 충돌 ──────────────── */
/** 동료를 통과할 수 없다 (원-원) */
function collidePlayers(pos) {
  const MIN = RADIUS * 2;
  for (const other of remotePositions()) {
    const dx = pos.x - other.x;
    const dz = pos.z - other.z;
    const d = Math.hypot(dx, dz);
    if (d >= MIN) continue;
    if (d < 0.001) { pos.x += MIN; continue; }
    pos.x = other.x + (dx / d) * MIN;
    pos.z = other.z + (dz / d) * MIN;
  }
}

/** 주방 집기(AABB) 밖으로 밀어낸다 */
function collide(pos) {
  for (const s of solids) {
    const cx = Math.max(s.minX, Math.min(pos.x, s.maxX));
    const cz = Math.max(s.minZ, Math.min(pos.z, s.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= RADIUS * RADIUS) continue;

    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * RADIUS;
      pos.z = cz + (dz / d) * RADIUS;
    } else {
      const left = Math.abs(pos.x - s.minX), right = Math.abs(s.maxX - pos.x);
      const front = Math.abs(pos.z - s.minZ), back = Math.abs(s.maxZ - pos.z);
      const m = Math.min(left, right, front, back);
      if (m === left) pos.x = s.minX - RADIUS;
      else if (m === right) pos.x = s.maxX + RADIUS;
      else if (m === front) pos.z = s.minZ - RADIUS;
      else pos.z = s.maxZ + RADIUS;
    }
  }
  pos.x = Math.max(-7.6, Math.min(7.6, pos.x));
  pos.z = Math.max(-10.6, Math.min(8.6, pos.z));
}

/* ──────────────── 매 프레임 ──────────────── */
export function updatePlayer(dt) {
  const canMove = state.enabled && !state.overlayOpen && isPlaying();

  let mx = 0, mz = 0;
  if (canMove) {
    if (keys.KeyW || keys.ArrowUp) mz -= 1;
    if (keys.KeyS || keys.ArrowDown) mz += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
  }

  const len = Math.hypot(mx, mz);
  const running = keys.ShiftLeft || keys.ShiftRight;
  const speed = running ? RUN : SPEED;

  let wx = 0, wz = 0;
  if (len > 0) {
    mx /= len; mz /= len;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    wx = (mx * cos + mz * sin) * speed;
    wz = (mz * cos - mx * sin) * speed;
  }

  if (canMove && keys.Space && !airborne) {
    velY = JUMP_V;
    airborne = true;
  }

  if (airborne) {
    // 공중에서는 이륙 순간의 속도를 이어가고 방향만 살짝 튼다 → 포물선
    const k = Math.min(1, AIR_CONTROL * dt);
    moveVel.x += (wx - moveVel.x) * k;
    moveVel.z += (wz - moveVel.z) * k;
  } else {
    moveVel.x = wx;
    moveVel.z = wz;
  }

  velY += GRAVITY * dt;
  height += velY * dt;
  if (height <= 0) { height = 0; velY = 0; airborne = false; }
  else airborne = true;

  // 넉백은 착지 후에만 마찰로 줄어든다 (공중에서는 궤적 유지)
  if (!airborne && (knock.x || knock.z)) {
    const decay = Math.exp(-7 * dt);
    knock.x *= decay;
    knock.z *= decay;
    if (Math.hypot(knock.x, knock.z) < 0.05) { knock.x = 0; knock.z = 0; }
  }

  const pos = { x: camera.position.x, z: camera.position.z };
  pos.x += (moveVel.x + knock.x) * dt;
  pos.z += (moveVel.z + knock.z) * dt;
  collidePlayers(pos);
  collide(pos);
  camera.position.x = pos.x;
  camera.position.z = pos.z;

  bob += dt * (airborne ? 0 : (len > 0 ? (running ? 14 : 9) : 2));
  const bobY = airborne ? 0 : Math.sin(bob) * (len > 0 ? 0.035 : 0.008);
  camera.position.y = EYE + height + bobY + shakeOffset();

  // 1인칭 팔도 걸음에 맞춰 흔들린다
  setArmBob(airborne ? 0 : Math.hypot(moveVel.x, moveVel.z), dt);

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  // 레이캐스트는 matrixWorld 를 쓰므로 먼저 갱신한다
  camera.updateMatrixWorld();

  // 휘두르는 모션
  const swingLeft = swingUntil - performance.now();
  setSwingProgress(swingLeft > 0 ? 1 - swingLeft / 260 : 0);

  // 조준
  const obj = (state.overlayOpen || !state.enabled) ? null : aim();
  state.target = obj;
  state.prompt = obj ? resolveAction(obj.userData.station) : null;

  // 위치 동기화 — 받는 쪽이 보간하므로 이 주기가 부드러움의 상한이다
  const t = performance.now();
  if (state.enabled && t - lastSent > NET.tickMs) {
    lastSent = t;
    emit('player:move', { x: camera.position.x, z: camera.position.z, y: height, ry: yaw });
  }
}

/** 라운드 시작 위치 — 서버가 정해준 자리에서 서빙 창구를 본다 */
export function resetPose(spawn) {
  const s = spawn || { x: 0, z: 6.2 };
  camera.position.set(s.x, EYE, s.z);
  yaw = 0; pitch = 0;
  height = 0; velY = 0; airborne = false;
  moveVel.x = 0; moveVel.z = 0;
  knock.x = 0; knock.z = 0;
  bob = 0;
}

/** 시점 직접 지정 (디버깅/자동 검증용) */
export function setLook(y, p) {
  yaw = y;
  pitch = Math.max(-1.35, Math.min(1.35, p));
}

export function getPose() {
  return { x: camera.position.x, z: camera.position.z, yaw, pitch };
}

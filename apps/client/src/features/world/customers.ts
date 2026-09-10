/* ────────────────────────────────────────────────────────────
   손님 · 동료 아바타 · 원격 스윙
   레거시 world.js 2572-2877 줄을 그대로 옮겼다.
   ──────────────────────────────────────────────────────────── */
import { focusNow } from '@/features/kitchen/kitchen';
import { handOf, remotePositions, S, serverNow } from '@/features/net/net';
import type { BodyParts, FaceParts } from '@/features/world/character';
import {
  accessorize,
  applyLook,
  BODY,
  characterMood,
  customerLook,
  HEAD_SCALE,
  makeBody,
  makeFace,
  makeHpBar,
  makeOutline,
  OUTLINE_PX,
  OUTLINE_TAN,
  OUTLINE_TIE,
  paintHp,
  poseLimbs,
  rimScale,
  setFace,
} from '@/features/world/character';
import { makeItemMesh } from '@/features/world/items';
import { m1, ownMat } from '@/features/world/materials';
import { fittedPanel, Panel } from '@/features/world/panel';
import { disposeObject } from '@/features/world/primitives';
import type { CustomerEntry } from '@/features/world/registry';
import { D } from '@/features/world/registry';
import {
  camera,
  DOOR,
  HIT_FLINCH_MS,
  interactables,
  scene,
  viewportHeight,
} from '@/features/world/scene';
import {
  CHARACTER_MOTION,
  CUSTOMER_HP,
  grumbleFor,
  ITEMS,
  KIND,
  QUEUE_Z,
  sanitizeLook,
  slotX,
  WALK_IN_MS,
  WALK_OUT_MS,
  type Look,
} from '@repo/game-core';
import type { CustomerView } from '@repo/types';
import * as THREE from 'three';

export function makeCustomer(info: CustomerView): CustomerEntry {
  const counter = info.kind === KIND.COUNTER;
  const look = customerLook(info.emoji, info.seed);
  // 진상은 덩치부터 다르게 — 색만 다르면 줄 서 있을 때 누가 진상인지 모른다
  const b = makeBody(info.color, { build: counter ? 1.12 : 1 });
  const g = b.group;
  /* 고른 조합 — 손님은 seed 에서 뽑는다. 네트워크로 오는 값이 아니다.
     소품(백팩·헬멧 등)은 그 위에 덧붙는다. */
  applyLook(b, look, counter ? 1.12 : 1);
  // 직접 만든 모델은 소품까지 들고 있다고 본다 — 코드가 또 붙이면 겹친다
  accessorize(info.emoji, b, info.color);
  const face = makeFace(b.rig, counter ? { brow: 0x5a2f28 } : undefined);
  // 아바타는 얼굴이 로컬 +z 를 향한다. 손님은 카운터(자기보다 +z 쪽)를 본다.
  g.rotation.y = 0;

  const name = fittedPanel(info.emoji + ' ' + info.name, 1.0, false);
  name.text(info.emoji + ' ' + info.name, { color: counter ? '#ff9b9b' : '#cfe9f5' });
  name.sprite.position.set(0, 2.72, 0);
  g.add(name.sprite);

  const order = new Panel(384, 132, 1.5, false);
  order.sprite.position.set(0, 2.14, 0);
  g.add(order.sprite);

  // 조준용 히트박스 — 이 손님을 겨냥해 서빙한다
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 2.16, 0.95),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  hit.position.y = 1.08;
  hit.renderOrder = -1;
  hit.userData.station = { kind: 'customer', id: info.id };
  g.add(hit);
  interactables.push(hit);

  const bubble = new Panel(320, 76, 1.35, false);
  bubble.sprite.position.set(0, 3.06, 0);
  bubble.sprite.visible = false;
  g.add(bubble.sprite);

  const hpMax = info.hpMax || CUSTOMER_HP[counter ? 'special' : 'normal'] || 3;
  const hp = makeHpBar(hpMax, g);
  const outline = makeOutline(b.rig, counter ? 1.12 : 1);

  scene.add(g);
  return {
    group: g,
    name,
    order,
    bubble,
    hit,
    hp,
    outline,
    body: ownMat(b.torso),
    limbs: b,
    face, // 피격 번쩍임이 emissive 를 바꾼다
    lastLine: null,
    lastBand: -1,
    lastHp: hpMax,
    hitAt: -9999,
  };
}

export function customerPos(c: CustomerView, t: number) {
  const tx = slotX(c.slot),
    tz = QUEUE_Z;
  if (c.state === 'walkin') {
    const p = Math.min(1, (t - c.since) / WALK_IN_MS);
    return { x: DOOR.x + (tx - DOOR.x) * p, z: DOOR.z + (tz - DOOR.z) * p, walking: p < 1 };
  }
  if (c.state === 'happy' || c.state === 'angry' || c.state === 'kicked') {
    const p = Math.min(1, (t - c.since) / WALK_OUT_MS);
    return { x: tx + (DOOR.x - tx) * p, z: tz + (DOOR.z - tz) * p, walking: true };
  }
  return { x: tx, z: tz, walking: false };
}

export function syncCustomers(): void {
  const w = S.state && S.state.wave;
  // 일반 손님이든 진상이든 모두 카운터에 세운다
  const list = (w && w.customers) || [];
  const t = serverNow();
  const seen = new Set();
  const focus = focusNow(); // 🎯 내 화면에서만 쓰는 대상 표시
  const glow = 0.84 + Math.sin(t / 190) * 0.14; // 0.70~0.98 — 항상 OUTLINE_TIE 보다 밝다
  // 거리 → 배율 환산 계수. 프레임당 한 번만 구한다
  const kk = (OUTLINE_PX * 2 * OUTLINE_TAN) / Math.max(1, viewportHeight());

  for (const c of list) {
    seen.add(c.id);
    let d = D.customers.get(c.id);
    if (!d) {
      d = makeCustomer(c);
      D.customers.set(c.id, d);
    }

    /* 🧹 맞았나? — 체력이 줄어든 프레임에 움찔거리게 한다 */
    const hp = c.hp == null ? d.lastHp : c.hp;
    if (hp < d.lastHp) d.hitAt = t;
    d.lastHp = hp;
    const sinceHit = t - d.hitAt;
    const flinch = sinceHit < HIT_FLINCH_MS ? 1 - sinceHit / HIT_FLINCH_MS : 0;

    const pos = customerPos(c, t);
    d.group.position.x = pos.x + (flinch ? Math.sin(sinceHit / 22) * 0.12 * flinch : 0);
    d.group.position.z = pos.z;
    // 다리가 걷고, 몸은 그 보폭만큼만 들썩인다
    d.group.position.y = poseLimbs(d.limbs as BodyParts, t / 128, pos.walking, false);

    const leaving = c.state === 'happy' || c.state === 'angry' || c.state === 'kicked';
    d.group.rotation.y = leaving ? Math.PI : 0;
    if (d.body) m1(d.body).emissive.setHex(flinch > 0 ? 0x882020 : 0x000000);

    /* 표정 — 맞았으면 놀란 얼굴이 먼저다.
       기다리는 동안에는 남은 인내심이 그대로 얼굴에 나온다. */
    let mood;
    if (flinch > 0 || c.state === 'kicked') mood = 'shocked';
    else if (c.state === 'happy') mood = 'happy';
    else if (c.state === 'angry') mood = 'angry';
    else if (c.patienceMax) {
      const p = Math.max(0, Math.min(1, (c.deadline - t) / 1000 / c.patienceMax));
      mood =
        p > 0.5
          ? c.kind === KIND.COUNTER
            ? 'annoyed'
            : 'neutral'
          : p > 0.25
            ? 'annoyed'
            : 'angry';
    } else mood = c.kind === KIND.COUNTER ? 'annoyed' : 'neutral';
    setFace(d.face as FaceParts, mood);

    /* 🎯 내가 든 김밥과 제일 잘 맞는 손님만 테두리를 두른다.
       동점이 여럿이면 전부 켜되, 실제로 나갈 한 명만 밝게 숨쉰다. */
    const lit = c.state === 'wait' && focus.outline.has(c.id);
    d.outline.group.visible = lit;
    if (lit) {
      const far = Math.hypot(pos.x - camera.position.x, pos.z - camera.position.z);
      const o = c.id === focus.focusId ? glow : OUTLINE_TIE;
      m1(d.outline.body).opacity = o;
      m1(d.outline.head).opacity = o;
      const bs = rimScale(kk, far, d.outline.r, 1.4);
      d.outline.body.scale.set(bs, 1.05, bs); // y 는 1.05 고정 — 1.0 이면 어깨 테두리가 끊긴다
      d.outline.head.scale.setScalar(rimScale(kk, far, BODY.headR * HEAD_SCALE, 1.28));
    }

    /* 체력바 — 기다리는 동안에만 보여준다 */
    const showHp = c.state === 'wait' && c.hp != null;
    d.hp.group.visible = showHp;
    if (showHp) paintHp(d.hp, c.hp);

    d.group.updateMatrixWorld(true); // 조준(레이캐스트)이 한 프레임 밀리지 않게

    if (c.state === 'wait') {
      const left = Math.max(0, (c.deadline - t) / 1000);
      const pct = Math.max(0, Math.min(1, left / c.patienceMax));
      const color = pct > 0.5 ? '#58c07a' : pct > 0.25 ? '#f5b942' : '#e05252';
      // 서버의 targetId 는 내 손에 뭐가 들렸는지 모른다 — 내 기준으로 다시 고른다
      const isTarget = focus.focusId === c.id;
      d.order.order(
        '🍣 김밥 ' + c.need + '줄' + (isTarget ? '  ◀ 다음' : ''),
        c.fills.map((id) => ITEMS[id].name).join(' · '),
        pct,
        color,
        Math.ceil(left) + '초',
      );
      d.order.sprite.visible = true;

      // 궁시렁은 진상 손님만 — 인내심 구간이 바뀔 때만 대사를 새로 뽑는다
      if (c.kind === KIND.COUNTER) {
        const band = pct > 0.66 ? 0 : pct > 0.38 ? 1 : pct > 0.15 ? 2 : 3;
        if (d.lastBand !== band) {
          d.lastBand = band;
          d.lastLine = grumbleFor(pct, c.seed + band);
        }
        d.bubble.text(
          d.lastLine!,
          band >= 2
            ? { color: '#b32020', bg: 'rgba(255,235,235,.95)', scale: 0.4 }
            : { color: '#2a2118', bg: 'rgba(255,255,255,.92)', scale: 0.4 },
        );
        d.bubble.sprite.visible = true;
        d.bubble.sprite.position.y = 3.06 + Math.sin(t / 420) * 0.03;
      } else {
        d.bubble.sprite.visible = false;
      }
    } else if (c.state === 'happy') {
      d.order.text('😋 잘 먹을게요!', { color: '#8fe6a8' });
      d.order.sprite.visible = true;
      if (c.kind === KIND.COUNTER) {
        d.bubble.text('오, 이건 인정', {
          color: '#2f6b41',
          bg: 'rgba(235,255,240,.95)',
          scale: 0.4,
        });
        d.bubble.sprite.visible = true;
      } else d.bubble.sprite.visible = false;
    } else if (c.state === 'kicked') {
      d.order.text('🤬 알았어, 간다고!', { color: '#ffb0b0' });
      d.order.sprite.visible = true;
      d.bubble.text('여기 두 번 다시 안 와', {
        color: '#b32020',
        bg: 'rgba(255,235,235,.95)',
        scale: 0.4,
      });
      d.bubble.sprite.visible = true;
    } else if (c.state === 'angry') {
      d.order.text('😡 됐어요, 갈게요!', { color: '#ff8a8a' });
      d.order.sprite.visible = true;
      if (c.kind === KIND.COUNTER) {
        d.bubble.text('별점 1개다 진짜', {
          color: '#b32020',
          bg: 'rgba(255,235,235,.95)',
          scale: 0.4,
        });
        d.bubble.sprite.visible = true;
      } else d.bubble.sprite.visible = false;
    } else {
      d.order.sprite.visible = false;
      d.bubble.sprite.visible = false;
    }
  }

  for (const [id, d] of D.customers) {
    if (seen.has(id)) continue;
    const at = interactables.indexOf(d.hit);
    if (at >= 0) interactables.splice(at, 1); // 조준 대상에서 빼준다
    scene.remove(d.group);
    disposeObject(d.group);
    D.customers.delete(id);
  }
}

/* ────────────────────────────────────────────────────────────
   동료 아바타
   ──────────────────────────────────────────────────────────── */
export function makeAvatar(name: string, color: string | number, look: Partial<Look> | null) {
  const L = sanitizeLook(look);
  const b = makeBody(new THREE.Color(color).getHex());
  const g = b.group;
  applyLook(b, look, 1);
  makeFace(g, { mood: characterMood(L.e) });
  const p = fittedPanel(name, 1.5, false);
  p.text(name, { color: '#fff' });
  p.sprite.position.y = 2.52;
  g.add(p.sprite);
  g.userData.limbs = b; // 걷기 모션이 쓴다
  scene.add(g);
  return g;
}

const SWING_MS = CHARACTER_MOTION.swingMs;
const swingAt = new Map();

export function remoteSwing(playerId: string): void {
  swingAt.set(playerId, performance.now());
}

export function applyRemoteSwing(av: THREE.Object3D, id: string): void {
  const m = av.userData.handMesh;
  const base = av.userData.handBase;
  if (!m || !base) return;
  const started = swingAt.get(id);
  const t = started === undefined ? 1.1 : (performance.now() - started) / SWING_MS;
  if (t >= 1) {
    if (av.userData.swinging) {
      m.position.copy(base.pos);
      m.rotation.copy(base.rot);
      av.userData.swinging = false;
    }
    return;
  }
  av.userData.swinging = true;
  const DOWN = 0.35;
  const p = t < DOWN ? Math.pow(t / DOWN, 0.6) : 1 - Math.pow((t - DOWN) / (1 - DOWN), 1.4);
  m.rotation.z = base.rot.z + p * 3.3;
  m.rotation.x = base.rot.x - p * 0.5;
  m.position.x = base.pos.x - p * 0.5;
  m.position.y = base.pos.y - p * 0.35;
  m.position.z = base.pos.z + p * 0.25;
}

export function updateRemotes(): void {
  const seen = new Set();
  const players = (S.state && S.state.players) || [];

  for (const pos of remotePositions()) {
    seen.add(pos.id);
    const info = players.find((p) => p.id === pos.id);
    let av = D.remotes.get(pos.id);
    if (!av) {
      av = makeAvatar(
        info ? info.name : '알바',
        info ? info.color : '#f5b942',
        (info && info.look) || null,
      );
      D.remotes.set(pos.id, av);
    }
    /* 보간이 이미 부드러우므로 그대로 놓는다.
       여기서 또 감쇠를 걸면 두 번 늦어지고 방향 전환이 뭉개진다. */
    /* 서버가 속도를 보내주지 않으므로 위치가 얼마나 움직였는지로 걸음을 만든다.
       걸음 위상을 이동 거리로 굴리면 빨리 갈수록 보폭이 빨라진다. */
    const last = av.userData.lastPos;
    const moved = last ? Math.hypot(pos.x - last.x, pos.z - last.z) : 0;
    av.userData.lastPos = { x: pos.x, z: pos.z };
    av.userData.phase = (av.userData.phase || 0) + moved * 9;

    const holding = handOf(pos.id);
    const bob = poseLimbs(av.userData.limbs, av.userData.phase, moved > 0.004, !!holding);
    av.position.set(pos.x, (pos.y || 0) + bob, pos.z);
    av.rotation.y = pos.ry + Math.PI;
    const key = holding ? holding.uid : 'none';
    if (av.userData.handKey !== key) {
      av.userData.handKey = key;
      if (av.userData.handMesh) {
        av.remove(av.userData.handMesh);
        disposeObject(av.userData.handMesh);
        av.userData.handMesh = null;
      }
      if (holding) {
        const m = makeItemMesh(holding);
        if (holding.id === 'broom') {
          m.position.set(0.42, 1.47, 0.39);
          m.rotation.set(0, 0, Math.PI - 0.45);
          m.scale.setScalar(0.9);
        } else {
          m.position.set(0, 1.33, 0.63);
        }
        av.add(m);
        av.userData.handMesh = m;
        av.userData.handBase = { pos: m.position.clone(), rot: m.rotation.clone() };
        av.userData.swinging = false;
      }
    }
  }

  for (const [id, av] of D.remotes) applyRemoteSwing(av, id);

  for (const [id, av] of D.remotes) {
    if (seen.has(id)) continue;
    scene.remove(av);
    disposeObject(av);
    D.remotes.delete(id);
    swingAt.delete(id);
  }
}

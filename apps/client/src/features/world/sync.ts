import type * as THREE from 'three';
/* ────────────────────────────────────────────────────────────
   서버 상태 → 3D. 매 프레임 스냅샷을 보고 설비 모습을 맞춘다.
   레거시 world.js 1673-1882 줄을 그대로 옮겼다.
   ──────────────────────────────────────────────────────────── */
import {
  boardInfo,
  broomTaken,
  burnerInfo,
  cookerAt,
  cookerProgress,
  matAt,
  rollProgress,
  sinkAt,
  unlockedFills,
} from '@/features/kitchen/kitchen';
import { makeItemMesh } from '@/features/world/items';
import { m1, ownMat } from '@/features/world/materials';
import { disposeObject, kill } from '@/features/world/primitives';
import { D } from '@/features/world/registry';
import { scene } from '@/features/world/scene';
import { applyBurnTint, collectTintTargets } from '@/features/world/tint';
import { C, ITEMS, TIME } from '@repo/game-core';

/* ────────────────────────────────────────────────────────────
   서버 상태 → 3D
   ──────────────────────────────────────────────────────────── */
export function syncSink(): void {
  // buildSink 가 반드시 채운다 — 레거시도 같은 가정이다
  const d = D.sink!;
  const s = sinkAt();
  if (!s) {
    if (d.riceMesh) d.riceMesh = kill(d.riceMesh);
    d.water.visible = false;
    d.panel.sprite.visible = false;
    return;
  }
  if (!d.riceMesh) {
    d.riceMesh = makeItemMesh({ id: 'rice', stage: 'raw' });
    d.riceMesh.position.set(d.basinX, 1.1, d.basinZ);
    scene.add(d.riceMesh);
  }
  const washing = s.rinses < TIME.riceRinse;
  d.water.visible = washing;
  if (washing) {
    d.water.scale.y = 0.8 + Math.sin(performance.now() / 60) * 0.2;
    d.riceMesh.position.y = 1.1 + Math.sin(performance.now() / 90) * 0.012;
    d.panel.gauge(
      '쌀 씻기',
      s.rinses / TIME.riceRinse,
      '#63a8e8',
      '헹굼 ' + s.rinses + ' / ' + TIME.riceRinse,
    );
  } else {
    d.panel.gauge('다 씻었다', 1, '#58c07a', 'E 로 집기');
  }
  d.panel.sprite.visible = true;
}

export function syncCookers(): void {
  for (let i = 0; i < D.cookers.length; i++) {
    const d = D.cookers[i];
    const c = cookerAt(i);
    if (!c) continue;
    const cooking = c.state === 'cooking';
    const p = cookerProgress(i);

    d.panel.sprite.visible = c.state !== 'empty';
    if (cooking) {
      d.panel.gauge('취사 중', p, '#f5b942', (TIME.riceCook * (1 - p)).toFixed(1) + '초 남음');
      if (d.lid) d.lid.position.y = 0.27 + Math.sin(performance.now() / 70) * 0.006;
    } else if (c.state === 'ready') {
      d.panel.gauge('밥 완성', 1, '#58c07a', '남은 밥 ' + c.servings + '인분');
      if (d.lid) d.lid.position.y = 0.27;
    }

    d.steam.forEach((s, j) => {
      if (!cooking) {
        s.mesh.visible = false;
        return;
      }
      s.mesh.visible = true;
      s.t += 0.006 + j * 0.0004;
      if (s.t > 1) s.t = 0;
      s.mesh.position.y = 1.6 + s.t * 0.9;
      s.mesh.position.x = d.x + Math.sin(s.t * 6 + j) * 0.12;
      s.mesh.position.z = d.z + Math.cos(s.t * 5 + j) * 0.1;
      (s.mesh.material as THREE.Material).opacity = 0.45 * (1 - s.t);
      s.mesh.scale.setScalar(0.6 + s.t * 1.1);
    });
  }
}

export function syncBurners(): void {
  for (let i = 0; i < D.burners.length; i++) {
    const d = D.burners[i];
    const info = burnerInfo(i);

    if (!info) {
      if (d.mesh) d.mesh = kill(d.mesh, d.vessel);
      d.tintTargets = [];
      d.key = null;
      d.flame.visible = false;
      d.panel.sprite.visible = false;
      if (d.vessel.userData.water) d.vessel.userData.water.scale.y = 1;
      continue;
    }

    if (d.key !== info.cell.id + info.cell.at) {
      if (d.mesh) kill(d.mesh, d.vessel);
      // 타는 색을 입히려고 재질 색을 직접 바꾼다 — 공유 재질이면 같은 색 설비가 다 탄다
      d.mesh = ownMat(makeItemMesh({ id: info.cell.id, stage: 'raw' }));
      d.mesh.position.set(0, d.kind === 'pot' ? 0.2 : 0.08, 0);
      d.mesh.scale.setScalar(0.8);
      d.vessel.add(d.mesh);
      d.tintTargets = collectTintTargets(d.mesh);
      d.key = info.cell.id + info.cell.at;
    }

    d.flame.visible = true;
    d.flame.scale.y = 0.8 + Math.sin(performance.now() / 55 + i) * 0.25;
    m1(d.flame).color.setHex(info.burnt ? 0xff4d2e : C.fire);

    const k = Math.min(1, info.el / info.def.burn!);
    applyBurnTint(d.tintTargets, k);

    if (d.vessel.userData.water)
      d.vessel.userData.water.scale.y = 1 + Math.sin(performance.now() / 80 + i) * 0.35;
    if (d.kind === 'pan' && d.mesh)
      d.mesh.position.y = 0.08 + Math.abs(Math.sin(performance.now() / 200 + i)) * 0.02;

    d.panel.sprite.visible = true;
    d.panel.gauge(info.def.name, info.el / info.def.burn!, info.color, info.label);
  }
}

export function syncBoards(): void {
  for (let i = 0; i < D.boards.length; i++) {
    const d = D.boards[i];
    const info = boardInfo(i);

    if (!info) {
      if (d.mesh) d.mesh = kill(d.mesh);
      d.key = null;
      d.panel.sprite.visible = false;
      d.knife.position.copy(d.knifeHome);
      d.knife.rotation.set(0, 0, 0);
      continue;
    }

    const wantStage = info.done ? 'done' : 'raw';
    const key = info.b.id + info.b.at + wantStage;
    if (d.key !== key) {
      if (d.mesh) kill(d.mesh);
      d.mesh = makeItemMesh(
        info.b.id === 'roll'
          ? { id: info.done ? 'gimbap' : 'roll', stage: 'done', fills: info.b.fills }
          : { id: info.b.id, stage: wantStage },
      );
      d.mesh.position.set(d.x, 1.14, d.z);
      scene.add(d.mesh);
      d.key = key;
    }

    if (!info.done) {
      const swing = Math.abs(Math.sin(performance.now() / 110));
      d.knife.position.set(d.x - 0.3 + info.pct * 0.6, 1.14 + swing * 0.18, d.z);
      d.knife.rotation.z = -0.5 - swing * 0.5;
    } else {
      d.knife.position.copy(d.knifeHome);
      d.knife.rotation.set(0, 0, 0);
    }

    d.panel.sprite.visible = true;
    const nm = info.b.id === 'roll' ? '김밥 썰기' : ITEMS[info.b.id].name + ' 썰기';
    d.panel.gauge(
      nm,
      info.pct,
      info.done ? '#58c07a' : '#f5b942',
      info.done ? '다 썰었다 — E' : Math.round(info.pct * 100) + '%',
    );
  }
}

export function syncMats(): void {
  for (let i = 0; i < D.mats.length; i++) {
    const d = D.mats[i];
    const m = matAt(i);
    if (!m) continue;
    const rolling = m.rolling;
    const p = rollProgress(i);

    d.gim.visible = m.gim && !rolling;
    d.bap.visible = m.bap && !rolling;

    const key = m.fills.map((f) => f.id).join(',') + (rolling ? 'R' : '');
    if (d.fillKey !== key) {
      d.fillKey = key;
      while (d.fillGroup.children.length) {
        const c = d.fillGroup.children[0];
        d.fillGroup.remove(c);
        disposeObject(c);
      }
      if (!rolling) {
        /* 재료를 밥 위에 나란히 눕힌다.
           간격을 고정하면 두 문제가 생긴다 — 개수가 적을 때 한쪽으로 쏠리고,
           당근 채 다발(폭 0.08)처럼 넓은 재료끼리는 서로를 덮는다.
           그래서 밥 폭(z 0.4) 안에서 개수에 맞춰 나누고 가운데로 모은다. */
        const n = m.fills.length;
        const gap = n > 1 ? Math.min(0.082, 0.4 / n) : 0;
        m.fills.forEach((f, j) => {
          const g = makeItemMesh({ id: f.id, stage: 'done' });
          g.position.set(0, 0, (j - (n - 1) / 2) * gap);
          g.scale.setScalar(0.72);
          d.fillGroup.add(g);
        });
      }
    }

    if (rolling) {
      d.roll.visible = true;
      d.roll.scale.set(0.35 + p * 0.65, 1, 0.35 + p * 0.65);
      d.roll.rotation.x = -p * Math.PI * 2;
      d.group.rotation.x = -p * 0.5;
    } else {
      d.roll.visible = false;
      d.group.rotation.x = 0;
    }

    const any = m.gim || m.bap || m.fills.length || rolling;
    d.panel.sprite.visible = !!any;
    if (rolling) {
      d.panel.gauge(
        '말고 있다',
        p,
        p >= 1 ? '#58c07a' : '#f5b942',
        p >= 1 ? '완성! — E' : Math.round(p * 100) + '%',
      );
    } else if (any) {
      const names = m.fills.map((f) => ITEMS[f.id].emoji).join('');
      d.panel.gauge(
        '조립 중',
        (Number(m.gim) + Number(m.bap) + Math.min(4, m.fills.length)) / 6,
        '#63a8e8',
        (m.gim ? '김' : '─') + '·' + (m.bap ? '밥' : '─') + ' ' + (names || '속재료 없음'),
      );
    }
  }
}

export function syncBrooms(): void {
  for (let i = 0; i < D.brooms.length; i++) {
    const taken = broomTaken(i);
    const d = D.brooms[i];
    if (d.mesh.visible === !taken) continue;
    d.mesh.visible = !taken;
    d.label.sprite.visible = !taken;
  }
}

/* 해금 안 된 재료는 흐릿하게 */
export function syncFridge(): void {
  const open = unlockedFills();
  for (const f of D.fridge) {
    const def = ITEMS[f.id];
    const locked = !!def.fill && !open.includes(f.id);
    if (f.locked === locked) continue;
    f.locked = locked;
    f.sample.visible = !locked;
    f.label.text(locked ? '🔒 ' + def.name : def.emoji + ' ' + def.name, {
      color: locked ? '#7d8b93' : '#fff',
    });
  }
}

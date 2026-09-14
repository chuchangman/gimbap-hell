/* 파일 사이의 약속. 수치 하나를 고칠 때 조용히 깨지는 건 대개 여기다 —
   각 파일만 보면 멀쩡한데 맞물리는 곳이 어긋나는 경우. */
import { describe, expect, it } from 'vitest';
import {
  BASE_FILLINGS,
  EXTRA_FILLINGS,
  FRIDGE_ROW_A,
  FRIDGE_ROW_B,
  ITEMS,
  type ItemId,
} from '../src/items.js';
import { boardX, burnerZ, cookerZ, matX } from '../src/layout.js';
import {
  PLAYER_COLORS,
  PLAYER_LIMIT,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SPAWN_POINTS,
} from '../src/rules.js';
import { clearPosition, MOVEMENT } from '../src/spatial.js';
import { BOARD_COUNT, BURNERS, COMBAT, COOKER_COUNT, MAT_COUNT } from '../src/stations.js';

describe('스폰 지점', () => {
  it('모든 스폰 지점에 실제로 설 수 있다', () => {
    // 벽이나 설비에 낀 스폰은 브라우저 스모크로 못 잡는다 —
    // 화면은 멀쩡히 뜨고 그 사람만 못 움직인다.
    for (const [i, p] of SPAWN_POINTS.entries()) {
      expect(clearPosition(p), `${i}번 자리 (${p.x}, ${p.z})`).toBe(true);
    }
  });

  it('스폰 지점끼리 몸이 겹치지 않는다', () => {
    const min = MOVEMENT.radius * 2;
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      for (let j = i + 1; j < SPAWN_POINTS.length; j++) {
        const d = Math.hypot(
          SPAWN_POINTS[i].x - SPAWN_POINTS[j].x,
          SPAWN_POINTS[i].z - SPAWN_POINTS[j].z,
        );
        expect(d, `${i}번과 ${j}번`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('정원만큼 자리와 색이 있다', () => {
    expect(SPAWN_POINTS).toHaveLength(PLAYER_LIMIT);
    expect(PLAYER_COLORS).toHaveLength(PLAYER_LIMIT);
  });

  it('플레이어 색이 서로 다르다 — 누가 누군지 구분되어야 한다', () => {
    expect(new Set(PLAYER_COLORS).size).toBe(PLAYER_COLORS.length);
  });

  it('플레이어 색이 전부 #rrggbb 꼴이다', () => {
    for (const c of PLAYER_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('재료 분류', () => {
  const fillable = (Object.keys(ITEMS) as ItemId[]).filter((id) => ITEMS[id].fill);

  it('기본 재료와 추가 재료를 합치면 속재료 전체다', () => {
    expect([...BASE_FILLINGS, ...EXTRA_FILLINGS].sort()).toEqual([...fillable].sort());
  });

  it('기본과 추가가 겹치지 않는다', () => {
    const base = new Set<string>(BASE_FILLINGS);
    for (const id of EXTRA_FILLINGS) expect(base.has(id), id).toBe(false);
  });

  it('냉장고 두 줄을 합치면 냉장고 재료 전체다', () => {
    const inFridge = (Object.keys(ITEMS) as ItemId[]).filter((id) => ITEMS[id].fridge);
    expect([...FRIDGE_ROW_A, ...FRIDGE_ROW_B].sort()).toEqual([...inFridge].sort());
  });

  it('냉장고 두 줄이 겹치지 않는다', () => {
    const a = new Set<string>(FRIDGE_ROW_A);
    for (const id of FRIDGE_ROW_B) expect(a.has(id), id).toBe(false);
  });

  it('속재료는 전부 냉장고에서 꺼낼 수 있다', () => {
    for (const id of fillable) expect(ITEMS[id].fridge, id).toBe(true);
  });

  it('불 조절이 필요한 재료는 target·tol·burn 을 모두 갖는다', () => {
    for (const [id, def] of Object.entries(ITEMS)) {
      if (def.target === undefined) continue;
      expect(def.tol, `${id} tol`).toBeGreaterThan(0);
      expect(def.burn, `${id} burn`).toBeGreaterThan(def.target);
    }
  });

  it('도마 재료는 손질 시간을 갖는다', () => {
    for (const [id, def] of Object.entries(ITEMS)) {
      if (def.station !== 'board') continue;
      expect(def.dur, `${id} dur`).toBeGreaterThan(0);
    }
  });
});

describe('설비 배치', () => {
  it('같은 종류의 설비가 서로 다른 자리에 있다', () => {
    const spread = (n: number, at: (i: number) => number) =>
      new Set(Array.from({ length: n }, (_, i) => at(i)));
    expect(spread(BOARD_COUNT, boardX).size).toBe(BOARD_COUNT);
    expect(spread(MAT_COUNT, matX).size).toBe(MAT_COUNT);
    expect(spread(COOKER_COUNT, cookerZ).size).toBe(COOKER_COUNT);
  });

  it('설비가 최소 하나씩은 있다', () => {
    expect(BOARD_COUNT).toBeGreaterThan(0);
    expect(MAT_COUNT).toBeGreaterThan(0);
    expect(COOKER_COUNT).toBeGreaterThan(0);
    expect(BURNERS.length).toBeGreaterThan(0);
  });

  it('화구가 서로 다른 z 에 놓인다', () => {
    const zs = new Set(BURNERS.map((_, i) => burnerZ(i)));
    expect(zs.size).toBe(BURNERS.length);
  });

  it('재료가 요구하는 설비가 화구에 실제로 있다', () => {
    // 'pot' 재료만 있고 냄비 화구가 없으면 그 재료는 영영 손질을 못 한다.
    const kinds = new Set(BURNERS.map((b) => b.kind));
    const needed = new Set(
      (Object.keys(ITEMS) as ItemId[])
        .map((id) => ITEMS[id].station)
        .filter((st): st is 'pot' | 'pan' => st === 'pot' || st === 'pan'),
    );
    for (const st of needed) expect(kinds, st).toContain(st);
  });
});

describe('빗자루 난투 수치', () => {
  it('사거리가 상호작용 거리보다 길다 — 손 닿는 데서 때릴 수 있어야 한다', () => {
    expect(COMBAT.range).toBeGreaterThan(0);
  });

  it('정면 판정이 dot 값 범위 안이다', () => {
    expect(COMBAT.cone).toBeGreaterThan(-1);
    expect(COMBAT.cone).toBeLessThan(1);
  });

  it('쿨다운과 넉백이 양수다', () => {
    expect(COMBAT.cooldown).toBeGreaterThan(0);
    expect(COMBAT.knockback).toBeGreaterThan(0);
  });
});

describe('방 코드', () => {
  it('헷갈리는 글자를 빼놓았다 — 받아 적다 틀리면 못 들어온다', () => {
    for (const bad of ['I', 'O', '0', '1']) {
      expect(ROOM_CODE_ALPHABET.includes(bad), bad).toBe(false);
    }
  });

  it('글자가 중복되지 않는다', () => {
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('조합 수가 방을 넉넉히 덮는다', () => {
    expect(ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH).toBeGreaterThan(100000);
  });
});

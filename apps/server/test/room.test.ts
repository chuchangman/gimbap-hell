/* 방 — 입장·정원·방장·단계 전환, 그리고 주방 동작을 받기 전의 관문.
   해금·거리·일시정지 검사가 여기서 걸러지고 나서야 Kitchen 으로 간다. */
import { nameError, Room, type RoomLeaderboard } from '@/domain/room.js';
import {
  actionBox,
  MOVEMENT,
  NAME_MAX,
  NAME_MIN,
  PLAYER_COLORS,
  PLAYER_LIMIT,
  SPAWN_POINTS,
} from '@repo/game-core';
import { beforeEach, describe, expect, it } from 'vitest';

const T0 = 1_700_000_000_000;

/** 저장소를 타지 않는 가짜 랭킹 */
const fakeBoard = (): RoomLeaderboard => ({
  cleanShopName: (name, fallback = '') =>
    typeof name === 'string' && name.trim() ? name.trim() : fallback,
  add: () => ({ rank: 1, total: 1, entry: {} as never }),
  publicBoard: () => ({ rows: [], total: 0 }) as never,
  status: () => ({ kind: 'memory' }) as never,
});

let now = T0;
let room: Room;
const wait = (sec: number) => {
  now += sec * 1000;
};

beforeEach(() => {
  now = T0;
  room = new Room('ABCD', '스모크 김밥', fakeBoard(), () => now);
});

describe('nameError — 닉네임 검사', () => {
  it('적당한 이름은 통과한다', () => {
    expect(nameError('창만')).toBeNull();
    expect(nameError('a'.repeat(NAME_MAX))).toBeNull();
  });

  it('문자열이 아니면 거부한다', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(nameError(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });

  it('너무 짧거나 길면 거부한다', () => {
    expect(nameError('a'.repeat(NAME_MIN - 1))).toContain('이상');
    expect(nameError('a'.repeat(NAME_MAX + 1))).toContain('넘을 수 없습니다');
  });

  it('앞뒤 공백은 빼고 센다', () => {
    expect(nameError('  창  ')).toContain('이상'); // 다듬으면 한 글자
  });

  it('제어문자가 든 이름은 거부한다 — 화면이 깨진다', () => {
    expect(nameError('창만\n')).not.toBeNull();
    expect(nameError('창만\u0000')).not.toBeNull();
    expect(nameError('창만\u007f')).not.toBeNull();
  });
});

describe('입장과 정원', () => {
  it('들어오면 자리와 색과 스폰을 받는다', () => {
    const p = room.addPlayer('p1', '창만')!;
    expect(p.slot).toBe(0);
    expect(p.color).toBe(PLAYER_COLORS[0]);
    expect({ x: p.x, z: p.z }).toEqual({ x: SPAWN_POINTS[0].x, z: SPAWN_POINTS[0].z });
  });

  it('정원을 넘으면 못 들어온다', () => {
    for (let i = 0; i < PLAYER_LIMIT; i++) expect(room.addPlayer('p' + i, '알바')).not.toBeNull();
    expect(room.addPlayer('넘침', '알바')).toBeNull();
    expect(room.size).toBe(PLAYER_LIMIT);
  });

  it('같은 사람이 또 들어와도 자리를 하나만 쓴다', () => {
    const first = room.addPlayer('p1', '창만');
    expect(room.addPlayer('p1', '다른이름')).toBe(first);
    expect(room.size).toBe(1);
  });

  it('이름이 문자열이 아니면 못 들어온다', () => {
    expect(room.addPlayer('p1', null)).toBeNull();
    expect(room.addPlayer('p1', 42)).toBeNull();
  });

  it('빈 이름은 자리 번호로 채워준다', () => {
    expect(room.addPlayer('p1', '   ')!.name).toBe('알바1');
  });

  it('긴 이름은 잘라낸다', () => {
    expect(room.addPlayer('p1', 'a'.repeat(99))!.name).toHaveLength(NAME_MAX);
  });

  it('나간 자리를 다음 사람이 물려받는다', () => {
    room.addPlayer('p1', '하나');
    room.addPlayer('p2', '둘');
    room.removePlayer('p1');
    expect(room.addPlayer('p3', '셋')!.slot).toBe(0);
  });

  it('사람마다 자리와 색이 겹치지 않는다', () => {
    for (let i = 0; i < PLAYER_LIMIT; i++) room.addPlayer('p' + i, '알바');
    const slots = [...room.players.values()].map((p) => p.slot);
    const colors = [...room.players.values()].map((p) => p.color);
    expect(new Set(slots).size).toBe(PLAYER_LIMIT);
    expect(new Set(colors).size).toBe(PLAYER_LIMIT);
  });

  it('보내온 외형이 범위를 벗어나면 잘라낸다', () => {
    const p = room.addPlayer('p1', '창만', { h: 9999, hc: -1 })!;
    expect(p.look.h).toBe(0);
    expect(p.look.hc).toBe(0);
  });

  it('들어오면 주방에도 손이 생긴다', () => {
    room.addPlayer('p1', '창만');
    expect(room.kitchen.hands.has('p1')).toBe(true);
  });
});

describe('방장', () => {
  it('처음 들어온 사람이 방장이다', () => {
    room.addPlayer('p1', '하나');
    room.addPlayer('p2', '둘');
    expect(room.isHost('p1')).toBe(true);
    expect(room.isHost('p2')).toBe(false);
  });

  it('방장이 나가면 다음 사람이 넘겨받는다', () => {
    room.addPlayer('p1', '하나');
    room.addPlayer('p2', '둘');
    room.removePlayer('p1');
    expect(room.isHost('p2')).toBe(true);
  });

  it('아무도 없으면 방장도 없다', () => {
    room.addPlayer('p1', '하나');
    room.removePlayer('p1');
    expect(room.hostId).toBeNull();
  });

  it('나가면 주방에서도 빠진다', () => {
    room.addPlayer('p1', '하나');
    room.removePlayer('p1');
    expect(room.kitchen.hands.has('p1')).toBe(false);
  });
});

describe('가게 이름', () => {
  it('적어 낸 이름을 쓴다', () => {
    room.addPlayer('p1', '창만');
    expect(room.resolveShop()).toBe('스모크 김밥');
  });

  it('안 적었으면 방장 이름을 딴다', () => {
    const r = new Room('WXYZ', '', fakeBoard(), () => now);
    r.addPlayer('p1', '창만');
    expect(r.resolveShop()).toBe('창만의 가게');
  });

  it('방장도 없으면 방 코드를 쓴다', () => {
    const r = new Room('WXYZ', '', fakeBoard(), () => now);
    expect(r.resolveShop()).toContain('WXYZ');
  });
});

describe('라운드 시작', () => {
  beforeEach(() => {
    room.addPlayer('p1', '하나');
    room.addPlayer('p2', '둘');
  });

  it('시작하면 영업 중이 되고 웨이브가 생긴다', () => {
    expect(room.start()).toBe(true);
    expect(room.phase).toBe('playing');
    expect(room.waves).not.toBeNull();
    expect(room.waves!.players).toBe(2);
  });

  it('이미 영업 중이면 다시 시작하지 않는다', () => {
    room.start();
    expect(room.start()).toBe(false);
  });

  it('시작할 때 주방을 비운다', () => {
    room.start();
    // 거리 검사를 타지 않게 손에 바로 쥐여 준다 — 여기서 보는 건 reset 이다
    room.kitchen.setHand('p1', room.kitchen.mk('gim', 'raw'));
    room.kitchen.mess = 3;
    room.toLobby();
    room.start();
    expect(room.kitchen.hand('p1')).toBeNull();
    expect(room.kitchen.mess).toBe(0);
  });

  it('시작할 때 모두 스폰 자리로 돌아간다', () => {
    const p = room.players.get('p1')!;
    p.x = 5;
    p.z = 5;
    room.start();
    expect({ x: p.x, z: p.z }).toEqual({ x: p.spawn.x, z: p.spawn.z });
  });

  it('로비로 돌아가면 결과가 지워진다', () => {
    room.start();
    room.toLobby();
    expect(room.phase).toBe('lobby');
    expect(room.result).toBeNull();
  });
});

describe('주방 동작을 받기 전 관문', () => {
  beforeEach(() => {
    room.addPlayer('p1', '하나');
  });

  it('영업 전에는 아무것도 못 한다', () => {
    expect(room.act('p1', 'fridge:take', { item: 'gim' })).toMatchObject({
      ok: false,
      msg: '아직 영업 전입니다.',
    });
  });

  it('방에 없는 사람은 못 한다', () => {
    room.start();
    expect(room.act('낯선사람', 'drop').msg).toBe('방에 없습니다.');
  });

  it('일시정지 중에는 못 한다', () => {
    room.start();
    room.togglePause('p1');
    expect(room.act('p1', 'drop').msg).toContain('일시정지');
  });

  it('아직 안 풀린 재료는 못 집는다', () => {
    room.start();
    room.waves!.wave = 1;
    expect(room.act('p1', 'fridge:take', { item: 'fishcake' }).msg).toContain('해금');
    room.waves!.wave = 8;
    expect(room.act('p1', 'fridge:take', { item: 'fishcake' }).msg).not.toContain('해금');
  });

  it('올바르지 않은 동작은 거부한다', () => {
    room.start();
    expect(room.act('p1', 'cooker:put', { cooker: 999 }).msg).toContain('올바르지 않은');
  });

  it('멀리 있으면 설비를 못 만진다', () => {
    room.start();
    const p = room.players.get('p1')!;
    p.x = -7;
    p.z = 8;
    const r = room.act('p1', 'sink:rinse');
    expect(r.ok).toBe(false);
    expect(r.rejected).toBe('distance');
  });

  it('가까이 가면 만질 수 있다', () => {
    room.start();
    const box = actionBox('sink:rinse')!;
    const p = room.players.get('p1')!;
    p.x = box.x;
    p.z = box.z;
    expect(room.canReach('p1', 'sink:rinse')).toBe(true);
  });

  it('버리기는 거리를 따지지 않는다 — 아무 데서나 된다', () => {
    room.start();
    const p = room.players.get('p1')!;
    p.x = -7;
    p.z = 8;
    expect(room.act('p1', 'drop').msg).not.toContain('가까이');
  });

  it('연결이 끊긴 사람은 설비에 닿지 못한다', () => {
    room.start();
    const box = actionBox('sink:rinse')!;
    const p = room.players.get('p1')!;
    p.x = box.x;
    p.z = box.z;
    p.connected = false;
    expect(room.canReach('p1', 'sink:rinse')).toBe(false);
  });

  it('사거리에 네트워크 지연 여유가 붙어 있다', () => {
    room.start();
    const box = actionBox('sink:rinse')!;
    const p = room.players.get('p1')!;
    // 상자 표면에서 딱 reach 만큼 떨어져도 통과한다
    p.x = box.x + box.w / 2 + MOVEMENT.reach;
    p.z = box.z;
    expect(room.canReach('p1', 'sink:rinse')).toBe(true);
  });
});

describe('서빙 관문', () => {
  beforeEach(() => {
    room.addPlayer('p1', '하나');
    room.start();
  });

  it('완성 김밥이 없으면 못 낸다', () => {
    expect(room.serve('p1').msg).toContain('완성된 김밥');
  });

  it('영업 전에는 못 낸다', () => {
    room.toLobby();
    expect(room.serve('p1').msg).toContain('영업 전');
  });

  it('일시정지 중에는 못 낸다', () => {
    room.togglePause('p1');
    expect(room.serve('p1').msg).toContain('일시정지');
  });
});

describe('일시정지', () => {
  beforeEach(() => {
    room.addPlayer('p1', '하나');
    room.addPlayer('p2', '둘');
    room.start();
  });

  it('방장만 멈출 수 있다', () => {
    expect(room.togglePause('p2')).toBeNull();
    expect(room.togglePause('p1')).toEqual({ paused: true });
  });

  it('영업 중이 아니면 멈출 수 없다', () => {
    room.toLobby();
    expect(room.togglePause('p1')).toBeNull();
  });

  it('푼 만큼 흐른 시간을 알려준다', () => {
    room.togglePause('p1');
    wait(30);
    expect(room.togglePause('p1')).toMatchObject({ paused: false, elapsed: 30000 });
  });

  it('멈춘 동안 웨이브가 진행되지 않는다', () => {
    room.togglePause('p1');
    wait(999);
    expect(room.tick()).toEqual([]);
  });

  it('멈춘 만큼 준비 시간이 밀린다 — 쉬는 사이 웨이브가 오지 않는다', () => {
    const before = room.waves!.phaseEndsAt;
    room.togglePause('p1');
    wait(30);
    room.togglePause('p1');
    expect(room.waves!.phaseEndsAt).toBe(before + 30000);
  });
});

describe('tick', () => {
  it('영업 중이 아니면 아무 일도 없다', () => {
    room.addPlayer('p1', '하나');
    expect(room.tick()).toEqual([]);
  });

  it('영업 중이면 웨이브를 굴린다', () => {
    room.addPlayer('p1', '하나');
    room.start();
    wait(999);
    expect(room.tick().length).toBeGreaterThan(0);
  });
});

/* 주방 상태 머신. 김밥이 만들어지는 규칙이 전부 여기 있고,
   클라이언트는 같은 규칙으로 안내 문구만 만든다 — 판정은 이쪽이 전부다. */
import { Kitchen } from '@/domain/kitchen.js';
import { BURNERS, ITEMS, TIME, type ItemId } from '@repo/game-core';
import { beforeEach, describe, expect, it } from 'vitest';

const T0 = 1_700_000_000_000;
const POT = BURNERS.findIndex((b) => b.kind === 'pot');
const PAN = BURNERS.findIndex((b) => b.kind === 'pan');

let now = T0;
let k: Kitchen;
const ME = 'me';
const YOU = 'you';

/** 초 단위로 시계를 민다 */
const wait = (sec: number) => {
  now += sec * 1000;
};

beforeEach(() => {
  now = T0;
  k = new Kitchen(() => now);
  k.join(ME);
  k.join(YOU);
});

/** 씻은 쌀을 손에 들려준다 */
const washRice = (pid = ME) => {
  k.act(pid, 'fridge:take', { item: 'rice' });
  k.act(pid, 'sink:put');
  for (let i = 0; i < TIME.riceRinse; i++) k.act(pid, 'sink:rinse');
  k.act(pid, 'sink:take');
};

/** 밥 한 공기를 손에 들려준다 */
const getBap = (pid = ME) => {
  washRice(pid);
  k.act(pid, 'cooker:put', { cooker: 0 });
  wait(TIME.riceCook);
  k.tick();
  k.act(pid, 'cooker:take', { cooker: 0 });
};

describe('행동 자체를 받을 수 있는가', () => {
  it('방에 없는 사람은 아무것도 못 한다', () => {
    expect(k.act('낯선사람', 'sink:rinse')).toMatchObject({ ok: false, msg: '방에 없습니다.' });
  });

  it('모르는 동작은 거부한다', () => {
    expect(k.act(ME, '없는동작').ok).toBe(false);
  });

  it('설비 번호가 범위를 벗어나면 거부한다', () => {
    expect(k.act(ME, 'cooker:put', { cooker: 999 }).ok).toBe(false);
    expect(k.act(ME, 'cooker:put', { cooker: -1 }).ok).toBe(false);
    expect(k.act(ME, 'cooker:put', {}).ok).toBe(false);
  });

  it('냉장고에 없는 물건은 거부한다', () => {
    // 타입에 없는 값을 일부러 보낸다 — 와이어로는 뭐든 올 수 있다
    expect(k.act(ME, 'fridge:take', { item: '없는재료' as ItemId }).ok).toBe(false);
    expect(k.act(ME, 'fridge:take', { item: 'roll' }).ok).toBe(false); // 만든 김밥은 냉장고에 없다
  });
});

describe('🧊 냉장고', () => {
  it('재료를 집으면 손에 들린다', () => {
    expect(k.act(ME, 'fridge:take', { item: 'gim' }).ok).toBe(true);
    expect(k.hand(ME)).toMatchObject({ id: 'gim', stage: 'raw' });
  });

  it('손이 차 있으면 못 집는다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'fridge:take', { item: 'rice' }).ok).toBe(false);
    expect(k.hand(ME)).toMatchObject({ id: 'gim' });
  });

  it('손질이 필요 없는 재료는 집는 순간 바로 쓸 수 있다', () => {
    k.act(ME, 'fridge:take', { item: 'crab' });
    expect(k.hand(ME)).toMatchObject({ id: 'crab', stage: 'done' });
  });

  it('손질이 필요한 재료는 생재료로 나온다', () => {
    k.act(ME, 'fridge:take', { item: 'ham' });
    expect(k.hand(ME)).toMatchObject({ id: 'ham', stage: 'raw' });
  });

  it('사람마다 손이 따로 있다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.hand(YOU)).toBeNull();
    expect(k.act(YOU, 'fridge:take', { item: 'gim' }).ok).toBe(true);
  });
});

describe('🚰 싱크대 — 쌀 씻기', () => {
  it('생쌀만 넣을 수 있다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'sink:put').ok).toBe(false);
  });

  it('빈손으로는 넣을 게 없다', () => {
    expect(k.act(ME, 'sink:put').ok).toBe(false);
  });

  it('이미 쌀이 있으면 더 못 넣는다', () => {
    k.act(ME, 'fridge:take', { item: 'rice' });
    k.act(ME, 'sink:put');
    k.act(YOU, 'fridge:take', { item: 'rice' });
    expect(k.act(YOU, 'sink:put').ok).toBe(false);
  });

  it('정해진 횟수만큼 씻어야 꺼낼 수 있다', () => {
    k.act(ME, 'fridge:take', { item: 'rice' });
    k.act(ME, 'sink:put');
    for (let i = 1; i < TIME.riceRinse; i++) {
      expect(k.act(ME, 'sink:rinse').ok, `${i}번째`).toBe(true);
      expect(k.act(ME, 'sink:take').msg, `${i}번 씻고 꺼내기`).toContain('아직');
    }
    expect(k.act(ME, 'sink:rinse').msg).toContain('다 씻었습니다');
    expect(k.act(ME, 'sink:take').ok).toBe(true);
    expect(k.hand(ME)).toMatchObject({ id: 'rice', stage: 'washed' });
  });

  it('다 씻은 뒤로는 더 씻어봐야 소용없다', () => {
    k.act(ME, 'fridge:take', { item: 'rice' });
    k.act(ME, 'sink:put');
    for (let i = 0; i < TIME.riceRinse; i++) k.act(ME, 'sink:rinse');
    expect(k.act(ME, 'sink:rinse').ok).toBe(false);
  });

  it('씻을 쌀이 없으면 헹굴 수 없다', () => {
    expect(k.act(ME, 'sink:rinse').ok).toBe(false);
  });

  it('손이 차 있으면 못 꺼낸다', () => {
    k.act(ME, 'fridge:take', { item: 'rice' });
    k.act(ME, 'sink:put');
    for (let i = 0; i < TIME.riceRinse; i++) k.act(ME, 'sink:rinse');
    k.act(ME, 'fridge:take', { item: 'gim' }); // 손을 채운다
    expect(k.act(ME, 'sink:take').ok).toBe(false);
  });

  it('꺼내고 나면 싱크대가 빈다', () => {
    washRice();
    expect(k.sink).toBeNull();
  });
});

describe('🍚 밥솥', () => {
  it('씻은 쌀만 안칠 수 있다', () => {
    k.act(ME, 'fridge:take', { item: 'rice' });
    expect(k.act(ME, 'cooker:put', { cooker: 0 }).ok).toBe(false); // 생쌀
  });

  it('취사 시간이 지나야 밥이 된다', () => {
    washRice();
    k.act(ME, 'cooker:put', { cooker: 0 });
    wait(TIME.riceCook - 1);
    expect(k.tick()).toEqual([]);
    expect(k.act(ME, 'cooker:take', { cooker: 0 }).msg).toContain('아직');
    wait(1);
    expect(k.tick()).toHaveLength(1);
    expect(k.act(ME, 'cooker:take', { cooker: 0 }).ok).toBe(true);
    expect(k.hand(ME)).toMatchObject({ id: 'bap', stage: 'done' });
  });

  it('한 솥에서 정해진 인분만 나온다', () => {
    washRice();
    k.act(ME, 'cooker:put', { cooker: 0 });
    wait(TIME.riceCook);
    k.tick();
    for (let i = 0; i < TIME.riceYield; i++) {
      expect(k.act(ME, 'cooker:take', { cooker: 0 }).ok, `${i + 1}번째`).toBe(true);
      k.act(ME, 'drop'); // 손을 비운다
    }
    expect(k.act(ME, 'cooker:take', { cooker: 0 }).ok).toBe(false); // 다 꺼냈다
    expect(k.cookers[0].state).toBe('empty');
  });

  it('취사 중인 솥에 또 안칠 수 없다', () => {
    washRice();
    k.act(ME, 'cooker:put', { cooker: 0 });
    washRice(YOU);
    expect(k.act(YOU, 'cooker:put', { cooker: 0 }).ok).toBe(false);
    expect(k.act(YOU, 'cooker:put', { cooker: 1 }).ok).toBe(true); // 다른 솥은 된다
  });

  it('완료 알림은 한 번만 뜬다', () => {
    washRice();
    k.act(ME, 'cooker:put', { cooker: 0 });
    wait(TIME.riceCook);
    expect(k.tick()).toHaveLength(1);
    expect(k.tick()).toEqual([]);
  });
});

describe('🔥 가스렌지', () => {
  it('재료에 맞는 화구에만 올릴 수 있다', () => {
    k.act(ME, 'fridge:take', { item: 'spinach' }); // 냄비 재료
    expect(k.act(ME, 'burner:put', { slot: PAN }).ok).toBe(false);
    expect(k.act(ME, 'burner:put', { slot: POT }).ok).toBe(true);
  });

  it('도마 재료는 화구에 못 올린다', () => {
    k.act(ME, 'fridge:take', { item: 'danmuji' });
    expect(k.act(ME, 'burner:put', { slot: PAN }).ok).toBe(false);
  });

  it('이미 조리 중인 화구는 못 쓴다', () => {
    k.act(ME, 'fridge:take', { item: 'ham' });
    k.act(ME, 'burner:put', { slot: PAN });
    k.act(YOU, 'fridge:take', { item: 'ham' });
    expect(k.act(YOU, 'burner:put', { slot: PAN }).ok).toBe(false);
  });

  it('딱 맞게 익히면 품질이 높다', () => {
    k.act(ME, 'fridge:take', { item: 'ham' });
    k.act(ME, 'burner:put', { slot: PAN });
    wait(ITEMS.ham.target!);
    k.act(ME, 'burner:take', { slot: PAN });
    expect(k.hand(ME)).toMatchObject({ id: 'ham', stage: 'done' });
    expect(k.hand(ME)!.quality).toBe(100);
  });

  it('덜 익히면 품질이 떨어진다', () => {
    k.act(ME, 'fridge:take', { item: 'ham' });
    k.act(ME, 'burner:put', { slot: PAN });
    wait(1);
    k.act(ME, 'burner:take', { slot: PAN });
    expect(k.hand(ME)!.quality).toBeLessThan(100);
  });

  it('태우면 못 쓰게 된다', () => {
    k.act(ME, 'fridge:take', { item: 'ham' });
    k.act(ME, 'burner:put', { slot: PAN });
    wait(ITEMS.ham.burn!);
    const r = k.act(ME, 'burner:take', { slot: PAN });
    expect(r.kind).toBe('bad');
    expect(k.hand(ME)).toMatchObject({ id: 'ham', stage: 'burnt', quality: 0 });
  });

  it('빈 화구에서는 꺼낼 게 없고, 꺼내면 화구가 빈다', () => {
    expect(k.act(ME, 'burner:take', { slot: PAN }).ok).toBe(false);
    k.act(ME, 'fridge:take', { item: 'ham' });
    k.act(ME, 'burner:put', { slot: PAN });
    wait(ITEMS.ham.target!);
    k.act(ME, 'burner:take', { slot: PAN });
    expect(k.burners[PAN]).toBeNull();
  });

  it('손질이 끝난 재료를 다시 올릴 수는 없다', () => {
    k.act(ME, 'fridge:take', { item: 'crab' }); // 처음부터 done
    expect(k.act(ME, 'burner:put', { slot: PAN }).ok).toBe(false);
  });
});

describe('🔪 도마', () => {
  it('도마 재료를 썰면 손질이 끝난다', () => {
    k.act(ME, 'fridge:take', { item: 'danmuji' });
    expect(k.act(ME, 'board:put', { board: 0 }).ok).toBe(true);
    expect(k.act(ME, 'board:take', { board: 0 }).msg).toContain('아직');
    wait(ITEMS.danmuji.dur!);
    expect(k.act(ME, 'board:take', { board: 0 }).ok).toBe(true);
    expect(k.hand(ME)).toMatchObject({ id: 'danmuji', stage: 'done' });
  });

  it('도마에서 할 게 없는 재료는 거부한다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'board:put', { board: 0 }).ok).toBe(false);
  });

  it('차 있는 도마에는 못 올린다', () => {
    k.act(ME, 'fridge:take', { item: 'danmuji' });
    k.act(ME, 'board:put', { board: 0 });
    k.act(YOU, 'fridge:take', { item: 'danmuji' });
    expect(k.act(YOU, 'board:put', { board: 0 }).ok).toBe(false);
  });

  it('빈 도마에서는 꺼낼 게 없다', () => {
    expect(k.act(ME, 'board:take', { board: 0 }).ok).toBe(false);
  });
});

describe('🍙 조립대 — 쌓는 순서', () => {
  const putGimAndBap = (pid = ME) => {
    k.act(pid, 'fridge:take', { item: 'gim' });
    k.act(pid, 'mat:put', { mat: 0 });
    getBap(pid);
    k.act(pid, 'mat:put', { mat: 0 });
  };

  it('김 없이 밥부터는 못 올린다', () => {
    getBap();
    expect(k.act(ME, 'mat:put', { mat: 0 }).msg).toContain('김부터');
  });

  it('밥 없이 속재료부터는 못 올린다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    k.act(ME, 'mat:put', { mat: 0 });
    k.act(ME, 'fridge:take', { item: 'crab' });
    expect(k.act(ME, 'mat:put', { mat: 0 }).msg).toContain('밥부터');
  });

  it('김 → 밥 → 속재료 순서면 올라간다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'crab' });
    expect(k.act(ME, 'mat:put', { mat: 0 }).ok).toBe(true);
    expect(k.mats[0].fills).toHaveLength(1);
  });

  it('김도 밥도 두 번은 못 올린다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'mat:put', { mat: 0 }).ok).toBe(false);
    k.act(ME, 'drop');
    getBap();
    expect(k.act(ME, 'mat:put', { mat: 0 }).ok).toBe(false);
  });

  it('손질하지 않은 재료는 못 넣는다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'ham' }); // raw
    expect(k.act(ME, 'mat:put', { mat: 0 }).msg).toContain('손질하지 않은');
  });

  it('태운 재료는 못 넣는다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'ham' });
    k.act(ME, 'burner:put', { slot: PAN });
    wait(ITEMS.ham.burn!);
    k.act(ME, 'burner:take', { slot: PAN });
    expect(k.act(ME, 'mat:put', { mat: 0 }).msg).toContain('음쓰통');
  });

  it('같은 재료를 두 번 넣을 수 없다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'crab' });
    k.act(ME, 'mat:put', { mat: 0 });
    k.act(ME, 'fridge:take', { item: 'crab' });
    expect(k.act(ME, 'mat:put', { mat: 0 }).msg).toContain('이미 들어갔습니다');
  });

  it('속재료가 아닌 것은 못 넣는다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'rice' });
    expect(k.act(ME, 'mat:put', { mat: 0 }).ok).toBe(false);
  });

  it('되돌리기는 넣은 역순으로 빼준다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'crab' });
    k.act(ME, 'mat:put', { mat: 0 });

    expect(k.act(ME, 'mat:undo', { mat: 0 }).ok).toBe(true);
    expect(k.hand(ME)).toMatchObject({ id: 'crab' });
    k.act(ME, 'drop');

    k.act(ME, 'mat:undo', { mat: 0 });
    expect(k.hand(ME)).toMatchObject({ id: 'bap' });
    k.act(ME, 'drop');

    k.act(ME, 'mat:undo', { mat: 0 });
    expect(k.hand(ME)).toMatchObject({ id: 'gim' });
    k.act(ME, 'drop');

    expect(k.act(ME, 'mat:undo', { mat: 0 }).ok).toBe(false); // 이제 비었다
  });

  it('빈손이어야 되돌릴 수 있다', () => {
    putGimAndBap();
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'mat:undo', { mat: 0 }).ok).toBe(false);
  });
});

describe('🍙 조립대 — 말기', () => {
  const ready = (pid = ME) => {
    k.act(pid, 'fridge:take', { item: 'gim' });
    k.act(pid, 'mat:put', { mat: 0 });
    getBap(pid);
    k.act(pid, 'mat:put', { mat: 0 });
    k.act(pid, 'fridge:take', { item: 'crab' });
    k.act(pid, 'mat:put', { mat: 0 });
  };

  it('속재료가 하나도 없으면 말 수 없다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    k.act(ME, 'mat:put', { mat: 0 });
    getBap();
    k.act(ME, 'mat:put', { mat: 0 });
    expect(k.act(ME, 'mat:roll', { mat: 0 }).msg).toContain('속재료');
  });

  it('김과 밥이 없으면 말 수 없다', () => {
    expect(k.act(ME, 'mat:roll', { mat: 0 }).msg).toContain('김과 밥');
  });

  it('마는 동안에는 건드릴 수 없다', () => {
    ready();
    k.act(ME, 'mat:roll', { mat: 0 });
    expect(k.act(ME, 'mat:roll', { mat: 0 }).ok).toBe(false);
    expect(k.act(ME, 'mat:undo', { mat: 0 }).ok).toBe(false);
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'mat:put', { mat: 0 }).msg).toContain('말고 있는 중');
  });

  it('다 말아야 꺼낼 수 있다', () => {
    ready();
    k.act(ME, 'mat:roll', { mat: 0 });
    wait(TIME.roll - 1);
    expect(k.act(ME, 'mat:take', { mat: 0 }).msg).toContain('아직');
    wait(1);
    expect(k.act(ME, 'mat:take', { mat: 0 }).ok).toBe(true);
    expect(k.hand(ME)).toMatchObject({ id: 'roll', stage: 'done' });
  });

  it('꺼내면 조립대가 처음 상태로 돌아간다', () => {
    ready();
    k.act(ME, 'mat:roll', { mat: 0 });
    wait(TIME.roll);
    k.act(ME, 'mat:take', { mat: 0 });
    expect(k.mats[0]).toEqual({ gim: false, bap: false, fills: [], rolling: false, rollAt: 0 });
  });

  it('만 김밥이 속재료를 그대로 들고 나온다', () => {
    ready();
    k.act(ME, 'mat:roll', { mat: 0 });
    wait(TIME.roll);
    k.act(ME, 'mat:take', { mat: 0 });
    expect(k.hand(ME)!.fills).toEqual([{ id: 'crab', quality: 100 }]);
  });
});

describe('🍣 김밥 한 줄까지', () => {
  it('말고 썰면 완성 김밥이 된다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    k.act(ME, 'mat:put', { mat: 0 });
    getBap();
    k.act(ME, 'mat:put', { mat: 0 });
    k.act(ME, 'fridge:take', { item: 'crab' });
    k.act(ME, 'mat:put', { mat: 0 });
    k.act(ME, 'mat:roll', { mat: 0 });
    wait(TIME.roll);
    k.act(ME, 'mat:take', { mat: 0 });

    expect(k.act(ME, 'board:put', { board: 0 }).ok).toBe(true);
    wait(TIME.cutRoll);
    expect(k.act(ME, 'board:take', { board: 0 }).ok).toBe(true);
    expect(k.hand(ME)).toMatchObject({ id: 'gimbap', stage: 'done' });
    expect(k.hand(ME)!.fills).toEqual([{ id: 'crab', quality: 100 }]);
  });

  it('완성 김밥만 서빙으로 꺼낼 수 있다', () => {
    expect(k.takeGimbap(ME)).toBeNull();
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.takeGimbap(ME)).toBeNull();
    expect(k.hand(ME)).not.toBeNull(); // 엉뚱한 걸 뺏어가지 않는다
  });
});

describe('🗑️ 버리기', () => {
  it('음쓰통에 버리면 낭비로만 센다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'bin:drop').ok).toBe(true);
    expect(k.wasted).toBe(1);
    expect(k.mess).toBe(0);
    expect(k.hand(ME)).toBeNull();
  });

  it('바닥에 버리면 어지르기로도 센다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'drop').kind).toBe('bad');
    expect(k.wasted).toBe(1);
    expect(k.mess).toBe(1);
  });

  it('빈손으로는 버릴 게 없다', () => {
    expect(k.act(ME, 'bin:drop').ok).toBe(false);
    expect(k.act(ME, 'drop').ok).toBe(false);
  });
});

describe('🧹 빗자루', () => {
  it('거치대에서 들면 그 자리가 임자를 기억한다', () => {
    expect(k.act(ME, 'broom:take', { rack: 0 }).ok).toBe(true);
    expect(k.brooms[0]).toBe(ME);
    expect(k.hasBroom(ME)).toBe(true);
  });

  it('남이 가져간 빗자루는 못 든다', () => {
    k.act(ME, 'broom:take', { rack: 0 });
    expect(k.act(YOU, 'broom:take', { rack: 0 }).ok).toBe(false);
    expect(k.act(YOU, 'broom:take', { rack: 1 }).ok).toBe(true);
  });

  it('손이 차 있으면 못 든다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.act(ME, 'broom:take', { rack: 0 }).ok).toBe(false);
  });

  it('빗자루는 음쓰통에 못 버린다', () => {
    k.act(ME, 'broom:take', { rack: 0 });
    expect(k.act(ME, 'bin:drop').ok).toBe(false);
    expect(k.brooms[0]).toBe(ME); // 그대로 들고 있다
  });

  it('Q 로 내려놓으면 제자리로 돌아간다 — 어지른 걸로 치지 않는다', () => {
    k.act(ME, 'broom:take', { rack: 0 });
    expect(k.act(ME, 'drop').ok).toBe(true);
    expect(k.brooms[0]).toBeNull();
    expect(k.mess).toBe(0);
  });

  it('맞아서 놓치면 거치대가 풀린다', () => {
    k.act(ME, 'broom:take', { rack: 0 });
    expect(k.dropFor(ME)).toMatchObject({ id: 'broom' });
    expect(k.brooms[0]).toBeNull();
    expect(k.hand(ME)).toBeNull();
  });

  it('나가면 들고 있던 빗자루가 제자리로 돌아간다', () => {
    k.act(ME, 'broom:take', { rack: 0 });
    k.leave(ME);
    expect(k.brooms[0]).toBeNull();
    expect(k.hands.has(ME)).toBe(false);
  });
});

describe('맞아서 놓치기', () => {
  it('빈손이면 놓칠 게 없다', () => {
    expect(k.dropFor(ME)).toBeNull();
  });

  it('들고 있던 재료를 떨어뜨린다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    expect(k.dropFor(ME)).toMatchObject({ id: 'gim' });
    expect(k.hand(ME)).toBeNull();
  });
});

describe('일시정지', () => {
  it('멈춘 시간만큼 공정이 밀린다 — 쉬는 동안 타지 않는다', () => {
    k.act(ME, 'fridge:take', { item: 'ham' });
    k.act(ME, 'burner:put', { slot: PAN });
    wait(ITEMS.ham.target!);

    wait(60); // 1분 멈췄다
    k.shiftTime(60 * 1000); // 멈춘 만큼 기준 시각을 민다

    k.act(ME, 'burner:take', { slot: PAN });
    expect(k.hand(ME)).toMatchObject({ stage: 'done' });
    expect(k.hand(ME)!.quality).toBe(100);
  });

  it('취사도 같이 밀린다', () => {
    washRice();
    k.act(ME, 'cooker:put', { cooker: 0 });
    wait(5);
    k.shiftTime(5000);
    expect(k.tick()).toEqual([]); // 아직 10초가 안 지났다
  });

  it('음수나 0 은 아무것도 하지 않는다', () => {
    washRice();
    k.act(ME, 'cooker:put', { cooker: 0 });
    const at = k.cookers[0].at;
    k.shiftTime(0);
    k.shiftTime(-100);
    expect(k.cookers[0].at).toBe(at);
  });
});

describe('입장과 퇴장', () => {
  it('두 번 들어와도 손에 든 것을 잃지 않는다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    k.join(ME);
    expect(k.hand(ME)).toMatchObject({ id: 'gim' });
  });

  it('나가면 손이 사라진다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    k.leave(ME);
    expect(k.hand(ME)).toBeNull();
  });
});

describe('snapshot — 클라이언트로 보낼 상태', () => {
  it('설비 개수가 정의와 맞는다', () => {
    const s = k.snapshot();
    expect(s.burners).toHaveLength(BURNERS.length);
    expect(s.cookers).toHaveLength(k.cookers.length);
    expect(s.mats).toHaveLength(k.mats.length);
  });

  it('시계가 주입된 값을 따른다', () => {
    wait(7);
    expect(k.snapshot().now).toBe(now);
  });

  it('손에 든 것을 사람별로 담는다', () => {
    k.act(ME, 'fridge:take', { item: 'gim' });
    const hands = k.snapshot().hands;
    expect(hands.find((h) => h.id === ME)?.holding).toMatchObject({ id: 'gim' });
    expect(hands.find((h) => h.id === YOU)?.holding).toBeNull();
  });
});

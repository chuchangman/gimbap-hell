/* 재료·불 조절. 난이도가 전부 여기 수치에 달려 있다. */
import { describe, expect, it } from 'vitest';
import {
  cookAverage,
  cookQuality,
  cookStatus,
  EXTRA_FILLINGS,
  itemLabel,
  ITEMS,
  itemUnlockWave,
  unlockAt,
  unlockedExtras,
  UNLOCKS,
  type ItemId,
} from '../src/items.js';

const ham = ITEMS.ham; // target 5 · tol 3.2 · burn 11
const crab = ITEMS.crab; // 손질 불필요 — target 도 burn 도 없다

describe('cookQuality — 불 조절 점수', () => {
  it('손질이 필요 없는 재료는 언제 봐도 100', () => {
    for (const e of [0, 5, 999]) expect(cookQuality(crab, e)).toBe(100);
  });

  it('target 에 정확히 맞추면 100', () => {
    expect(cookQuality(ham, 5)).toBe(100);
  });

  it('burn 을 넘기면 0', () => {
    expect(cookQuality(ham, 11)).toBe(0);
    expect(cookQuality(ham, 20)).toBe(0);
  });

  it('target 앞뒤로 대칭이다 — 덜 익힌 것과 더 익힌 것을 똑같이 깎는다', () => {
    expect(cookQuality(ham, 4)).toBe(cookQuality(ham, 6));
    expect(cookQuality(ham, 3)).toBe(cookQuality(ham, 7));
  });

  it('tol 을 벗어나면 타기 전에 이미 0이다 — 0과 burn 은 다른 상태', () => {
    expect(cookQuality(ham, 8.2)).toBe(0); // tol 밖이라 0점
    expect(cookStatus(ham, 8.2).label).not.toBe('탔다!'); // 그래도 탄 건 아니다
    expect(cookStatus(ham, 11).label).toBe('탔다!');
  });

  it('음수로 내려가지 않는다', () => {
    expect(cookQuality(ham, 0)).toBe(0);
  });
});

describe('cookStatus — 조리 상태 문구', () => {
  it('q 85 이상은 딱 좋다', () => {
    expect(cookStatus(ham, 5).label).toBe('딱 좋다!');
    expect(cookStatus(ham, 5.48).label).toBe('딱 좋다!'); // q = 85, 경계
    expect(cookStatus(ham, 4.52).label).toBe('딱 좋다!');
  });

  it('q 55~85 는 target 기준으로 덜/과함을 가른다', () => {
    expect(cookStatus(ham, 4.4).label).toBe('거의 다 됨'); // q 81, 아직 전
    expect(cookStatus(ham, 5.6).label).toBe('살짝 과함'); // q 81, 이미 후
    expect(cookStatus(ham, 3.56).label).toBe('거의 다 됨'); // q 55, 경계
    expect(cookStatus(ham, 6.44).label).toBe('살짝 과함'); // q 55, 경계
  });

  it('q 55 미만은 덜 됐다 / 너무 익는다', () => {
    expect(cookStatus(ham, 3).label).toBe('아직 덜 됐다'); // q 38
    expect(cookStatus(ham, 7).label).toBe('너무 익는다'); // q 38
  });

  it('탄 것은 q 를 따지지 않고 0으로 못 박는다', () => {
    expect(cookStatus(ham, 11)).toMatchObject({ label: '탔다!', q: 0 });
  });

  it('target 도 burn 도 없는 재료는 항상 딱 좋다 — 태울 수가 없다', () => {
    expect(cookStatus(crab, 0).label).toBe('딱 좋다!');
    expect(cookStatus(crab, 999).label).toBe('딱 좋다!');
  });

  it('q 는 cookQuality 와 같은 값이다', () => {
    for (const e of [0, 3, 5, 7, 9]) expect(cookStatus(ham, e).q).toBe(cookQuality(ham, e));
  });
});

describe('cookAverage — 넣은 속재료의 평균 품질', () => {
  it('비어 있으면 0', () => {
    expect(cookAverage([])).toBe(0);
    expect(cookAverage(null)).toBe(0);
    expect(cookAverage(undefined)).toBe(0);
  });

  it('평균을 반올림한다', () => {
    expect(cookAverage([{ quality: 80 }, { quality: 100 }])).toBe(90);
    expect(cookAverage([{ quality: 90 }, { quality: 85 }])).toBe(88); // 87.5 → 88
  });

  it('하나면 그 값 그대로', () => {
    expect(cookAverage([{ quality: 73 }])).toBe(73);
  });
});

describe('재료 해금', () => {
  it('웨이브가 지나며 하나씩 풀린다', () => {
    expect(unlockedExtras(1)).toEqual([]);
    expect(unlockedExtras(2)).toEqual(['crab']);
    expect(unlockedExtras(3)).toEqual(['crab', 'cucumber']);
    expect(unlockedExtras(8)).toEqual(EXTRA_FILLINGS);
    expect(unlockedExtras(10)).toEqual(EXTRA_FILLINGS);
  });

  it('풀리는 웨이브 사이에는 늘지 않는다', () => {
    expect(unlockedExtras(5)).toEqual(unlockedExtras(4));
    expect(unlockedExtras(7)).toEqual(unlockedExtras(6));
  });

  it('unlockAt 은 그 웨이브에 새로 풀리는 것만 알려준다', () => {
    expect(unlockAt(2)).toBe('crab');
    expect(unlockAt(8)).toBe('fishcake');
    expect(unlockAt(1)).toBeNull();
    expect(unlockAt(5)).toBeNull();
    expect(unlockAt(99)).toBeNull();
  });

  it('itemUnlockWave — 기본 재료와 김·쌀은 1웨이브부터', () => {
    expect(itemUnlockWave('danmuji')).toBe(1);
    expect(itemUnlockWave('gim')).toBe(1);
    expect(itemUnlockWave('rice')).toBe(1);
    expect(itemUnlockWave('crab')).toBe(2);
    expect(itemUnlockWave('fishcake')).toBe(8);
  });

  it('모르는 재료는 1웨이브로 친다 — 잠긴 것으로 오해하지 않는다', () => {
    expect(itemUnlockWave('없는재료')).toBe(1);
  });

  it('추가 재료는 전부 UNLOCKS 에 들어 있다', () => {
    // 하나라도 빠지면 unlockedExtras 의 Number(undefined) 가 NaN 이 되어
    // 그 재료가 어떤 웨이브에도 안 나온다. 조용히 사라지므로 여기서 잡는다.
    const unlockable = new Set(Object.values(UNLOCKS));
    for (const id of EXTRA_FILLINGS) expect(unlockable).toContain(id);
    expect(unlockable.size).toBe(EXTRA_FILLINGS.length);
  });

  it('해금 웨이브는 전부 WAVES 범위(1~10) 안이다', () => {
    for (const w of Object.keys(UNLOCKS).map(Number)) {
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(10);
    }
  });
});

describe('itemLabel — 손에 든 것의 표시 이름', () => {
  it('단계별 이름이 있으면 그것을 쓴다', () => {
    expect(itemLabel({ id: 'ham', stage: 'raw' })).toBe('햄');
    expect(itemLabel({ id: 'ham', stage: 'done' })).toBe('볶은 햄');
    expect(itemLabel({ id: 'ham', stage: 'burnt' })).toBe('탄 햄');
  });

  it('그 단계 이름이 없으면 재료 이름으로 떨어진다', () => {
    expect(itemLabel({ id: 'ham', stage: 'washed' })).toBe(ITEMS.ham.name);
  });

  it('없는 재료는 물음표, 빈 손은 null', () => {
    expect(itemLabel({ id: '없는재료', stage: 'raw' })).toBe('?');
    expect(itemLabel(null)).toBeNull();
    expect(itemLabel(undefined)).toBeNull();
  });

  it('모든 재료가 raw 나 done 중 최소 하나의 이름을 갖는다', () => {
    for (const id of Object.keys(ITEMS)) {
      const label =
        itemLabel({ id, stage: 'raw' }) || itemLabel({ id: id as ItemId, stage: 'done' });
      expect(label, id).toBeTruthy();
    }
  });
});

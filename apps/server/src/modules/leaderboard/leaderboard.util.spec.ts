import { NAME_MAX, PLAYER_LIMIT, SHOP_MAX } from '@repo/game-core';
import { describe, expect, it } from 'vitest';
import { loadLegacy } from '../../testing/legacy.js';
import { buildEntry, cleanShopName, maskShop, stripControl } from './leaderboard.util.js';

const legacy = await loadLegacy('leaderboard.mjs');

/* 가게 이름 정리와 마스킹은 랭킹으로 공개되는 값이라 레거시와 한 글자도
   달라선 안 된다. 제어문자는 소스에 리터럴로 넣지 않고 코드로 만든다. */

const ctrl = (code: number) => String.fromCharCode(code);
const CONTROL_CODES = [0, 1, 8, 9, 10, 13, 27, 31, 127];

describe('cleanShopName', () => {
  it('제어문자 제거 · trim · 길이 자르기가 레거시와 같다', () => {
    const names: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      '김밥천국',
      '  김밥천국  ',
      'x'.repeat(SHOP_MAX),
      'x'.repeat(SHOP_MAX + 8),
      0,
      42,
      true,
      { toString: () => '객체가게' },
      ...CONTROL_CODES.map((c) => '김밥' + ctrl(c) + '천국'),
      ...CONTROL_CODES.map((c) => ctrl(c) + ctrl(c)),
      // 제어문자를 걷어낸 뒤 trim 하는 순서를 지켰는지
      ctrl(9) + '  가게  ' + ctrl(10),
    ];
    for (const name of names) {
      for (const fallback of [undefined, '', 'ABCD 김밥집']) {
        expect(cleanShopName(name, fallback), JSON.stringify(String(name))).toBe(
          legacy.cleanShopName(name, fallback),
        );
      }
    }
  });

  it('제어문자 제거가 코드포인트 단위로 레거시와 같다', () => {
    for (let code = 0; code <= 0x100; code++) {
      const s = 'a' + String.fromCharCode(code) + 'b';
      const isControl = code <= 0x1f || code === 0x7f;
      const label = 'U+' + code.toString(16).padStart(4, '0');
      // 제어문자면 빠지고 아니면 남는다
      expect(stripControl(s), label).toBe(isControl ? 'ab' : s);
      // 레거시도 같은 판정을 하는지 (cleanShopName 이 같은 정규식을 쓴다)
      expect(cleanShopName(s), label + ' legacy').toBe(legacy.cleanShopName(s));
    }
  });
});

describe('maskShop', () => {
  it('첫 글자만 남기고 가리는 방식이 레거시와 같다', () => {
    const names: unknown[] = [
      undefined,
      null,
      '',
      'A',
      '김',
      '김밥천국',
      'x'.repeat(SHOP_MAX),
      '🍣김밥', // 서로게이트 페어 — Array.from 이 코드포인트로 센다
      '가나다라마바사',
    ];
    for (const name of names) {
      expect(maskShop(name), JSON.stringify(String(name))).toBe(legacy.maskShop(name));
    }
  });
});

describe('buildEntry', () => {
  it('점수 · 인원 · 품질 정규화가 레거시 add 와 같다', () => {
    const results: Record<string, unknown>[] = [
      {},
      { shop: '가게', score: 1234.6, wave: 7.9, totalWaves: 10, kind: 'victory' },
      { score: -50, wave: -1, avgQuality: 500, servedRolls: 3.9 },
      { score: NaN, wave: Infinity, avgQuality: NaN, servedRolls: -2 },
      { kind: 'nope' },
      { kind: 'victory' },
      {
        players: Array.from({ length: PLAYER_LIMIT + 4 }, (_, i) => ({ name: '알바' + i })),
      },
      { players: ['문자열', { name: '객체' }, null, undefined, 7] },
      { players: [{ name: 'x'.repeat(NAME_MAX + 5) }] },
      { players: [{ name: '이름' + ctrl(0) + ctrl(31) }] },
      { players: 'not an array' },
    ];
    for (const result of results) {
      const mine = buildEntry(result, 'fixed-id', '2026-09-10T00:00:00.000Z');
      // 레거시 add 는 UUID·시각을 스스로 만든다. 그 둘만 빼고 비교한다.
      const theirs = legacy.add(result) as Record<string, unknown>;
      const strip = (e: Record<string, unknown>) => {
        const { id, at, ...rest } = e;
        void id;
        void at;
        return rest;
      };
      expect(strip(mine as unknown as Record<string, unknown>), JSON.stringify(result)).toEqual(
        strip((theirs as { entry: Record<string, unknown> }).entry),
      );
    }
  });
});

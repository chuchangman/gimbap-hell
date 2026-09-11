import { describe, expect, it } from 'vitest';
import { loadLegacy } from '../testing/legacy.js';
import {
  allowedOrigin,
  createEventLimiter,
  EVENT_BUDGET,
  validEvent,
  validKitchenAction,
} from './protocol.js';

const legacy = await loadLegacy('protocol.mjs');

/* 레거시 server/protocol.mjs 와 새 구현을 같은 입력으로 대조한다.
   검증이 조용히 느슨해지면 서버 권위가 그만큼 무너지므로, 값 비교가 아니라
   "두 구현이 같은 답을 내는지" 를 고정한다. */

const ctrl = (code: number): string => String.fromCharCode(code);
const CONTROL_SAMPLES = [0, 1, 9, 10, 13, 27, 31, 127].map(ctrl);

const PAYLOAD_VALUES: unknown[] = [
  0,
  1,
  2,
  3,
  4,
  5,
  9,
  -1,
  1.5,
  NaN,
  Infinity,
  '0',
  '2',
  true,
  false,
  null,
  undefined,
  {},
  [],
  [0],
  '__proto__',
];

const ACTIONS = [
  'fridge:take',
  'sink:put',
  'sink:rinse',
  'sink:take',
  'cooker:put',
  'cooker:take',
  'burner:put',
  'burner:take',
  'board:put',
  'board:take',
  'mat:put',
  'mat:undo',
  'mat:roll',
  'mat:take',
  'bin:drop',
  'drop',
  'broom:take',
  'serve',
  'nope',
  '',
  'toString',
];

const FIELDS = ['cooker', 'slot', 'board', 'mat', 'rack', 'item', 'customerId'];

describe('validKitchenAction', () => {
  it('모든 액션과 payload 조합에서 레거시와 같은 답을 낸다', () => {
    for (const action of ACTIONS) {
      for (const field of FIELDS) {
        for (const value of PAYLOAD_VALUES) {
          const payload = { [field]: value };
          expect(validKitchenAction(action, payload), action + ' ' + field).toBe(
            legacy.validKitchenAction(action, payload),
          );
        }
      }
      for (const payload of [undefined, null, {}, [], 'x', 7, Object.create(null)]) {
        expect(validKitchenAction(action, payload), action + ' payload').toBe(
          legacy.validKitchenAction(action, payload),
        );
      }
    }
  });

  it('냉장고 재료 이름 검사가 레거시와 같다', () => {
    const items = [
      'gim',
      'rice',
      'danmuji',
      'ham',
      'spinach',
      'crab',
      'cucumber',
      'egg',
      'carrot',
      'fishcake',
      'bap',
      'roll',
      'gimbap',
      'broom',
      'nope',
      '',
      '__proto__',
      'constructor',
      'hasOwnProperty',
      'x'.repeat(33),
      ...CONTROL_SAMPLES.map((c) => 'ham' + c),
    ];
    for (const item of items) {
      expect(validKitchenAction('fridge:take', { item }), JSON.stringify(item)).toBe(
        legacy.validKitchenAction('fridge:take', { item }),
      );
    }
  });

  it('액션 이름이 문자열이 아니어도 레거시와 같이 거부한다', () => {
    for (const action of [undefined, null, 7, {}, [], true]) {
      expect(validKitchenAction(action, {})).toBe(legacy.validKitchenAction(action, {}));
    }
  });
});

describe('validEvent', () => {
  const NAMES = [
    '김밥',
    'ab',
    'a',
    '  ab  ',
    '',
    '   ',
    'x'.repeat(12),
    'x'.repeat(13),
    ...CONTROL_SAMPLES.map((c) => 'ab' + c),
  ];
  const CODES = ['ABCD', 'abcd', ' ABCD ', 'ABC', 'ABCDE', 'AIOU', '1234', '', 'AB CD'];
  const LOOKS: unknown[] = [
    undefined,
    null,
    {},
    { h: 0, hc: 1 },
    { h: NaN },
    { h: Infinity },
    { h: '1' },
    { h: null },
    { h: {} },
    [],
    'x',
  ];

  it('room:create 가 이름 · 가게명 · 외형까지 레거시와 같이 판정한다', () => {
    for (const name of NAMES) {
      for (const look of LOOKS) {
        for (const shop of [undefined, '', '가게', 'x'.repeat(64), 'x'.repeat(65), 7]) {
          const d = { name, look, shop };
          expect(validEvent('room:create', d), JSON.stringify(d)).toBe(
            legacy.validEvent('room:create', d),
          );
        }
      }
    }
  });

  it('room:join 이 방 코드까지 레거시와 같이 판정한다', () => {
    for (const name of NAMES) {
      for (const code of CODES) {
        const d = { name, code };
        expect(validEvent('room:join', d), JSON.stringify(d)).toBe(
          legacy.validEvent('room:join', d),
        );
      }
    }
    for (const code of [undefined, null, 7, {}, []]) {
      const d = { name: '김밥', code };
      expect(validEvent('room:join', d)).toBe(legacy.validEvent('room:join', d));
    }
  });

  it('페이로드가 없어야 하는 이벤트를 레거시와 같이 판정한다', () => {
    for (const event of ['game:start', 'game:pause', 'game:lobby', 'room:leave']) {
      for (const d of [undefined, null, {}, 0, '', [], false]) {
        expect(validEvent(event, d), event).toBe(legacy.validEvent(event, d));
      }
    }
  });

  it('player:move 가 좌표와 version 을 레거시와 같이 판정한다', () => {
    const numbers = [0, 1, -1, 1.5, NaN, Infinity, -Infinity, '1', null, undefined];
    for (const x of numbers) {
      for (const version of [undefined, 0, 1, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER, '1', null]) {
        const d = { x, y: 0, z: 0, ry: 0, version };
        expect(validEvent('player:move', d), JSON.stringify(d)).toBe(
          legacy.validEvent('player:move', d),
        );
      }
    }
    for (const d of [undefined, null, {}, [], 'x', { x: 0, y: 0, z: 0 }]) {
      expect(validEvent('player:move', d)).toBe(legacy.validEvent('player:move', d));
    }
  });

  it('player:swing 이 대상 종류를 레거시와 같이 판정한다', () => {
    const ids = [undefined, null, 'c1', '', 'x'.repeat(64), 'x'.repeat(65), 7, {}];
    const kinds = [undefined, null, 'player', 'customer', 'wall', '', 7];
    for (const targetId of ids) {
      for (const targetKind of kinds) {
        const d = { targetId, targetKind };
        expect(validEvent('player:swing', d), JSON.stringify(d)).toBe(
          legacy.validEvent('player:swing', d),
        );
      }
    }
    for (const d of [undefined, null, {}, [], 'x']) {
      expect(validEvent('player:swing', d)).toBe(legacy.validEvent('player:swing', d));
    }
  });

  it('kitchen:act 과 모르는 이벤트를 레거시와 같이 판정한다', () => {
    for (const action of ACTIONS) {
      for (const payload of [undefined, {}, { slot: 0 }, { slot: 99 }, 'x']) {
        const d = { action, payload };
        expect(validEvent('kitchen:act', d), JSON.stringify(d)).toBe(
          legacy.validEvent('kitchen:act', d),
        );
      }
    }
    for (const event of ['nope', '', 'connect', 'toString', 'disconnect']) {
      expect(validEvent(event, {})).toBe(legacy.validEvent(event, {}));
    }
  });
});

describe('createEventLimiter', () => {
  it('이벤트별 예산이 레거시와 같다', () => {
    expect(EVENT_BUDGET).toEqual(legacy.EVENT_BUDGET);
  });

  it('토큰 버킷이 레거시와 같은 시점에 같은 답을 낸다', () => {
    let now = 1000;
    const clock = () => now;
    const mine = createEventLimiter(clock);
    const theirs = legacy.createEventLimiter(clock);
    const events = ['player:move', 'kitchen:act', 'room:create', 'game:start', 'nope'];
    for (const step of [0, 0, 0, 5, 50, 200, 1000, 0, 0, 0, 0, 0, 0]) {
      now += step;
      for (const event of events) {
        for (let i = 0; i < 5; i++) {
          expect(mine(event), event + '@' + now + '#' + i).toBe(theirs(event));
        }
      }
    }
  });

  it('바닥난 예산이 시간이 지나면 레거시와 같이 회복된다', () => {
    let now = 0;
    const clock = () => now;
    const mine = createEventLimiter(clock);
    const theirs = legacy.createEventLimiter(clock);
    for (let i = 0; i < 70; i++) expect(mine('player:move')).toBe(theirs('player:move'));
    for (const step of [1, 10, 25, 100, 500]) {
      now += step;
      expect(mine('player:move'), 'recover@' + now).toBe(theirs('player:move'));
    }
  });
});

describe('allowedOrigin', () => {
  it('오리진과 호스트 조합에서 레거시와 같은 답을 낸다', () => {
    const origins = [
      undefined,
      '',
      'http://localhost:3211',
      'https://gimbap.example',
      'https://gimbap.example/',
      'https://gimbap.example:443',
      'file://',
      'ws://gimbap.example',
      'null',
      'not a url',
    ];
    const hosts = ['localhost:3211', 'gimbap.example', undefined];
    const configs = [
      '',
      'https://gimbap.example',
      'https://a.example, https://gimbap.example',
      ' , ',
    ];
    for (const origin of origins) {
      for (const host of hosts) {
        for (const configured of configs) {
          const req = { headers: { origin, host } } as never;
          expect(allowedOrigin(req, configured), JSON.stringify({ origin, host, configured })).toBe(
            legacy.allowedOrigin(req, configured),
          );
        }
      }
    }
  });
});

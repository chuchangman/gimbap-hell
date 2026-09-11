/* 레거시 legacy/public/js/*.js 와 새 @repo/game-core 가 같은 값을 내는지 고정한다.
 *
 * 두 스택이 공존하는 동안 이 테스트가 유일한 안전장치다. 이식본이 조용히
 * 벌어지면 서버는 옛 규칙으로, 새 클라이언트는 새 규칙으로 돌게 된다.
 * 레거시가 사라지는 마지막 단계에서 이 파일도 같이 사라진다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as legacyConfig from '../legacy/public/js/config.js';
import * as legacyRules from '../legacy/public/js/game-rules.js';
import * as legacySpatial from '../legacy/public/js/spatial.js';
import * as legacyLayout from '../legacy/public/js/kitchen-layout.js';
import * as legacyRender from '../legacy/public/js/render-config.js';
import * as core from '@repo/game-core';

/** 두 구현에 같은 입력을 넣고 결과가 같은지 본다 */
const sweep = (name, oldFn, newFn, inputs) => {
  for (const args of inputs) {
    const a = oldFn(...args);
    const b = newFn(...args);
    assert.deepStrictEqual(b, a, name + '(' + JSON.stringify(args) + ')');
  }
};

const ITEM_IDS = Object.keys(legacyConfig.ITEMS);
const STAGES = ['raw', 'washed', 'done', 'burnt'];
const WAVE_SWEEP = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 99];
const INDEX_SWEEP = [-1, 0, 1, 2, 3, 4, 5];

test('공유 상수가 레거시와 값이 같다', () => {
  // game-rules.js
  for (const key of Object.keys(legacyRules)) {
    assert.deepStrictEqual(core[key], legacyRules[key], 'rules.' + key);
  }

  // config.js — 함수를 뺀 모든 export
  for (const [key, value] of Object.entries(legacyConfig)) {
    if (typeof value === 'function') continue;
    assert.deepStrictEqual(core[key], value, 'config.' + key);
  }

  // kitchen-layout.js
  assert.deepStrictEqual(core.KITCHEN_LAYOUT, legacyLayout.KITCHEN_LAYOUT);

  // spatial.js
  assert.deepStrictEqual(core.MOVEMENT, legacySpatial.MOVEMENT);
  assert.deepStrictEqual(core.SERVE_Z, legacySpatial.SERVE_Z);
  assert.deepStrictEqual(core.BROOM_SPOTS, legacySpatial.BROOM_SPOTS);
  assert.deepStrictEqual(core.WORLD_SOLIDS, legacySpatial.WORLD_SOLIDS);
  assert.deepStrictEqual(core.STATION_BOXES, legacySpatial.STATION_BOXES);

  // render-config.js
  assert.deepStrictEqual(core.CAMERA_VIEW, legacyRender.CAMERA_VIEW);
  assert.deepStrictEqual(core.PLAYER_INPUT, legacyRender.PLAYER_INPUT);
  assert.deepStrictEqual(core.CHARACTER_MOTION, legacyRender.CHARACTER_MOTION);
});

test('레거시 export 가 하나도 빠지지 않았다', () => {
  const covered = new Set(Object.keys(core));
  const missing = [];
  for (const source of [legacyConfig, legacyRules, legacySpatial, legacyLayout, legacyRender]) {
    for (const key of Object.keys(source)) if (!covered.has(key)) missing.push(key);
  }
  assert.deepStrictEqual(missing, [], '@repo/game-core 에 없는 레거시 export');
});

test('재료·해금 함수가 같은 답을 낸다', () => {
  sweep(
    'unlockedExtras',
    legacyConfig.unlockedExtras,
    core.unlockedExtras,
    WAVE_SWEEP.map((w) => [w]),
  );
  sweep(
    'unlockAt',
    legacyConfig.unlockAt,
    core.unlockAt,
    WAVE_SWEEP.map((w) => [w]),
  );
  sweep(
    'itemUnlockWave',
    legacyConfig.itemUnlockWave,
    core.itemUnlockWave,
    [...ITEM_IDS, 'nope', '', '__proto__'].map((id) => [id]),
  );

  const items = [null, undefined, { id: 'nope', stage: 'raw' }];
  for (const id of ITEM_IDS) for (const stage of STAGES) items.push({ id, stage });
  sweep(
    'itemLabel',
    legacyConfig.itemLabel,
    core.itemLabel,
    items.map((i) => [i]),
  );
});

test('조리 품질 계산이 같은 답을 낸다', () => {
  const elapsed = [0, 0.5, 1, 2, 3, 4, 4.9, 5, 5.1, 6, 8, 9, 10, 11, 12, 30];
  const grid = [];
  for (const id of ITEM_IDS) for (const e of elapsed) grid.push([legacyConfig.ITEMS[id], e]);
  sweep('cookQuality', legacyConfig.cookQuality, core.cookQuality, grid);
  sweep('cookStatus', legacyConfig.cookStatus, core.cookStatus, grid);

  sweep('cookAverage', legacyConfig.cookAverage, core.cookAverage, [
    [null],
    [undefined],
    [[]],
    [[{ id: 'ham', quality: 100 }]],
    [
      [
        { id: 'ham', quality: 33 },
        { id: 'egg', quality: 66 },
      ],
    ],
    [
      [
        { id: 'ham', quality: 0 },
        { id: 'egg', quality: 1 },
        { id: 'crab', quality: 2 },
      ],
    ],
  ]);
});

test('주문 맞춤도와 서빙 품질이 같은 답을 낸다', () => {
  const orders = [
    [],
    ['danmuji'],
    ['danmuji', 'ham', 'spinach'],
    ['danmuji', 'ham', 'spinach', 'crab'],
    ['egg', 'carrot', 'fishcake', 'cucumber', 'crab'],
  ];
  const rolls = [
    null,
    [],
    [{ id: 'danmuji', quality: 100 }],
    [
      { id: 'danmuji', quality: 80 },
      { id: 'ham', quality: 60 },
      { id: 'spinach', quality: 40 },
    ],
    [
      { id: 'crab', quality: 100 },
      { id: 'egg', quality: 50 },
    ],
    [
      { id: 'danmuji', quality: 90 },
      { id: 'ham', quality: 90 },
      { id: 'spinach', quality: 90 },
      { id: 'carrot', quality: 10 },
    ],
  ];
  const grid = [];
  for (const o of orders) for (const r of rolls) grid.push([o, r]);
  sweep('matchScore', legacyConfig.matchScore, core.matchScore, grid);
  sweep('servedQuality', legacyConfig.servedQuality, core.servedQuality, grid);
});

test('서빙 대상 선택(focusPick)이 같은 손님을 고른다', () => {
  const customer = (id, fills, deadline, state = 'wait', done = 0, need = 1) => ({
    id,
    fills,
    deadline,
    state,
    done,
    need,
  });
  const lists = [
    [],
    [customer('a', ['danmuji'], 100)],
    [customer('a', ['danmuji', 'ham'], 200), customer('b', ['danmuji', 'ham'], 100)],
    [customer('a', ['danmuji'], 100, 'walkin'), customer('b', ['ham'], 90)],
    [customer('a', ['danmuji'], 100, 'wait', 1, 1), customer('b', ['ham'], 90)],
    [
      customer('a', ['danmuji', 'ham', 'spinach'], 300),
      customer('b', ['danmuji', 'ham'], 200),
      customer('c', ['crab', 'egg'], 100),
    ],
  ];
  const fills = [
    null,
    [],
    [{ id: 'danmuji', quality: 100 }],
    [
      { id: 'danmuji', quality: 100 },
      { id: 'ham', quality: 100 },
    ],
    [
      { id: 'crab', quality: 100 },
      { id: 'egg', quality: 100 },
    ],
  ];
  for (const list of lists) {
    for (const f of fills) {
      const a = legacyConfig.focusPick(list, f);
      const b = core.focusPick(list, f);
      assert.deepStrictEqual(b.focusId, a.focusId, 'focusId');
      assert.deepStrictEqual(b.score, a.score, 'score');
      assert.deepStrictEqual([...b.bestIds], [...a.bestIds], 'bestIds');
      assert.deepStrictEqual(
        b.best.map((c) => c.id),
        a.best.map((c) => c.id),
        'best',
      );
    }
  }
});

test('안내 문구와 웨이브 스케일이 같다', () => {
  const items = [null, undefined, { id: 'broom', stage: 'done' }, { id: 'nope', stage: 'raw' }];
  for (const id of ITEM_IDS) for (const stage of STAGES) items.push({ id, stage });
  sweep(
    'handHint',
    legacyConfig.handHint,
    core.handHint,
    items.map((i) => [i]),
  );

  const scale = [];
  for (let n = 1; n <= 20; n++) for (let p = 0; p <= 8; p++) scale.push([n, p]);
  sweep('scaleCount', legacyConfig.scaleCount, core.scaleCount, scale);

  const grumble = [];
  for (const pct of [-1, 0, 0.1, 0.15, 0.2, 0.38, 0.4, 0.66, 0.7, 1, 1.5]) {
    for (const seed of [0, 1, 2, 3, 7, -5]) grumble.push([pct, seed]);
  }
  sweep('grumbleFor', legacyConfig.grumbleFor, core.grumbleFor, grumble);

  sweep(
    'slotX',
    legacyConfig.slotX,
    core.slotX,
    [0, 1, 2, 3, 4, 5, 6].map((i) => [i]),
  );
});

test('위치 보간이 같은 좌표를 낸다', () => {
  const turns = [];
  for (const from of [-3.2, -1, 0, 1, 3.1]) {
    for (const to of [-3.1, -0.5, 0, 2, 3.2]) turns.push([from, to]);
  }
  sweep('shortestTurn', legacyConfig.shortestTurn, core.shortestTurn, turns);

  const buf = [
    { t: 1000, x: 0, z: 0, y: 0, ry: 0 },
    { t: 1100, x: 1, z: 2, y: 0.5, ry: 3.0 },
    { t: 1200, x: 2, z: 1, y: 0, ry: -3.0 },
  ];
  const times = [0, 900, 1000, 1050, 1100, 1150, 1200, 1300];
  sweep('samplePath', legacyConfig.samplePath, core.samplePath, [
    [null, 1000],
    [undefined, 1000],
    [[], 1000],
    ...times.map((t) => [buf, t]),
  ]);
});

test('외형 정규화가 같은 조합을 낸다', () => {
  const looks = [
    null,
    undefined,
    {},
    legacyConfig.DEFAULT_LOOK,
    { h: -1, hc: 999, f: 1.9, t: '2', tc: NaN, b: null, bc: Infinity, e: 3, sc: 4, shc: 2 },
    { h: 8, hc: 5, f: 4, t: 5, tc: 7, b: 2, bc: 7, e: 7, sc: 6, shc: 4 },
  ];
  sweep(
    'sanitizeLook',
    legacyConfig.sanitizeLook,
    core.sanitizeLook,
    looks.map((l) => [l]),
  );

  const seeds = [];
  for (let s = -20; s <= 200; s += 7) seeds.push([s]);
  sweep('lookFromSeed', legacyConfig.lookFromSeed, core.lookFromSeed, seeds);
});

test('주방 배치 좌표 계산이 같다', () => {
  sweep(
    'burnerZ',
    legacyLayout.burnerZ,
    core.burnerZ,
    INDEX_SWEEP.map((i) => [i]),
  );
  sweep(
    'cookerZ',
    legacyLayout.cookerZ,
    core.cookerZ,
    INDEX_SWEEP.map((i) => [i]),
  );
  sweep(
    'boardX',
    legacyLayout.boardX,
    core.boardX,
    INDEX_SWEEP.map((i) => [i]),
  );
  sweep(
    'matX',
    legacyLayout.matX,
    core.matX,
    INDEX_SWEEP.map((i) => [i]),
  );
  sweep(
    'fridgeZ',
    legacyLayout.fridgeZ,
    core.fridgeZ,
    INDEX_SWEEP.map((i) => [i]),
  );
  sweep(
    'lineAt',
    legacyLayout.lineAt,
    core.lineAt,
    INDEX_SWEEP.map((i) => [{ start: -1.4, gap: 1.4 }, i]),
  );
});

test('상호작용 박스와 충돌 판정이 같다', () => {
  const refs = [
    { kind: 'sink' },
    { kind: 'bin' },
    { kind: 'serve' },
    { kind: 'nope' },
    { kind: 'fridge', item: 'gim' },
    { kind: 'fridge', item: 'fishcake' },
    { kind: 'fridge', item: 'nope' },
    { kind: 'fridge', item: '__proto__' },
    { kind: 'fridge' },
  ];
  const fieldOf = { cooker: 'cooker', burner: 'slot', board: 'board', mat: 'mat', broom: 'rack' };
  for (const kind of Object.keys(fieldOf)) {
    for (const v of [-1, 0, 1, 2, 4, 9, 1.5, '0', null, undefined]) {
      refs.push({ kind, [fieldOf[kind]]: v });
    }
  }
  sweep(
    'stationBox',
    legacySpatial.stationBox,
    core.stationBox,
    refs.map((r) => [r]),
  );

  const actions = [
    ['drop', {}, null],
    ['sink:put', {}, null],
    ['fridge:take', { item: 'ham' }, null],
    ['burner:put', { slot: 2 }, null],
    ['mat:roll', { mat: 1 }, null],
    ['broom:take', { rack: 2 }, null],
    ['serve', {}, null],
    ['serve', { customerId: 'c1' }, null],
    ['serve', { customerId: 'c1' }, { slot: 0 }],
    ['serve', { customerId: 'c1' }, { slot: 5 }],
  ];
  sweep('actionBox', legacySpatial.actionBox, core.actionBox, actions);

  const points = [
    { x: 0, z: 0 },
    { x: 0, z: 0, y: 0.5 },
    { x: -6.3, z: 1.1 },
    { x: 6.5, z: -1.2, y: 0.9 },
    { x: -3.1, z: -8.2 },
  ];
  const boxes = [
    null,
    legacySpatial.STATION_BOXES.sink,
    legacySpatial.STATION_BOXES.bin,
    legacySpatial.STATION_BOXES.burner[0],
    legacySpatial.STATION_BOXES.mat[2],
  ];
  const dist = [];
  for (const p of points) for (const b of boxes) dist.push([p, b]);
  sweep('interactionDistance', legacySpatial.interactionDistance, core.interactionDistance, dist);
});

test('이동 가능 판정이 같다', () => {
  const grid = [];
  for (let x = -9; x <= 9; x += 0.5) for (let z = -12; z <= 10; z += 0.5) grid.push([{ x, z }]);
  sweep('clearPosition', legacySpatial.clearPosition, core.clearPosition, grid);
  sweep(
    'clearPosition(radius)',
    legacySpatial.clearPosition,
    core.clearPosition,
    grid.slice(0, 200).map(([p]) => [p, 0.1]),
  );

  const paths = [
    [
      { x: -1.6, z: 5.6 },
      { x: -1.6, z: 2.6 },
    ],
    [
      { x: 0, z: 0 },
      { x: 0, z: -8 },
    ],
    [
      { x: -7, z: 0 },
      { x: 7, z: 0 },
    ],
    [
      { x: 3, z: 3 },
      { x: 3.001, z: 3.001 },
    ],
    [
      { x: 0, z: 6 },
      { x: 0, z: 6 },
    ],
    [
      { x: -7.5, z: -10.5 },
      { x: 7.5, z: 8.5 },
    ],
  ];
  sweep('clearPath', legacySpatial.clearPath, core.clearPath, paths);
});

/* ────────────────────────────────────────────────────────────
   4단계에서 통째로 복사해 온 파일들.
   Tailwind 로 다시 쓰지 않기로 한 이상 남은 위험은 "옮기다 한 줄 샜다" 뿐이다.
   바이트로 못 박는다 — 포맷터도 손대지 않는다(.prettierignore).
   ──────────────────────────────────────────────────────────── */
test('style.css 는 새 클라이언트로 한 글자도 안 바뀌고 옮겨졌다', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const legacy = at('../legacy/public/css/style.css');
  const ported = at('../apps/client/src/styles/style.css');
  // 엉뚱한 빈 파일끼리 비교하고 있지 않은지
  assert.ok(legacy.length > 10_000, '레거시 CSS 를 못 읽었다');
  assert.equal(ported, legacy);
});

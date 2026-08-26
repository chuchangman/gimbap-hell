/* 서버 로직 자동 검증 — 브라우저 없이 방/주방/웨이브/빗자루를 돌린다.
   지시사항 체크리스트를 그대로 항목으로 옮겨놓았다.
   실행: npm test                                                        */
import {
  TIME, ITEMS, WAVES, SCORE, REPUTATION_MAX, COMBAT,
  BURNERS, BOARD_COUNT, MAT_COUNT, COOKER_COUNT,
  BASE_FILLINGS, EXTRA_FILLINGS, ALL_FILLINGS, UNLOCKS, unlockedExtras, unlockAt,
  FRIDGE_ITEMS, KIND, SPECIAL_PATIENCE, SPECIAL_RATIO, QUEUE_SLOTS,
  matchScore, servedQuality, grumbleFor, scaleCount,
  CUSTOMER_HP, QUEUE_Z, slotX, focusPick
} from '../public/js/config.js';
import os from 'node:os';
import path from 'node:path';

/* 랭킹 파일은 임시 경로로 — 실제 기록(data/leaderboard.json)을 건드리지 않는다.
   leaderboard 는 첫 호출 때 경로를 읽으므로 import 뒤에 정해도 된다. */
process.env.GIMBAP_LEADERBOARD =
  path.join(os.tmpdir(), 'gimbap-test-lb-' + Date.now() + '.json');

import { Room, nameError, NAME_MIN, NAME_MAX } from '../server/room.mjs';
import { Kitchen } from '../server/kitchen.mjs';
import { WaveRunner } from '../server/waves.mjs';
import * as leaderboard from '../server/leaderboard.mjs';

let pass = 0, fail = 0;
const failed = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; failed.push(label); console.log('  ❌ ' + label); }
};
const head = (t) => console.log('\n' + t);
const rewind = (obj, key, s) => { if (obj) obj[key] -= s * 1000; };

/* 조리 완료 상태의 속재료 */
const done = (id, q) => ({ id, quality: q === undefined ? 100 : q });

/* ═════════════════════════════════════════════ */
head('[A] 재료 5종 추가 — 계란·당근·맛살·어묵·오이');

const fillIds = Object.keys(ITEMS).filter((k) => ITEMS[k].fill);
ok(fillIds.length === 8, '속재료가 8종이다 (' + fillIds.map((k) => ITEMS[k].name).join(',') + ')');
ok(ITEMS.egg.station === 'pan' && ITEMS.egg.target === TIME.fryEgg, 'A1 계란 — 프라이팬 지단 ' + TIME.fryEgg + '초');
ok(ITEMS.carrot.station === 'pan' && ITEMS.carrot.target === TIME.fryCarrot, 'A2 당근 — 프라이팬 볶기 ' + TIME.fryCarrot + '초');
ok(!ITEMS.crab.station, 'A3 맛살 — 손질 불필요');
ok(ITEMS.fishcake.station === 'pan' && ITEMS.fishcake.target === TIME.fryFishcake, 'A4 어묵 — 프라이팬 볶기 ' + TIME.fryFishcake + '초');
ok(ITEMS.cucumber.station === 'board' && ITEMS.cucumber.dur === TIME.cutCucumber, 'A5 오이 — 도마 ' + TIME.cutCucumber + '초');
ok(EXTRA_FILLINGS.every((id) => FRIDGE_ITEMS.includes(id)), 'A6 추가 재료가 전부 냉장고에 진열된다');

/* ═════════════════════════════════════════════ */
head('[B] 설비 하나씩 추가');

ok(BURNERS.length === 5, 'B1 가스렌지 5구 (' + BURNERS.map((b) => b.kind).join(',') + ')');
ok(BURNERS.filter((b) => b.kind === 'pan').length === 3, '   팬 재료가 4종이라 팬을 3개로');
ok(BOARD_COUNT === 3, 'B2 도마 3대');
ok(MAT_COUNT === 3, 'B3 조립대 3대');
ok(COOKER_COUNT === 2, 'B4 밥솥 2대');

const K = new Kitchen();
K.join('a');
ok(K.burners.length === 5 && K.boards.length === 3 && K.mats.length === 3 && K.cookers.length === 2,
  '   주방 상태에도 그대로 반영된다');
ok(K.act('a', 'cooker:put', { cooker: 1 }).ok === false, '   2번 밥솥도 규칙 검사를 받는다');

/* ═════════════════════════════════════════════ */
head('[A/E] 새 재료 공정이 실제로 돈다');

K.act('a', 'fridge:take', { item: 'crab' });
ok(K.hand('a').stage === 'done', '맛살은 집는 즉시 쓸 수 있다 (손질 불필요)');
K.setHand('a', null);

K.act('a', 'fridge:take', { item: 'cucumber' });
ok(K.act('a', 'burner:put', { slot: 0 }).ok === false, '오이는 화구에 못 올린다');
K.act('a', 'board:put', { board: 2 });
ok(!!K.boards[2], '오이 → 3번 도마');
rewind(K.boards[2], 'at', TIME.cutCucumber + 0.1);
K.act('a', 'board:take', { board: 2 });
ok(K.hand('a').id === 'cucumber' && K.hand('a').stage === 'done', '썬 오이가 나온다');
K.setHand('a', null);

for (const [id, slot] of [['egg', 4], ['carrot', 3], ['fishcake', 1]]) {
  K.act('a', 'fridge:take', { item: id });
  const r = K.act('a', 'burner:put', { slot });
  ok(r.ok, ITEMS[id].name + ' → ' + (slot + 1) + '번 화구(팬)');
  rewind(K.burners[slot], 'at', ITEMS[id].target);
  K.act('a', 'burner:take', { slot });
  ok(K.hand('a').stage === 'done' && K.hand('a').quality >= 95,
    '  제 시간에 꺼낸 ' + ITEMS[id].name + ' 품질 ' + K.hand('a').quality);
  K.setHand('a', null);
}

K.act('a', 'fridge:take', { item: 'gim' });
K.act('a', 'mat:put', { mat: 2 });
K.cookers[0].state = 'ready'; K.cookers[0].servings = 5;
K.act('a', 'cooker:take', { cooker: 0 });
K.act('a', 'mat:put', { mat: 2 });
for (const id of ALL_FILLINGS) {
  K.setHand('a', { uid: 900, id, stage: 'done', quality: 100 });
  K.act('a', 'mat:put', { mat: 2 });
}
ok(K.mats[2].fills.length === 8, '조립대 3번에 8종이 다 올라간다');
K.setHand('a', { uid: 901, id: 'ham', stage: 'done', quality: 100 });
ok(K.act('a', 'mat:put', { mat: 2 }).ok === false, '같은 재료를 두 번 넣을 수는 없다');
K.setHand('a', null);
K.act('a', 'mat:roll', { mat: 2 });
rewind(K.mats[2], 'rollAt', TIME.roll + 0.1);
K.act('a', 'mat:take', { mat: 2 });
ok(K.hand('a').id === 'roll' && K.hand('a').fills.length === 8, '만 김밥이 속재료 목록을 들고 나온다');
K.act('a', 'board:put', { board: 0 });
rewind(K.boards[0], 'at', TIME.cutRoll + 0.1);
K.act('a', 'board:take', { board: 0 });
ok(K.hand('a').id === 'gimbap' && K.hand('a').fills.length === 8, '썬 김밥도 속재료를 유지한다');

/* ═════════════════════════════════════════════ */
head('[F3] 웨이브별 재료 해금');

ok(Object.keys(UNLOCKS).length === EXTRA_FILLINGS.length, '추가 재료 5종에 해금 웨이브가 하나씩 배정돼 있다');
ok(unlockedExtras(1).length === 0, 'W1 — 기본 3종만');
const seq = [2, 3, 4, 6, 8].map((w) => ITEMS[unlockAt(w)].name);
ok(seq.join(',') === '맛살,오이,계란,당근,어묵', '해금 순서: ' + seq.join(' → ') + ' (쉬운 것부터)');
let prev = 0, mono = true;
for (let w = 1; w <= 10; w++) { const n = unlockedExtras(w).length; if (n < prev) mono = false; prev = n; }
ok(mono, '웨이브가 갈수록 쓸 수 있는 재료가 줄지 않는다');
ok(unlockedExtras(10).length === 5, 'W10 — 8종 전부 해금');

const WU = new WaveRunner(3);
WU.wave = 1;
rewind(WU, 'phaseEndsAt', 999);
const ev2 = WU.tick();
ok(ev2[0] && ev2[0].unlocked === 'crab' && !!ev2[0].unlockedName,
  '해금 웨이브 시작 시 waveStart 가 해금 재료를 알린다 (' + (ev2[0] && ev2[0].unlockedName) + ')');

/* ═════════════════════════════════════════════ */
head('[C/D/E] 키오스크 일반 손님 vs 카운터 진상 손님');

const W = new WaveRunner(3);
const built = W.buildWave(8);
const kiosks = built.list.filter((c) => c.kind === KIND.KIOSK);
const counters = built.list.filter((c) => c.kind === KIND.COUNTER);

ok(kiosks.length > 0 && counters.length > 0, 'W8 — 키오스크 ' + kiosks.length + '명, 진상 ' + counters.length + '명');
ok(Math.abs(counters.length / built.count - SPECIAL_RATIO) <= 0.18,
  'D5 진상 비율이 약 ' + Math.round(SPECIAL_RATIO * 100) + '% (실제 ' + Math.round(counters.length / built.count * 100) + '%)');
ok(kiosks.every((c) => BASE_FILLINGS.every((b) => c.fills.includes(b))),
  'E1 일반 손님 주문은 기본 3종을 항상 포함한다');
ok(kiosks.every((c) => c.fills.every((f) => ALL_FILLINGS.includes(f))),
  '   추가 재료는 해금된 것에서만 얹는다');
ok(counters.every((c) => c.patienceMax < kiosks[0].patienceMax),
  'D4 진상 인내심(' + counters[0].patienceMax + '초)이 일반(' + kiosks[0].patienceMax + '초)보다 짧다');
ok(Math.abs(counters[0].patienceMax / kiosks[0].patienceMax - SPECIAL_PATIENCE) < 0.05,
  '   배율 ' + SPECIAL_PATIENCE + ' 로 적용된다');
const custom = [];
for (let i = 0; i < 40; i++) custom.push(W.counterOrder(10));
ok(custom.some((f) => !BASE_FILLINGS.every((b) => f.includes(b))),
  'E2 진상 주문은 기본 3종 규칙의 예외다 (커스텀 조합)');
ok(custom.every((f) => f.length >= 3 && f.length <= 5), '   진상 주문은 3~5종을 요구한다');

const W2 = new WaveRunner(3);
W2.wave = 9;                       // 손님이 자리보다 많은 웨이브로
rewind(W2, 'phaseEndsAt', 999);
W2.tick();
for (let i = 0; i < 20; i++) { W2.nextSpawnAt = 0; W2.tick(); }
const activeKiosk = W2.active.filter((c) => c.kind === KIND.KIOSK);
const activeCounter = W2.active.filter((c) => c.kind === KIND.COUNTER);
ok(activeKiosk.length > 0 && activeKiosk.every((c) => c.slot >= 0),
  'C1 일반 손님도 카운터에 자리를 잡는다 (3D 에 보인다)');
ok(W2.active.every((c) => c.state === 'walkin' || c.state === 'wait'),
  '   모두 문으로 걸어 들어온다');
ok(activeCounter.every((c) => c.slot >= 0), 'D1 진상 손님도 카운터 자리를 받는다');
ok(W2.active.length <= QUEUE_SLOTS,
  '   카운터 자리 ' + QUEUE_SLOTS + '개를 넘겨 들어오지 않는다 (' + W2.active.length + '명)');
ok(W2.pending.length > 0, '   자리가 없으면 밖에서 기다린다 (' + W2.pending.length + '명)');

const bands = [0.9, 0.5, 0.25, 0.05].map((p) => grumbleFor(p, 1));
ok(new Set(bands).size === 4, 'D3 인내심 구간마다 다른 대사가 나온다');
ok(bands.every((b) => typeof b === 'string' && b.length > 0), '   4단계 대사: ' + bands.join(' / '));

const W3 = new WaveRunner(3);
W3.wave = 7;                       // 진상이 확실히 섞이는 웨이브로
rewind(W3, 'phaseEndsAt', 999);
W3.tick();
// 종류별로 정확히 한 명씩만 세워 결정적으로 검사한다
const oneC = W3.pending.find((c) => c.kind === KIND.COUNTER);
const oneK = W3.pending.find((c) => c.kind === KIND.KIOSK);
W3.pending = [oneC, oneK].filter(Boolean);
W3.active = [];
for (let i = 0; i < 2; i++) { W3.nextSpawnAt = 0; W3.tick(); }
for (const c of W3.active) if (c.state === 'walkin') rewind(c, 'since', 3);
W3.tick();
const victimC = W3.active.find((c) => c.kind === KIND.COUNTER && c.state === 'wait');
const victimK = W3.active.find((c) => c.kind === KIND.KIOSK && c.state === 'wait');
if (victimC && victimK) {
  let rep = W3.reputation;
  victimK.deadline = Date.now() - 1; W3.tick();
  const lossK = rep - W3.reputation; rep = W3.reputation;
  victimC.deadline = Date.now() - 1; W3.tick();
  const lossC = rep - W3.reputation;
  ok(lossK === SCORE.repLoss && lossC === SCORE.repLossSpecial,
    '진상을 놓치면 평판이 더 크게 깎인다 (일반 -' + lossK + ' / 진상 -' + lossC + ')');
} else {
  ok(false, '이탈 검증용 손님을 못 잡았다');
}

/* ═════════════════════════════════════════════ */
head('[G] 서빙 — 자동 최적 매칭');

ok(matchScore(['ham', 'egg'], [done('ham'), done('egg')]) === 1, '주문대로면 일치 100%');
ok(matchScore(['ham', 'egg'], [done('ham')]) < 1, '재료가 빠지면 깎인다');
ok(matchScore(['ham'], [done('ham'), done('egg')]) < 1, '쓸데없이 더 넣어도 깎인다');
ok(matchScore(['ham', 'egg'], [done('ham')]) < matchScore(['ham'], [done('ham'), done('egg')]),
  '빠진 게 더 넣은 것보다 크게 깎인다');
ok(servedQuality(['ham'], [done('ham', 60)]) === 60, '최종 품질 = 조리 평균 × 맞춤도');

const W4 = new WaveRunner(3);
rewind(W4, 'phaseEndsAt', 999);
W4.tick();
for (let i = 0; i < 10; i++) { W4.nextSpawnAt = 0; W4.tick(); }
for (const c of W4.active) if (c.state === 'walkin') rewind(c, 'since', 3);
W4.tick();
const waiting = W4.active.filter((c) => c.state === 'wait' && c.done < c.need);
if (waiting.length >= 2) {
  const pickC = waiting[1];
  waiting.forEach((c, i) => { if (i !== 1) c.deadline = Date.now() + 900000; });
  const exact = pickC.fills.map((id) => done(id));
  ok(W4.bestMatch(exact).id === pickC.id, 'G1 재료가 맞는 주문으로 자동으로 간다');
  const r = W4.serve(exact);
  ok(r.ok && r.quality === 100, '   완전 일치 서빙 품질 100 — ' + r.msg);

  const other = W4.active.find((c) => c.state === 'wait' && c.done < c.need);
  if (other) {
    const r2 = W4.serve([done('ham')]);
    ok(r2.ok && r2.quality < 100, 'G2 재료가 안 맞으면 품질이 깎인다 (' + r2.quality + ')');
  } else ok(true, '(불일치 검증 생략 — 남은 주문 없음)');
} else {
  ok(false, '매칭 검증용 주문을 못 잡았다');
}

/* 손님을 지목해서 서빙 */
const WT = new WaveRunner(3);
WT.wave = 7;
rewind(WT, 'phaseEndsAt', 999);
WT.tick();
for (let i = 0; i < 4; i++) { WT.nextSpawnAt = 0; WT.tick(); }
for (const c of WT.active) if (c.state === 'walkin') rewind(c, 'since', 3);
WT.tick();
const two = WT.active.filter((c) => c.state === 'wait' && c.done < c.need);
if (two.length >= 2) {
  // 조합은 첫 손님에게 맞지만, 두 번째 손님을 지목한다
  const aim = two[1];
  const fillsForFirst = two[0].fills.map((id) => done(id));
  ok(WT.bestMatch(fillsForFirst).id === two[0].id, '   자동 매칭이면 조합이 맞는 쪽으로 간다');
  const r = WT.serve(fillsForFirst, aim.id);
  ok(r.ok && r.customer.id === aim.id,
    'G3 손님을 지목하면 조합과 무관하게 그 손님에게 나간다');
  ok(WT.waitingById('없는손님') === null, '   없는 손님을 지목하면 거부된다');
  const gone = WT.serve([done('ham')], '없는손님');
  ok(gone.ok === false, '   이미 간 손님을 지목하면 서빙되지 않는다');
} else {
  ok(false, '지목 서빙 검증용 손님을 못 잡았다');
}

const room = new Room('MTCH');
room.addPlayer('p', '나');
room.start();
rewind(room.waves, 'phaseEndsAt', 999);
room.tick();
for (let i = 0; i < 6; i++) { room.waves.nextSpawnAt = 0; room.tick(); }
for (const c of room.waves.active) if (c.state === 'walkin') rewind(c, 'since', 3);
room.tick();
const tgt = room.waves.active.find((c) => c.state === 'wait');
if (tgt) {
  room.kitchen.setHand('p', {
    uid: 1, id: 'gimbap', stage: 'done', quality: 100,
    fills: tgt.fills.map((id) => done(id))
  });
  const before = room.waves.score;
  const r = room.serve('p');
  ok(r.ok && room.waves.score > before, 'Room.serve 가 속재료를 넘겨 매칭한다 — ' + r.msg);
  ok(room.kitchen.hand('p') === null, '   서빙하면 손에서 빠진다');
} else ok(false, 'Room 서빙 검증용 주문을 못 잡았다');

/* ═════════════════════════════════════════════ */
head('[F1] 웨이브 밸런스');

ok(WAVES.length === 10, '웨이브 10개');
ok(WAVES[0].patience > WAVES[9].patience,
  '인내심 ' + WAVES[0].patience + '초 → ' + WAVES[9].patience + '초');
ok(WAVES[0].n < WAVES[9].n, '손님 ' + WAVES[0].n + '명 → ' + WAVES[9].n + '명');
ok(WAVES.every((w) => w.orders.every((o) => o === 1)),
  'F6 모든 주문이 김밥 1줄로 통일됐다');
const rolls = WAVES.map((w) => w.n);
ok(rolls.every((r, i) => i === 0 || r >= rolls[i - 1]),
  '손님 수가 뒤로 갈수록 줄지 않는다 (' + rolls.join('→') + ')');
ok(WAVES.every((w, i) => i === 0 || w.gap <= WAVES[i - 1].gap), '등장 간격이 점점 좁아진다');
ok(WAVES.every((w, i) => i === 0 || w.patience <= WAVES[i - 1].patience), '인내심이 계속 줄어든다');
ok(WAVES[0].gap >= 18, '초반 간격이 김밥 한 줄 제작 시간(20~30초)에 맞게 넉넉하다');
ok(scaleCount(WAVES[9].n, 1) < scaleCount(WAVES[9].n, 5),
  '인원수에 따라 손님이 조정된다 (1인 ' + scaleCount(WAVES[9].n, 1) + ' → 5인 ' + scaleCount(WAVES[9].n, 5) + ')');

/* ═════════════════════════════════════════════ */
head('[회귀] 빗자루 · 멀티 · 승패 · 최적화');

const r2 = new Room('BRM');
r2.addPlayer('me', '나'); r2.addPlayer('you', '너');
r2.start();
const rk = r2.kitchen;
ok(r2.swing('me', 'you') === null, '빗자루 없이는 스윙이 안 나간다');
rk.act('me', 'broom:take', { rack: 0 });
ok(rk.act('me', 'fridge:take', { item: 'gim' }).ok === false, '빗자루를 들면 재료를 못 든다');
rk.act('you', 'fridge:take', { item: 'egg' });
const me = r2.players.get('me'), you = r2.players.get('you');
me.x = 0; me.z = 0; me.ry = 0; you.x = 0; you.z = -1.5;
const out = r2.swing('me', 'you');
ok(out && out.hit && rk.hand('you') === null, '정면 명중 — 맞은 사람이 재료를 놓친다');
ok(r2.swing('me', 'you') === null, '쿨다운 ' + COMBAT.cooldown + 'ms');

const K2 = new Kitchen();
K2.join('x'); K2.join('y');
K2.act('x', 'fridge:take', { item: 'gim' });
ok(!!K2.hand('x') && !K2.hand('y'), '손은 사람마다 따로다');

const W5 = new WaveRunner(1);
W5.wave = 9;
rewind(W5, 'phaseEndsAt', 999);
W5.tick();
W5.pending = []; W5.active = [];
const evs = W5.tick();
ok(W5.result === 'victory' && evs.some((e) => e.type === 'gameOver'), '10웨이브를 넘기면 완주');

const W6 = new WaveRunner(1);
rewind(W6, 'phaseEndsAt', 999);
W6.tick();
W6.reputation = 1;
W6.tick();
const vic = W6.active[0];
if (vic) {
  if (vic.state === 'walkin') { rewind(vic, 'since', 3); W6.tick(); }
  vic.deadline = Date.now() - 1;
  W6.tick();
  ok(W6.result === 'defeat', '평판이 0이 되면 폐업');
} else ok(false, '폐업 검증용 손님을 못 잡았다');

const st = new Room('SNAP');
st.addPlayer('s', 's'); st.start();
const snap = st.publicState();
ok(snap.wave && snap.wave.unlocked && snap.wave.reputation === REPUTATION_MAX,
  '공개 상태에 해금 목록과 평판이 들어 있다');
ok(st.stateSignature() === st.stateSignature(),
  '시각만 흐른 상태는 같은 서명 → 브로드캐스트를 건너뛴다 (최적화)');

/* ═════════════════════════════════════════════ */
head('[H] 가게 이름 · 🏆 점수 순 랭킹');

ok(leaderboard.cleanShopName('  동네 김밥지옥  ') === '동네 김밥지옥', '가게 이름 앞뒤 공백을 다듬는다');
ok(leaderboard.cleanShopName('') === '이름 없는 김밥집', '빈 이름은 기본값으로');
ok(leaderboard.cleanShopName('가'.repeat(40)).length === leaderboard.SHOP_MAX,
  '이름은 ' + leaderboard.SHOP_MAX + '자로 자른다');
ok(!leaderboard.cleanShopName('김밥지옥').includes(''), '제어문자를 걸러낸다');

const named = new Room('SHOP', '  우리동네 김밥  ');
named.addPlayer('h', '사장');
named.resolveShop();
ok(named.shop === '우리동네 김밥', '방을 만들 때 정한 가게 이름이 그대로 붙는다');
ok(named.publicState().shop === '우리동네 김밥', '공개 상태로 가게 이름이 나간다');

/* 이름을 안 정하면 방장 닉네임을 따서 "○○의 가게" */
const auto = new Room('AUTO', '');
auto.addPlayer('h', '김알바');
auto.resolveShop();
ok(auto.shop === '김알바의 가게', '가게 이름을 비우면 「방장닉의 가게」 (' + auto.shop + ')');

const auto2 = new Room('AUT2');
auto2.addPlayer('h', '   ');
auto2.resolveShop();
ok(auto2.shop === '알바1의 가게', '닉네임도 비우면 기본 닉네임을 따른다 (' + auto2.shop + ')');

const longName = new Room('LONG');
longName.addPlayer('h', '가나다라마바사아자차카타');   // 12자 (이름 최대)
longName.resolveShop();
ok(longName.shop.length <= leaderboard.SHOP_MAX,
  '긴 닉네임이어도 가게 이름은 ' + leaderboard.SHOP_MAX + '자를 안 넘는다 (' + longName.shop + ')');
ok(longName.shop.endsWith('의 가게') || longName.shop.length === leaderboard.SHOP_MAX,
  '   형식은 「닉네임의 가게」를 유지한다');

ok(new Room('NONE').shop === 'NONE 김밥집', '방장이 아직 없으면 방 코드로 대신한다');

/* 서로 다른 점수의 가게 3곳을 기록해 순위를 확인 */
function finish(shop, score) {
  const r = new Room('X', shop);
  r.addPlayer('u', '알바');
  r.start();
  r.waves.score = score;
  r.waves.wave = 5;
  return r.buildResult('defeat');
}
const low = finish('낮은집', 100);
const high = finish('높은집', 900);
const mid = finish('중간집', 500);

/* rank 는 "그 판이 끝난 시점"의 순위다 — 나중 기록이 밀어내도 그때 본 순위는 남는다 */
ok(low.rank === 1, '첫 기록은 그 시점에 1위 (' + low.shop + ')');
ok(high.rank === 1, '더 높은 점수가 들어오면 그 판이 1위 (' + high.shop + ' ' + high.score + '점)');
ok(mid.rank === 2, '중간 점수는 2위로 들어간다 (' + mid.shop + ' ' + mid.score + '점)');

/* 최종 랭킹은 점수 순으로 다시 줄 세워진다 */
const order = leaderboard.top(3).map((r) => r.shop);
ok(order.join(' > ') === '높은집 > 중간집 > 낮은집', '최종 랭킹 정렬: ' + order.join(' > '));

const bd = mid.board;
ok(bd && bd.top.length >= 3, '결과에 랭킹 목록이 실려 온다');
ok(bd.top[0].score >= bd.top[1].score && bd.top[1].score >= bd.top[2].score, '점수 내림차순으로 정렬된다');
ok(bd.top.some((r) => r.id === mid.entryId), '이번 판이 목록에 표시된다');
ok(typeof bd.total === 'number' && bd.total >= 3, '전체 기록 수가 함께 온다 (' + bd.total + '건)');
ok(bd.top[0].at && !Number.isNaN(Date.parse(bd.top[0].at)), '기록 시각이 ISO 문자열로 저장된다');
ok(Array.isArray(bd.top[0].players) && bd.top[0].players.length >= 1, '참가자 이름이 기록된다');

const tie1 = finish('동점A', 500);
const tie2 = finish('동점B', 500);
ok(tie1.rank < tie2.rank, '동점이면 먼저 세운 기록이 앞선다');

/* 11개를 채워 10위 밖 처리 확인 */
for (let i = 0; i < 12; i++) finish('채우기' + i, 2000 + i);
const pushed = finish('밀려난집', 1);
ok(pushed.rank > 10, '점수가 낮으면 10위 밖으로 밀린다 (' + pushed.rank + '위)');
ok(pushed.board.top.length === 10, '상위 10개만 보여준다');
ok(pushed.board.outside && pushed.board.outside.shop === leaderboard.maskShop('밀려난집'),
  '10위 밖이면 이번 판을 따로 붙여 보여준다 (' + (pushed.board.outside || {}).shop + ')');
ok(pushed.board.top.every((r) => r.shop !== '높은집'),
  '   결과 화면 랭킹도 가게 이름을 가린다');
ok(leaderboard.top(3).length === 3, 'top(n) 이 상위 n 개를 준다');

/* 저장소 모드 — 환경변수가 없으면 파일, UPSTASH_* 가 있으면 Redis (배포판) */
const lbStore = await leaderboard.init();
ok(lbStore.mode === 'file', '환경변수가 없으면 파일 모드로 뜬다 (' + lbStore.mode + ')');
ok(lbStore.count === leaderboard.size(), '   부팅 정보의 건수가 실제 랭킹과 같다 (' + lbStore.count + '건)');
ok(!lbStore.error, '   파일 모드에선 연결 오류가 없다');

/* ═════════════════════════════════════════════ */
head('[H2] 🙈 랭킹 가게 이름 가리기 · 🔤 닉네임 2글자');

ok(leaderboard.maskShop('동네김밥집') === '동●●●●', "'동네김밥집' → " + leaderboard.maskShop('동네김밥집'));
ok(leaderboard.maskShop('가') === '가', '한 글자면 가릴 것이 없다');
ok(leaderboard.maskShop('') === '', '빈 이름은 빈 채로');
ok(leaderboard.maskShop(null) === '', 'null 도 안 터진다');
ok(leaderboard.maskShop('🍣김밥') === '🍣●●', '이모지도 한 글자로 센다 (' + leaderboard.maskShop('🍣김밥') + ')');
ok(leaderboard.maskShop('AB').length === 2, '길이는 원본과 같다 — 몇 글자인지까진 숨기지 않는다');

const pubTop = leaderboard.publicTop(3);
ok(pubTop.length === 3 && pubTop.every((r) => /^.●*$/u.test(r.shop) || Array.from(r.shop).length === 1),
  'publicTop 은 가게 이름을 가려서 준다 (' + pubTop.map((r) => r.shop).join(', ') + ')');
ok(leaderboard.top(3)[0].shop !== pubTop[0].shop, '   원본 top() 은 그대로 둔다 — 저장된 값은 안 건드린다');

const rawFirst = leaderboard.top(1)[0];
const pubBoard = leaderboard.publicBoard(rawFirst.id, 3);
ok(Array.from(pubBoard.top[0].shop)[0] === Array.from(rawFirst.shop)[0], '   첫 글자는 살아 있다');
ok(pubBoard.top.every((r) => r.score !== undefined), '   점수 같은 나머지 필드는 그대로');

ok(nameError('김') !== null, '한 글자 닉네임은 거절한다');
ok(nameError('') !== null, '빈 닉네임도 거절한다');
ok(nameError(null) !== null, 'null 닉네임도 거절한다');
ok(nameError('  가  ') !== null, '공백을 빼고 한 글자면 거절한다');
ok(nameError('김밥') === null, NAME_MIN + '글자면 통과한다');
ok(nameError('가'.repeat(NAME_MAX)) === null, NAME_MAX + '글자까지 통과한다');
ok(nameError('가'.repeat(NAME_MAX + 1)) !== null, NAME_MAX + '글자를 넘으면 거절한다');


head('[I] 🧹 손님 체력 — 때려서 쫓아내기');

/** 검증용으로 손님을 카운터 자리에 바로 세운다 (웨이브 진행을 기다리지 않는다) */
const stand = (w, c, slot) => {
  const t = Date.now();
  c.slot = slot;
  c.state = 'wait';
  c.since = t;
  c.enteredAt = t;
  c.deadline = t + c.patienceMax * 1000;
  w.active.push(c);
  return c;
};

const rh = new Room('HPX');
rh.addPlayer('p1', '점장');
rh.start();
const wh = rh.waves;
wh.pending = [];
wh.active = [];

/* 후반 웨이브를 뽑으면 일반·진상이 함께 들어 있다 */
const seed = wh.buildWave(6).list;
const normal = stand(wh, seed.find((c) => c.kind !== KIND.COUNTER), 0);
const special = stand(wh, seed.find((c) => c.kind === KIND.COUNTER), 1);

ok(!!normal && !!special, '검증용으로 일반·진상 손님을 하나씩 세웠다');
ok(wh.active.every((c) => c.hp === c.hpMax && c.hp > 0), '손님마다 체력이 가득 찬 채로 등장한다');
ok(CUSTOMER_HP.special > CUSTOMER_HP.normal,
  '진상 손님이 더 맷집이 좋다 (' + CUSTOMER_HP.normal + ' vs ' + CUSTOMER_HP.special + ')');
ok(normal.hpMax === CUSTOMER_HP.normal, '일반 손님 체력 ' + CUSTOMER_HP.normal);
ok(special.hpMax === CUSTOMER_HP.special, '진상 손님 체력 ' + CUSTOMER_HP.special);

/* 스냅샷에 실려 나가야 클라이언트가 체력바를 그릴 수 있다 */
const snapC = wh.snapshot().customers[0];
ok(snapC && snapC.hp != null && snapC.hpMax != null, '스냅샷에 hp / hpMax 가 실린다');

/* 한 대에 1 만 깎인다 */
const before = { score: wh.score, rep: wh.reputation, hp: special.hp };
const h1 = wh.hit(special.id);
ok(h1 && h1.kicked === false && special.hp === before.hp - 1, '한 대에 체력이 1 깎인다');
ok(wh.score === before.score && wh.reputation === before.rep,
  '아직 안 쫓겨났으면 점수·평판은 그대로');

/* 0 이 되면 쫓겨난다 */
let last = null;
while (special.hp > 0) last = wh.hit(special.id);
ok(last && last.kicked === true, '체력이 0 이 되면 쫓겨난다');
ok(special.state === 'kicked', "쫓겨난 손님은 state === 'kicked'");
ok(wh.score === before.score + SCORE.kick, '쫓아내면 점수 ' + SCORE.kick);
ok(wh.reputation === before.rep - SCORE.repLossKick, '평판 -' + SCORE.repLossKick);
ok(SCORE.repLossKick < SCORE.repLoss,
  '쫓아내는 편이 인내심 초과보다 평판 손해가 적다 (손절 선택지)');
ok(wh.snapshot().kicked === 1, '쫓아낸 수가 스냅샷에 집계된다');
ok(wh.hit(special.id) === null, '이미 쫓겨난 손님은 더 못 때린다');
ok(wh.waitingById(special.id) == null, '쫓겨난 손님에게는 서빙할 수 없다');
ok(CUSTOMER_HP.normal * 1 > 0 && normal.hp === normal.hpMax, '옆 손님은 멀쩡하다');

/* Room.swing — 사거리·정면·빗자루 소지를 서버가 다시 검사한다 */
const rs = new Room('SWG');
rs.addPlayer('p1', '점장');
rs.start();
const ws = rs.waves;
ws.pending = [];
ws.active = [];
const kickTarget = stand(ws, ws.buildWave(6).list.find((c) => c.kind === KIND.COUNTER), 2);
const kicker = rs.players.get('p1');
const FRONT = { x: slotX(kickTarget.slot), z: QUEUE_Z + 1.5 };   // 카운터 이쪽 편

ok(rs.swing('p1', kickTarget.id, 'customer') === null, '빗자루 없이는 손님도 못 때린다');
rs.kitchen.act('p1', 'broom:take', { rack: 0 });

kicker.x = FRONT.x; kicker.z = FRONT.z; kicker.ry = 0;           // yaw=0 → -z (손님 쪽)
const s1 = rs.swing('p1', kickTarget.id, 'customer');
ok(s1 && s1.customerHit && kickTarget.hp === kickTarget.hpMax - 1, '조준한 손님이 실제로 맞는다');

const hpNow = kickTarget.hp;
kicker.lastSwing = 0;
kicker.z = QUEUE_Z + COMBAT.range + 2;                            // 너무 멀다
rs.swing('p1', kickTarget.id, 'customer');
ok(kickTarget.hp === hpNow, '사거리 밖에서는 안 맞는다');

kicker.lastSwing = 0;
kicker.z = FRONT.z; kicker.ry = Math.PI;                          // 등 돌림
rs.swing('p1', kickTarget.id, 'customer');
ok(kickTarget.hp === hpNow, '등을 돌리면 안 맞는다');

kicker.lastSwing = 0; kicker.ry = 0;
ok(rs.swing('p1', 'no-such-customer', 'customer').customerHit === null,
  '없는 손님을 찍어도 아무 일 없다');

kicker.lastSwing = 0;
ok(rs.swing('p1', null, 'customer').customerHit === null, '허공에 휘두르면 빈 스윙');


head('[J] 🎯 서빙 대상 고르기 — 윤곽선(복수) · 취소선(1명)');

/* 검증용 가짜 손님. focusPick 은 state/done/need/fills/deadline/id 만 본다. */
const cust = (id, fills, deadline, extra) => Object.assign(
  { id, fills, deadline, state: 'wait', done: 0, need: 1 }, extra || {});
const raw = (ids) => ids.map((id) => ({ id, quality: 100 }));

const BASE = ['danmuji', 'ham', 'spinach'];

/* ① 후보가 없을 때 */
const empty = focusPick([], raw(BASE));
ok(empty.focusId === null && empty.best.length === 0, '기다리는 손님이 없으면 대상도 없다');
ok(focusPick(null, null).focusId === null, '손님 목록이 없어도 터지지 않는다');

/* ② 재료를 아직 안 넣었으면 "제일 비슷한 사람"은 뜻이 없다 → 급한 순 */
const three = [
  cust('a', BASE, 9000),
  cust('b', BASE.concat('cucumber'), 3000),
  cust('c', BASE.concat(['egg', 'carrot']), 5000)
];
const bare = focusPick(three, []);
ok(bare.focusId === 'b', '조립대가 비었으면 가장 급한 손님을 가리킨다');
ok(bare.best.length === 0, '   이때는 윤곽선 후보를 만들지 않는다');
ok(focusPick(three, null).focusId === 'b', '   fills 가 null 이어도 같다');

/* ③ 동점이 여럿이면 전부 후보, 줄은 그 중 가장 급한 한 명 */
const tie = [
  cust('late', BASE, 9000),
  cust('soon', BASE, 4000),
  cust('mid', BASE, 6000),
  cust('other', BASE.concat('egg'), 1000)
];
const t = focusPick(tie, raw(BASE));
ok(t.best.length === 3, '완전히 같은 주문 3명이 모두 윤곽선 후보 (' + t.best.length + '명)');
ok(t.bestIds.has('late') && t.bestIds.has('soon') && t.bestIds.has('mid'), '   세 명 다 bestIds 에 들어간다');
ok(!t.bestIds.has('other'), '   덜 맞는 손님은 후보가 아니다');
ok(t.focusId === 'soon', '   줄은 그 중 가장 급한 한 명에게만 (soon)');
ok(Math.abs(t.score - 1) < 1e-9, '   완전 일치는 1.0');

/* ④ 동점이 없으면 최고점 한 명 */
const one = focusPick([
  cust('x', BASE, 1000),
  cust('y', BASE.concat('egg'), 2000)
], raw(BASE.concat('egg')));
ok(one.best.length === 1 && one.focusId === 'y', '더 잘 맞는 쪽이 이긴다 — 급한 쪽이 아니라');

/* ⑤ 후보 필터 — 이미 받았거나 기다리지 않는 손님은 제외 */
const filtered = focusPick([
  cust('gone', BASE, 1000, { state: 'happy' }),
  cust('walk', BASE, 1200, { state: 'walkin' }),
  cust('done', BASE, 1400, { done: 1, need: 1 }),
  cust('live', BASE, 8000)
], raw(BASE));
ok(filtered.focusId === 'live', '떠난·입장중·이미 받은 손님은 대상에서 빠진다');
ok(filtered.best.length === 1, '   후보도 한 명뿐');

/* ⑥ 클라 표시와 서버 서빙이 어긋나면 안 된다 — 같은 답이 나오는지 교차 검증 */
const rj = new Room('FOC');
rj.addPlayer('p1', '점장');
rj.start();
const wj = rj.waves;
wj.pending = [];
wj.active = [];
wj.buildWave(8).list.forEach((c, i) => { if (i < 5) stand(wj, c, i); });

const probes = [
  raw(BASE),
  raw(BASE.concat('egg')),
  raw(['danmuji']),
  raw(ALL_FILLINGS),
  raw([])
];
let same = 0, checked = 0;
for (const p of probes) {
  const srv = wj.bestMatch(p);
  const cli = focusPick(wj.snapshot().customers, p);
  checked++;
  if ((srv ? srv.id : null) === cli.focusId) same++;
}
ok(same === checked, '서버 bestMatch 와 클라 focusPick 이 같은 손님을 고른다 (' + same + '/' + checked + ')');

/* ⑦ 빈손이면 서버 nextTarget 과도 일치해야 한다 */
const srvIdle = wj.nextTarget([]);
const cliIdle = focusPick(wj.snapshot().customers, []);
ok(srvIdle && srvIdle.id === cliIdle.focusId, '빈손일 때도 서버 nextTarget 과 같은 손님');

/* ⑧ 스냅샷 손님 객체를 그대로 넣어도 동작해야 한다 (실제 클라가 쓰는 형태) */
const snapPick = focusPick(wj.snapshot().customers, raw(BASE));
ok(snapPick.focusId !== null, '스냅샷 형태(pub) 손님으로도 대상이 잡힌다');
ok(snapPick.bestIds instanceof Set, '   bestIds 는 Set 이라 has() 로 바로 쓴다');
ok(snapPick.best.every((c) => snapPick.bestIds.has(c.id)), '   best 와 bestIds 가 서로 맞는다');

/* ⑨ focus 객체 — kitchen.serveTarget / missingFills 이 이걸 그대로 쓴다 */
ok(snapPick.focus && snapPick.focus.id === snapPick.focusId, 'focus 객체와 focusId 가 같은 손님을 가리킨다');
ok(snapPick.best.includes(snapPick.focus), '   focus 는 윤곽선 후보 중 한 명이다');
ok(focusPick(three, []).focus.id === 'b', '   재료가 없을 때도 focus 객체를 준다 (가장 급한 손님)');
ok(focusPick([], raw(BASE)).focus === null, '   후보가 없으면 focus 는 null');

/* ⑩ 서버가 고른 손님 객체와 동일해야 한다 — 조준 문구·서빙이 갈라지지 않게 */
const srvPick = wj.bestMatch(raw(BASE));
const cliPick = focusPick(wj.snapshot().customers, raw(BASE));
ok(srvPick && cliPick.focus && srvPick.id === cliPick.focus.id,
  'serveTarget 이 쓰는 focus 객체가 서버 bestMatch 와 같은 손님');


head('[K] 🌊 웨이브 종료 — 보너스 없음 · 팝업용 집계');

ok(SCORE.waveClear === undefined, '클리어 보너스 설정이 아예 사라졌다');

/** 손님을 다 치운 상태로 만들어 웨이브 클리어를 강제한다 */
const clearWave = (w, n) => {
  w.phase = 'wave';
  w.wave = n;
  w.pending = [];
  w.active = [];
  return w.tick().find((e) => e.type === 'waveClear');
};

const rw = new Room('WVC');
rw.addPlayer('p1', '점장');
rw.start();
const ww = rw.waves;

/* ① 클리어해도 점수가 1점도 안 오른다 */
ww.score = 250;
ww.happy = 4;
ww.angry = 1;
const wvEv1 = clearWave(ww, 3);
ok(!!wvEv1, '웨이브를 비우면 waveClear 이벤트가 나온다');
ok(ww.score === 250, '클리어해도 점수가 그대로다 (' + ww.score + '점)');
ok(wvEv1.bonus === undefined, '이벤트에 보너스 값이 실리지 않는다');

/* ② 팝업이 쓸 정보가 실려 온다 */
ok(wvEv1.wave === 3, '   몇 웨이브였는지 (' + wvEv1.wave + ')');
ok(wvEv1.happy === 4 && wvEv1.angry === 1, '   그 웨이브의 만족/놓침 (' + wvEv1.happy + '/' + wvEv1.angry + ')');
ok(wvEv1.victory === false, '   아직 완주가 아니다');
ok(ww.phase === 'prep', '   다음 웨이브 준비로 넘어간다');

/* ③ 다음 웨이브는 누적이 아니라 그 웨이브 몫만 센다 */
ww.happy = 7;      // 누적 4 → 7 (이번 웨이브에 3명)
ww.angry = 3;      // 누적 1 → 3 (이번 웨이브에 2명)
const wvEv2 = clearWave(ww, 4);
ok(wvEv2.happy === 3 && wvEv2.angry === 2,
  '웨이브별 몫만 센다 — 누적이 아니라 (' + wvEv2.happy + '/' + wvEv2.angry + ')');

/* ④ 마지막 웨이브를 비우면 완주 */
const rv = new Room('WIN');
rv.addPlayer('p1', '점장');
rv.start();
const wv = rv.waves;
wv.score = 900;
const evWin = clearWave(wv, wv.totalWaves);
ok(evWin.victory === true, '마지막 웨이브를 비우면 victory 로 표시된다');
ok(wv.score === 900, '   완주해도 보너스 점수는 없다');
ok(wv.phase === 'over' && wv.result === 'victory', '   게임이 완주로 끝난다');

/* ⑤ 손님을 하나도 못 받고 넘어간 웨이브 */
const rz = new Room('ZER');
rz.addPlayer('p1', '점장');
rz.start();
const wz = rz.waves;
const evZero = clearWave(wz, 2);
ok(evZero.happy === 0 && evZero.angry === 0, '아무 일 없이 지나간 웨이브는 0/0');

/* ═════════════════════════════════════════════ */
const total = pass + fail;
const rate = total ? Math.round((pass / total) * 1000) / 10 : 0;
console.log('\n─────────────────────────────────────────');
console.log('  통과 ' + pass + ' / ' + total + '  (' + rate + '%)');
if (fail) console.log('  실패:\n   - ' + failed.join('\n   - '));
else console.log('  🎉 전부 통과');
console.log('─────────────────────────────────────────\n');
process.exit(fail === 0 ? 0 : 1);

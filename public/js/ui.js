/* ────────────────────────────────────────────────────────────
   DOM UI — 입장 · 대기실 · HUD(웨이브/손님/평판) · 결과 · 토스트
   ──────────────────────────────────────────────────────────── */
import {
  ITEMS, TIME, PACES, DEFAULT_PACE, REPUTATION_MAX, KIND
} from './config.js';
import { S, emit, on, myHand, isHost, serverNow, wave as waveOf } from './net.js';
import { focusNow, bapReady } from './kitchen.js';
import { state as P, releaseLock, resetPose } from './player.js';
import { currentZone, camera } from './world.js';

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ──────────────── 토스트 ──────────────── */
export function toast(msg, kind) {
  const area = $('#toast-area');
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  area.appendChild(el);
  while (area.children.length > 5) area.removeChild(area.firstChild);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* ──────────────── 화면 ──────────────── */
let curScreen = '';
export function showScreen(id) {
  const entered = curScreen !== id;
  curScreen = id;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  const playing = id === 'screen-game';
  $('#hud').classList.toggle('hidden', !playing);
  P.enabled = playing;
  if (!playing) releaseLock();
  // 판이 끝나고 돌아온 경우까지 포함해, 들어온 순간엔 무조건 새로 받는다
  if (entered && id === 'screen-lobby') loadLobbyBoard(true);
}

/** 서버 phase 에 따라 알맞은 화면으로 */
export function route() {
  if (!S.state) return showScreen('screen-join');
  if (S.state.phase === 'playing') return showScreen('screen-game');
  if (S.state.phase === 'result') { renderResult(); return showScreen('screen-result'); }
  renderLobby();
  showScreen('screen-lobby');
  loadLobbyBoard();
}

/* ──────────────── 도움말 ──────────────── */
function setHelp(open) {
  P.overlayOpen = open;
  $('#overlay-help').classList.toggle('hidden', !open);
  $('#overlay-bg').classList.toggle('hidden', !open);
  if (open) releaseLock();
}
export function toggleHelp() { setHelp($('#overlay-help').classList.contains('hidden')); }

/* ──────────────── 대기실 ──────────────── */
export function renderLobby() {
  const st = S.state;
  if (!st) return;
  $('#lobby-shop').textContent = '🍣 ' + (st.shop || st.code);
  $('#lobby-code').textContent = st.code;

  $('#player-list').innerHTML = st.players.map((p) =>
    '<li><span class="dot" style="background:' + esc(p.color) + '"></span>' +
    '<span class="' + (p.id === S.meId ? 'me' : '') + '">' + esc(p.name) + '</span>' +
    (p.id === st.hostId ? '<span class="tag">방장</span>' : '') + '</li>').join('');

  $$('#pace-seg button').forEach((b) => b.classList.toggle('on', b.dataset.pace === st.pace));
  const pace = PACES[st.pace] || PACES[DEFAULT_PACE];
  $('#pace-desc').textContent =
    '인내심 ×' + pace.patience + ' · 손님 간격 ×' + pace.gap +
    ' — 인원 ' + st.players.length + '명 기준으로 손님 수가 자동 조정됩니다.';

  $('#host-controls').classList.toggle('hidden', !isHost());
  $('#not-host-hint').classList.toggle('hidden', isHost());

  if (st.history && st.history.length) {
    $('#lobby-history').innerHTML = '<h3>지난 영업</h3>' + st.history.map((h) =>
      '<div class="row"><span>' + (h.kind === 'victory' ? '🎉 완주' : '💀 웨이브 ' + h.wave) +
      '</span><b>' + h.score + '점</b></div>').join('');
  } else {
    $('#lobby-history').innerHTML = '';
  }
}

/* ──────────────── HUD ────────────────
   매 프레임 호출되므로 변한 것만 DOM 에 반영한다.
   ──────────────────────────────────────────────────────────── */
const cache = {};
const els = {};
/** DOM 조회를 매 프레임 하지 않는다 */
const el = (sel) => els[sel] || (els[sel] = $(sel));

function setHTML(sel, key, html) {
  if (cache[key] === html) return false;
  cache[key] = html;
  el(sel).innerHTML = html;
  return true;
}

/* HUD 는 60Hz 로 다시 그릴 이유가 없다 — 약 15Hz 로 제한 */
let lastHud = 0;
const HUD_MS = 66;

export function renderHUD(force) {
  const w = waveOf();
  if (!w) return;
  const now = performance.now();
  if (!force && now - lastHud < HUD_MS) return;
  lastHud = now;
  const t = serverNow();

  /* 조준 문구 */
  const p = P.prompt;
  const promptEl = el('#prompt');
  const pHtml = !p ? '' : (p.disabled
    ? '<span class="msg">' + esc(p.text) + '</span>'
    : '<b class="key">' + (p.key || 'E') + '</b><span class="msg">' + esc(p.text) + '</span>');
  if (setHTML('#prompt', 'prompt', pHtml)) {
    promptEl.className = !p ? 'hidden' : (p.disabled ? 'off' : (p.danger ? 'danger' : ''));
  }

  /* 손 */
  const h = myHand();
  const def = h ? ITEMS[h.id] : null;
  const handHtml = h
    ? '<span class="emoji">' + (def.emoji || '📦') + '</span>' +
      '<span class="nm">' + esc((def.label && def.label[h.stage]) || def.name) + '</span>' +
      (h.stage === 'burnt' ? '<span class="q bad">못 씀</span>'
        : (h.id !== 'broom' && h.quality < 100 ? '<span class="q">품질 ' + h.quality + '</span>' : ''))
    : '<span class="nm empty">빈손</span>';
  if (setHTML('#hand', 'hand', handHtml)) {
    const handEl = el('#hand');
    handEl.classList.toggle('has', !!h);
    handEl.classList.toggle('spoiled', !!h && h.stage === 'burnt');
  }

  /* 구역 */
  const zone = currentZone(camera.position.x, camera.position.z);
  if (cache.zone !== zone.id) {
    cache.zone = zone.id;
    el('#location-name').textContent = zone.name;
    el('#location-help').textContent = zone.help;
    el('#location').className = 'location ' + zone.id;
  }

  /* 웨이브 · 타이머 */
  const prepping = w.phase === 'prep';
  setHTML('#wave-chip', 'wave', prepping
    ? '준비 중 → 웨이브 ' + Math.min(w.wave + 1, w.totalWaves)
    : '🌊 웨이브 ' + w.wave + ' / ' + w.totalWaves);
  el('#wave-chip').classList.toggle('prep', prepping);

  const left = prepping ? (w.phaseEndsAt - t) / 1000 : 0;
  if (setHTML('#timer', 'timer', prepping ? fmt(left) : (w.customers.length + w.waiting) + '명 남음')) {
    el('#timer').classList.toggle('urgent', prepping && left < 6);
  }

  /* 평판 · 점수 */
  const rep = w.reputation;
  if (cache.rep !== rep) {
    cache.rep = rep;
    const bar = el('#rep-bar');
    bar.style.width = (rep / REPUTATION_MAX * 100) + '%';
    bar.classList.toggle('low', rep < 40);
    el('#rep-num').textContent = rep;
  }
  setHTML('#score', 'score', '<b>' + w.score + '</b> 점');
  setHTML('#stat-rolls', 'rolls', '🍣 ' + w.servedRolls + '줄 · ⭐ ' + w.avgQuality +
    ' · 😋 ' + w.happy + ' · 😡 ' + w.angry);

  /* 📋 주문서 — 재료는 이름으로.
     줄은 "지금 만드는(또는 들고 있는) 김밥에 가장 잘 맞고 가장 급한" 한 명에게만 긋는다. */
  const aimed = P.target && P.target.userData && P.target.userData.station;
  const aimedId = aimed && aimed.kind === 'customer' ? aimed.id : null;
  const f = focusNow();
  const have = new Set(f.fills.map((x) => x.id));

  const rows = w.customers
    .filter((c) => c.state === 'wait' || c.state === 'walkin')
    .sort((a, b) => a.deadline - b.deadline)
    .map((c) => {
      const secs = Math.max(0, (c.deadline - t) / 1000);
      const pct = c.state === 'walkin' ? 100 : Math.max(0, Math.min(100, secs / c.patienceMax * 100));
      const cls = pct > 50 ? '' : pct > 25 ? 'warn' : 'bad';
      const counter = c.kind === KIND.COUNTER;
      // 🧹 남은 체력 — 빗자루로 이만큼 더 때리면 쫓겨난다
      const hp = c.hpMax
        ? '<span class="hp">' +
            '♥'.repeat(c.hp) +
            '<b>' + '♥'.repeat(Math.max(0, c.hpMax - c.hp)) + '</b></span>'
        : '';
      const isFocus = c.id === f.focusId;
      // 줄은 이 한 명에게만 — 다른 손님 행은 재료 이름 그대로 둔다
      const items = c.fills.map((id) =>
        '<span class="' + (isFocus && have.has(id) ? 'got' : '') + '">' +
        esc(ITEMS[id].name) + '</span>').join('');
      const mark = isFocus ? ' focus' : (f.outline.has(c.id) ? ' match' : '');
      return '<li class="' + (counter ? 'counter' : 'kiosk') + mark +
        (aimedId === c.id ? ' aimed' : '') + '">' +
        '<div class="top">' +
          '<span class="who">' + esc(c.emoji + ' ' + c.name) + '</span>' +
          (isFocus ? '<span class="pin">◀ 다음</span>' : '') +
          hp +
          '<span class="secs">' + (c.state === 'walkin' ? '입장' : Math.ceil(secs) + 's') + '</span>' +
        '</div>' +
        '<div class="items">' + items + '</div>' +
        '<i class="bar"><em class="' + cls + '" style="width:' + pct.toFixed(0) + '%"></em></i>' +
        '</li>';
    }).join('');

  setHTML('#queue', 'queue',
    '<h4>📋 주문서' + (w.waiting ? ' <em>+' + w.waiting + '명 대기</em>' : '') + '</h4>' +
    '<ul>' + (rows || '<li class="none">' +
      (prepping ? '준비 시간 — 밥부터 안치세요' : '손님이 오는 중...') + '</li>') + '</ul>' +
    '<p class="tip">손님을 조준하고 <b>E</b> 로 서빙 · 🧹 들고 <b>좌클릭</b>이면 쫓아내기</p>');

  /* 우측 — 밥 상태와 다음 해금 */
  const b = bapReady();
  const bap = b.servings
    ? '🍚 밥 <b>' + b.servings + '인분</b> 준비됨' + (b.cooking ? ' · 취사 중 ' + b.cooking : '')
    : (b.cooking ? '🍚 취사 중... (' + b.cooking + '대)' : '<b class="warn">🍚 밥솥이 비었습니다</b>');
  const nu = w.nextUnlock;
  setHTML('#say', 'say',
    bap + (nu ? '<br />🔓 웨이브 ' + nu.wave + ' 에 <b>' + esc(nu.name) + '</b> 해금' : ''));

  /* 🍣 잘라놓은 김밥을 들고 있으면 무엇이 들었는지 우측에 펼쳐준다 */
  const held = myHand();
  const fills = held && held.id === 'gimbap' ? (held.fills || []) : null;
  const roll = !fills ? '' :
    '<h4>🍣 내 김밥</h4><div class="fills">' +
    (fills.length
      ? fills.map((x) => {
          const q = x.quality == null ? 100 : x.quality;
          return '<span class="' + (q >= 90 ? '' : q >= 60 ? 'mid' : 'bad') + '">' +
            esc(ITEMS[x.id].name) + '</span>';
        }).join('')
      : '<span class="none">속재료 없이 말았습니다</span>') +
    '</div><p class="hint">' +
    (f.outline.size
      ? '테두리 친 손님 <b>' + f.outline.size + '명</b>에게 맞습니다'
      : (f.focusId ? '속재료가 없어 대상을 못 고릅니다' : '기다리는 주문이 없습니다')) +
    '</p>';
  if (setHTML('#roll', 'roll', roll)) el('#roll').classList.toggle('hidden', !roll);
}

/* ────────────────────────────────────────────────────────────
   🌊 웨이브 종료 팝업 — 화면 중앙 상단에 크게 한 번 띄웠다 사라진다.
   토스트는 우르르 쌓여서 놓치기 쉬워 웨이브가 끝난 건 따로 알린다.
   ──────────────────────────────────────────────────────────── */
export function wavePop(d) {
  const box = el('#wave-pop');
  if (!box || !d) return;
  const done = !!d.victory;
  const happy = d.happy || 0;
  const angry = d.angry || 0;

  const tally = happy || angry
    ? (happy ? '😊 만족 <em>' + happy + '</em>' : '') +
      (happy && angry ? ' · ' : '') +
      (angry ? '😡 놓침 <i>' + angry + '</i>' : '')
    : '손님이 모두 지나갔습니다';

  box.className = 'wave-pop' + (done ? ' final' : '');
  box.innerHTML =
    '<b>' + (done ? '🎉 ' + d.wave + '웨이브 완주!' : '✅ 웨이브 ' + d.wave + ' 클리어') + '</b>' +
    '<span>' + tally + (done ? '' : ' · 곧 웨이브 ' + (d.wave + 1)) + '</span>';

  void box.offsetWidth;          // 연속으로 와도 애니메이션이 다시 돌게
  box.classList.add('show');
}

/* ──────────────── 🏆 가게 랭킹 ──────────────── */
const medal = (n) => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : n + '위');

/* 대기실 좌측 랭킹 — 가게 이름은 서버가 이미 첫 글자만 남겨서 준다 */
let boardAt = 0;

export async function loadLobbyBoard(force) {
  const now = Date.now();
  if (!force && now - boardAt < 30000) return;   // 앉아 있는 동안엔 30초마다만
  boardAt = now;
  const list = $('#lobby-board-list');
  if (!list) return;
  try {
    const rows = await (await fetch('/leaderboard.json', { cache: 'no-store' })).json();
    list.innerHTML = rows.length
      ? rows.slice(0, 10).map((r, i) =>
          '<li><span class="pos">' + medal(i + 1) + '</span>' +
          '<span class="shop">' + esc(r.shop) + '</span>' +
          '<b class="pts">' + r.score + '</b></li>').join('')
      : '<li class="none">아직 기록이 없습니다.</li>';
  } catch {
    boardAt = 0;                                 // 실패했으면 다음 기회에 다시
    list.innerHTML = '<li class="none">랭킹을 불러오지 못했습니다.</li>';
  }
}

function boardRow(row, n, mine) {
  const when = row.at ? new Date(row.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
  return '<li class="' + (mine ? 'mine' : '') + '">' +
    '<span class="pos">' + medal(n) + '</span>' +
    '<span class="shop">' + esc(row.shop) + (mine ? ' <em>← 이번 판</em>' : '') + '</span>' +
    '<span class="meta">' + (row.kind === 'victory' ? '🎉 완주' : 'W' + row.wave) +
      ' · 🍣' + row.rolls + ' · ⭐' + row.avgQuality + '</span>' +
    '<span class="when">' + esc(when) + '</span>' +
    '<b class="pts">' + row.score + '</b></li>';
}

function renderBoard(r) {
  const b = r.board;
  const line = $('#r-rank-line');
  const list = $('#r-board');
  if (!b || !b.top || !b.top.length) {
    line.textContent = '';
    list.innerHTML = '<li class="none">아직 기록이 없습니다.</li>';
    return;
  }
  line.innerHTML = r.rank
    ? '<b>' + esc(r.shop) + '</b> — 역대 <b>' + b.total + '개</b> 가게 중 <b class="hl">' + r.rank + '위</b>' +
      (r.rank === 1 ? ' 🏆 신기록!' : '')
    : esc(r.shop);

  let html = b.top.map((row, i) => boardRow(row, i + 1, row.id === r.entryId)).join('');
  // 이번 판이 10위 밖이면 아래에 따로 붙여준다
  if (b.outside) html += '<li class="gap">⋯</li>' + boardRow(b.outside, b.myRank, true);
  list.innerHTML = html;
}

/* ──────────────── 결과 ──────────────── */
export function renderResult() {
  const r = S.state && S.state.result;
  if (!r) return;
  const win = r.kind === 'victory';

  $('#r-title').textContent = win ? '🎉 10웨이브 완주!' : '💀 폐업...';
  $('#r-title').className = win ? 'win' : 'lose';
  $('#r-sub').textContent = win
    ? '손님을 모두 받아냈습니다. 대단한 김밥집이네요.'
    : '웨이브 ' + r.wave + ' 에서 평판이 바닥났습니다.';
  $('#r-total').textContent = r.score;

  const rows = [
    ['🌊 도달 웨이브', r.wave + ' / ' + r.totalWaves],
    ['🍣 만든 김밥', r.servedRolls + ' 줄'],
    ['⭐ 평균 품질', r.avgQuality + ' 점'],
    ['😋 만족하고 간 손님', r.happy + ' 명'],
    ['😡 그냥 나간 손님', r.angry + ' 명'],
    ['🏪 남은 평판', r.reputation + ' / ' + r.reputationMax],
    ['🧼 바닥에 버린 재료', r.mess + ' 개 (−' + r.messPenalty + '점)']
  ];
  $('#r-rows').innerHTML = rows
    .map(([k, v]) => '<div class="row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('');

  $('#r-players').innerHTML = r.players.map((p) =>
    '<span class="chip-p" style="border-color:' + esc(p.color) + '">' + esc(p.name) + '</span>').join('');

  /* 🏆 가게 랭킹 — 점수 순 */
  renderBoard(r);

  const tips = [];
  if (r.angry) tips.push('손님이 나가면 <b>평판 −12</b>. 김밥을 들면 조합이 맞는 손님에게 <b>테두리</b>가 생기고, 좌측 주문서에서는 그중 <b>가장 급한 한 명</b>에게만 줄이 그어집니다.');
  if (r.avgQuality < 80) tips.push('속재료 <b>3종</b>을 다 넣고 <b>5초</b>에 맞춰 꺼내야 품질 100 이 나옵니다.');
  if (r.mess) tips.push('못 쓰는 재료는 <b>Q</b> 말고 <b>음쓰통</b>에 버리세요.');
  tips.push('준비 시간에 <b>밥 5인분</b>을 미리 지어두고 속재료를 쌓아두면 웨이브를 훨씬 수월하게 넘깁니다.');
  $('#r-tips').innerHTML = tips.map((x) => '<li>' + x + '</li>').join('');

  $('#r-host').classList.toggle('hidden', !isHost());
  $('#r-guest').classList.toggle('hidden', isHost());
}

/* ──────────────── 초기화 ──────────────── */
export function initUI() {
  /* 난이도 버튼 */
  $('#pace-seg').innerHTML = Object.entries(PACES).map(([k, v]) =>
    '<button data-pace="' + k + '"' + (k === DEFAULT_PACE ? ' class="on"' : '') + '>' + v.name + '</button>').join('');
  $$('#pace-seg button').forEach((b) => {
    b.addEventListener('click', () => {
      if (!isHost()) return;
      emit('room:pace', { pace: b.dataset.pace });
    });
  });

  /* 입장 */
  const nameOf = () => $('#input-name').value.trim();
  const shopOf = () => $('#input-shop').value.trim();

  /* 서버도 같은 규칙으로 막는다 (room.mjs nameError) — 여기선 먼저 알려줄 뿐 */
  const nameOk = () => {
    if (nameOf().length >= 2) return true;
    $('#join-err').textContent = '이름은 2글자 이상이어야 합니다.';
    $('#input-name').focus();
    return false;
  };
  $('#input-shop').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-create').click(); });

  /* 가게 이름을 비워두면 "○○의 가게" 가 된다 — 미리 보여준다 */
  const syncShopHint = () => {
    const n = nameOf();
    $('#input-shop').placeholder = n ? n + '의 가게' : '비워두면 「이름」의 가게';
  };
  $('#input-name').addEventListener('input', syncShopHint);
  $('#input-name').addEventListener('input', () => { $('#join-err').textContent = ''; });
  syncShopHint();
  $('#btn-create').addEventListener('click', () => {
    if (!nameOk()) return;
    emit('room:create', { name: nameOf(), shop: shopOf() }, (res) => {
      if (!res || !res.ok) return ($('#join-err').textContent = (res && res.err) || '실패');
      S.meId = res.youId;
      location.hash = res.code;
    });
  });
  $('#btn-join').addEventListener('click', () => {
    if (!nameOk()) return;
    const code = $('#input-code').value.trim().toUpperCase();
    if (code.length !== 4) return ($('#join-err').textContent = '방 코드 4글자를 입력하세요.');
    emit('room:join', { code, name: nameOf() }, (res) => {
      if (!res || !res.ok) return ($('#join-err').textContent = (res && res.err) || '실패');
      S.meId = res.youId;
      location.hash = res.code;
    });
  });
  $('#input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
  if (location.hash.length === 5) $('#input-code').value = location.hash.slice(1).toUpperCase();

  $('#btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/#' + S.state.code);
      toast('초대 링크를 복사했습니다.', 'good');
    } catch { toast('복사에 실패했습니다.', 'bad'); }
  });

  /* 시작 / 대기실로 */
  $('#btn-start').addEventListener('click', () => emit('game:start'));
  $('#btn-to-lobby').addEventListener('click', () => emit('game:lobby'));
  $('#btn-help-close').addEventListener('click', () => setHelp(false));
  $('#overlay-bg').addEventListener('click', () => setHelp(false));

  P.onToggleHelp = toggleHelp;
  P.onCloseOverlay = () => {
    if (!$('#overlay-help').classList.contains('hidden')) setHelp(false);
    else releaseLock();
  };


  /* 공정 시간 반영 */
  $$('[data-time]').forEach((el) => {
    const k = el.dataset.time;
    if (TIME[k] !== undefined) el.textContent = TIME[k];
  });

  /* 상태 변화 → 화면 전환 */
  on('state', () => {
    if (S.state.phase === 'lobby') renderLobby();
    route();
  });
  on('phase', (ph) => {
    Object.keys(cache).forEach((k) => delete cache[k]);
    if (ph === 'playing') {
      const me = S.positions.find((p) => p.id === S.meId);
      resetPose(me || { x: 0, z: 6.2 });
    }
  });
  on('toast', (d) => toast(d.msg, d.kind));
}

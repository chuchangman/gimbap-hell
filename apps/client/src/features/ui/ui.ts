/* ────────────────────────────────────────────────────────────
   DOM UI — 입장 · 대기실 · 결과 · 토스트 · 화면 전환.

   HUD 는 React 가 그린다(`features/ui/Hud.tsx`). 여기 남은 것은 아직
   명령형인 화면들과, 입장 폼·소켓 이벤트 배선이다.
   ──────────────────────────────────────────────────────────── */
import {
  currentLook,
  initCustomizer,
  resumeCustomizer,
  stopCustomizer,
} from '@/features/customize/customize';
import { emit, isHost, on, S } from '@/features/net/net';
import { state as P, releaseLock, resetPose } from '@/features/player/player';
import {
  NAME_MAX,
  NAME_MIN,
  PLAYER_LIMIT,
  ROOM_CODE_LENGTH,
  SHOP_MAX,
  TIME,
} from '@repo/game-core';
import type { LeaderboardRow, ResultView } from '@repo/types';

const $ = <T extends Element = HTMLElement>(s: string, r?: ParentNode): T | null =>
  (r || document).querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r?: ParentNode): T[] =>
  Array.from((r || document).querySelectorAll<T>(s));

/** 뼈대(`Shell`)가 반드시 그리는 자리. 없으면 화면이 깨진 것이라 바로 알려야 한다 */
const req = <T extends HTMLElement = HTMLElement>(s: string): T => {
  const found = $<T>(s);
  if (!found) throw new Error('화면 뼈대에 ' + s + ' 가 없다');
  return found;
};

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/* ──────────────── 토스트 ──────────────── */
export function toast(msg: string, kind?: string): void {
  const area = req('#toast-area');
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  area.appendChild(el);
  while (area.children.length > 5) area.removeChild(area.firstChild!);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

/* ──────────────── 화면 ──────────────── */
let curScreen = '';
export function showScreen(id: string): void {
  const entered = curScreen !== id;
  curScreen = id;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  const playing = id === 'screen-game';
  P.enabled = playing && S.connection === 'connected';
  if (!playing) releaseLock();
  // 판이 끝나고 돌아온 경우까지 포함해, 들어온 순간엔 무조건 새로 받는다
  if (entered && id === 'screen-lobby') void loadLobbyBoard(true);
  /* 입장 화면을 떠나면 미리보기 WebGL 문맥을 놓아준다 — 게임과 두 개를 동시에
     붙들고 있을 이유가 없다. 세션이 만료돼 돌아오면 다시 켠다. */
  if (entered) {
    if (id === 'screen-join') resumeCustomizer();
    else stopCustomizer();
  }
}

/** 서버 phase 에 따라 알맞은 화면으로 */
export function route(): void {
  if (!S.state) return showScreen('screen-join');
  if (S.state.phase === 'playing') return showScreen('screen-game');
  if (S.state.phase === 'result') {
    renderResult();
    return showScreen('screen-result');
  }
  renderLobby();
  showScreen('screen-lobby');
  void loadLobbyBoard();
}

let pauseShown = false;
/** 일시정지가 시작되는 순간 마우스 잠금을 놓아준다. 화면은 React 가 그린다 */
function releaseLockOnPause(): void {
  const paused = !!(S.state && S.state.phase === 'playing' && S.state.paused);
  if (paused && !pauseShown) releaseLock();
  pauseShown = paused;
}

/* ──────────────── 도움말 ──────────────── */
function setHelp(open: boolean): void {
  P.overlayOpen = open;
  req('#overlay-help').classList.toggle('hidden', !open);
  req('#overlay-bg').classList.toggle('hidden', !open);
  if (open) releaseLock();
}
export function toggleHelp(): void {
  setHelp(req('#overlay-help').classList.contains('hidden'));
}

/* ──────────────── 대기실 ──────────────── */
export function renderLobby(): void {
  const st = S.state;
  if (!st) return;
  req('#lobby-shop').textContent = '🍣 ' + (st.shop || st.code);
  req('#lobby-code').textContent = st.code;

  req('#player-list').innerHTML = st.players
    .map(
      (p) =>
        '<li><span class="dot" style="background:' +
        esc(p.color) +
        '"></span>' +
        '<span class="' +
        (p.id === S.meId ? 'me' : '') +
        '">' +
        esc(p.name) +
        '</span>' +
        (p.id === st.hostId ? '<span class="tag">방장</span>' : '') +
        (p.connected === false ? '<span class="tag">연결 복구 중</span>' : '') +
        '</li>',
    )
    .join('');
  req('#party-desc').textContent =
    '인원 ' + st.players.length + '명 기준으로 손님 수가 자동 조정됩니다.';

  req('#host-controls').classList.toggle('hidden', !isHost());
  req('#not-host-hint').classList.toggle('hidden', isHost());

  if (st.history && st.history.length) {
    req('#lobby-history').innerHTML =
      '<h3>지난 영업</h3>' +
      st.history
        .map(
          (h) =>
            '<div class="row"><span>' +
            (h.kind === 'victory' ? '🎉 완주' : '💀 웨이브 ' + h.wave) +
            '</span><b>' +
            h.score +
            '점</b></div>',
        )
        .join('');
  } else {
    req('#lobby-history').innerHTML = '';
  }
}

/* ──────────────── 🏆 가게 랭킹 ──────────────── */
const medal = (n: number): string => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : n + '위');

/* 대기실 좌측 랭킹 — 가게 이름은 서버가 이미 첫 글자만 남겨서 준다 */
let boardAt = 0;

export async function loadLobbyBoard(force?: boolean): Promise<void> {
  const now = Date.now();
  if (!force && now - boardAt < 30000) return; // 앉아 있는 동안엔 30초마다만
  boardAt = now;
  const list = $('#lobby-board-list');
  if (!list) return;
  try {
    const rows = (await (
      await fetch('/leaderboard.json', { cache: 'no-store' })
    ).json()) as LeaderboardRow[];
    list.innerHTML = rows.length
      ? rows
          .slice(0, 10)
          .map(
            (r, i) =>
              '<li><span class="pos">' +
              medal(i + 1) +
              '</span>' +
              '<span class="shop">' +
              esc(r.shop) +
              '</span>' +
              '<b class="pts">' +
              r.score +
              '</b></li>',
          )
          .join('')
      : '<li class="none">아직 기록이 없습니다.</li>';
  } catch {
    boardAt = 0; // 실패했으면 다음 기회에 다시
    list.innerHTML = '<li class="none">랭킹을 불러오지 못했습니다.</li>';
  }
}

function boardRow(row: LeaderboardRow, n: number, mine: boolean): string {
  const when = row.at
    ? new Date(row.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
    : '';
  return (
    '<li class="' +
    (mine ? 'mine' : '') +
    '">' +
    '<span class="pos">' +
    medal(n) +
    '</span>' +
    '<span class="shop">' +
    esc(row.shop) +
    (mine ? ' <em>← 이번 판</em>' : '') +
    '</span>' +
    '<span class="meta">' +
    (row.kind === 'victory' ? '🎉 완주' : 'W' + row.wave) +
    ' · 🍣' +
    row.rolls +
    ' · ⭐' +
    row.avgQuality +
    '</span>' +
    '<span class="when">' +
    esc(when) +
    '</span>' +
    '<b class="pts">' +
    row.score +
    '</b></li>'
  );
}

function renderBoard(r: ResultView): void {
  const storage = r.storage;
  req('#r-storage-status').textContent = !storage
    ? ''
    : storage.error
      ? '랭킹 저장을 재시도하고 있습니다. 현재 순위는 임시이며 아직 저장 완료되지 않았습니다.'
      : storage.pending
        ? '랭킹을 저장하고 있습니다. 현재 순위는 임시입니다.'
        : '랭킹 저장 완료';
  const b = r.board;
  const line = req('#r-rank-line');
  const list = req('#r-board');
  if (!b || !b.top || !b.top.length) {
    line.textContent = '';
    list.innerHTML = '<li class="none">아직 기록이 없습니다.</li>';
    return;
  }
  line.innerHTML = r.rank
    ? '<b>' +
      esc(r.shop) +
      '</b> — 역대 <b>' +
      b.total +
      '개</b> 가게 중 <b class="hl">' +
      r.rank +
      '위</b>' +
      (r.rank === 1 ? ' 🏆 신기록!' : '')
    : esc(r.shop);
  let html = b.top.map((row, i) => boardRow(row, i + 1, row.id === r.entryId)).join('');
  // 이번 판이 10위 밖이면 아래에 따로 붙여준다
  if (b.outside) html += '<li class="gap">⋯</li>' + boardRow(b.outside, b.myRank!, true);
  list.innerHTML = html;
}

/* ──────────────── 결과 ──────────────── */
export function renderResult(): void {
  const r = S.state && S.state.result;
  if (!r) return;
  const win = r.kind === 'victory';

  req('#r-title').textContent = win ? '🎉 10웨이브 완주!' : '💀 폐업...';
  req('#r-title').className = win ? 'win' : 'lose';
  req('#r-sub').textContent = win
    ? '손님을 모두 받아냈습니다. 대단한 김밥집이네요.'
    : '웨이브 ' + r.wave + ' 에서 평판이 바닥났습니다.';
  req('#r-total').textContent = String(r.score);

  const rows: [string, string][] = [
    ['🌊 도달 웨이브', r.wave + ' / ' + r.totalWaves],
    ['🍣 만든 김밥', r.servedRolls + ' 줄'],
    ['⭐ 평균 품질', r.avgQuality + ' 점'],
    ['😋 만족하고 간 손님', r.happy + ' 명'],
    ['😡 그냥 나간 손님', r.angry + ' 명'],
    ['🏪 남은 평판', r.reputation + ' / ' + r.reputationMax],
    ['🧼 바닥에 버린 재료', r.mess + ' 개 (−' + r.messPenalty + '점)'],
  ];
  req('#r-rows').innerHTML = rows
    .map(([k, v]) => '<div class="row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>')
    .join('');

  req('#r-players').innerHTML = r.players
    .map(
      (p) =>
        '<span class="chip-p" style="border-color:' + esc(p.color) + '">' + esc(p.name) + '</span>',
    )
    .join('');

  /* 🏆 가게 랭킹 — 점수 순 */
  renderBoard(r);

  const tips: string[] = [];
  if (r.angry)
    tips.push(
      '손님이 나가면 <b>평판 −12</b>. 김밥을 들면 조합이 맞는 손님에게 <b>테두리</b>가 생기고, 좌측 주문서에서는 그중 <b>가장 급한 한 명</b>에게만 줄이 그어집니다.',
    );
  if (r.avgQuality < 80)
    tips.push('속재료 <b>3종</b>을 다 넣고 <b>5초</b>에 맞춰 꺼내야 품질 100 이 나옵니다.');
  if (r.mess) tips.push('못 쓰는 재료는 <b>Q</b> 말고 <b>음쓰통</b>에 버리세요.');
  tips.push(
    '준비 시간에 <b>밥 5인분</b>을 미리 지어두고 속재료를 쌓아두면 웨이브를 훨씬 수월하게 넘깁니다.',
  );
  req('#r-tips').innerHTML = tips.map((x) => '<li>' + x + '</li>').join('');

  req('#r-host').classList.toggle('hidden', !isHost());
  req('#r-guest').classList.toggle('hidden', isHost());
}

/* ──────────────── 초기화 ──────────────── */
export function initUI(): void {
  /* 입장 */
  const nameInput = req<HTMLInputElement>('#input-name');
  const shopInput = req<HTMLInputElement>('#input-shop');
  const codeInput = req<HTMLInputElement>('#input-code');
  const btnCreate = req<HTMLButtonElement>('#btn-create');
  const btnJoin = req<HTMLButtonElement>('#btn-join');

  nameInput.minLength = NAME_MIN;
  nameInput.maxLength = NAME_MAX;
  req('#name-limits').textContent = `(${NAME_MIN}~${NAME_MAX}글자)`;
  shopInput.maxLength = SHOP_MAX;
  codeInput.maxLength = ROOM_CODE_LENGTH;
  req('#player-limit-hint').textContent =
    `최대 ${PLAYER_LIMIT}명 · 같은 Wi-Fi 면 주소만 공유하면 됩니다.`;
  const nameOf = (): string => nameInput.value.trim();
  const shopOf = (): string => shopInput.value.trim();
  let joining = false;
  function joinRequest(event: string, data: Record<string, unknown>): void {
    if (joining) return;
    joining = true;
    btnCreate.disabled = btnJoin.disabled = true;
    req('#join-err').textContent = '가게에 연결하고 있습니다…';
    emit(event, data, (res) => {
      joining = false;
      btnCreate.disabled = btnJoin.disabled = S.connection !== 'connected';
      if (!res?.ok) {
        req('#join-err').textContent = res?.err || '입장하지 못했습니다.';
        return;
      }
      req('#join-err').textContent = '';
      S.meId = res.youId as string;
      location.hash = res.code as string;
    });
  }

  /* 서버도 같은 규칙으로 막는다 (room.mjs nameError) — 여기선 먼저 알려줄 뿐 */
  const nameOk = (): boolean => {
    if (nameOf().length >= NAME_MIN) return true;
    req('#join-err').textContent = `이름은 ${NAME_MIN}글자 이상이어야 합니다.`;
    nameInput.focus();
    return false;
  };
  shopInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnCreate.click();
  });

  /* 가게 이름을 비워두면 "○○의 가게" 가 된다 — 미리 보여준다 */
  const syncShopHint = (): void => {
    const n = nameOf();
    shopInput.placeholder = n ? n + '의 가게' : '비워두면 「이름」의 가게';
  };
  nameInput.addEventListener('input', syncShopHint);
  nameInput.addEventListener('input', () => {
    req('#join-err').textContent = '';
  });
  syncShopHint();
  btnCreate.addEventListener('click', () => {
    if (!nameOk()) return;
    joinRequest('room:create', { name: nameOf(), shop: shopOf(), look: currentLook() });
  });
  btnJoin.addEventListener('click', () => {
    if (!nameOk()) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH) {
      req('#join-err').textContent = `방 코드 ${ROOM_CODE_LENGTH}글자를 입력하세요.`;
      return;
    }
    joinRequest('room:join', { code, name: nameOf(), look: currentLook() });
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });
  if (location.hash.length === ROOM_CODE_LENGTH + 1)
    codeInput.value = location.hash.slice(1).toUpperCase();

  req('#btn-copy').addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(location.origin + '/#' + S.state!.code);
        toast('초대 링크를 복사했습니다.', 'good');
      } catch {
        toast('복사에 실패했습니다.', 'bad');
      }
    })();
  });

  /* 시작 / 대기실로 */
  req('#btn-start').addEventListener('click', () => emit('game:start'));
  req('#btn-to-lobby').addEventListener('click', () => emit('game:lobby'));
  req('#btn-help-close').addEventListener('click', () => setHelp(false));
  req('#overlay-bg').addEventListener('click', () => setHelp(false));

  P.onToggleHelp = toggleHelp;
  P.onCloseOverlay = () => {
    if (!req('#overlay-help').classList.contains('hidden')) setHelp(false);
    else releaseLock();
  };

  /* 공정 시간 반영 */
  $$('[data-time]').forEach((node) => {
    const k = node.dataset.time as keyof typeof TIME | undefined;
    if (k && TIME[k] !== undefined) node.textContent = String(TIME[k]);
  });

  /* 상태 변화 → 화면 전환 */
  on('state', () => {
    if (S.restorePose) {
      resetPose(S.restorePose);
      S.restorePose = null;
    }
    if (S.state!.phase === 'lobby') renderLobby();
    route();
    releaseLockOnPause();
  });
  on('phase', (ph) => {
    if (ph === 'playing') {
      const me = S.state?.players.find((p) => p.id === S.meId);
      resetPose(me?.spawn || S.positions.find((p) => p.id === S.meId) || { x: 0, z: 6.2 });
    }
  });
  on('toast', (d) => toast(d.msg, d.kind));
  const renderConnection = (): void => {
    const connected = S.connection === 'connected';
    req('#connection-status').classList.toggle('hidden', connected);
    req('#connection-status-text').textContent = S.state
      ? '연결을 복구하고 있습니다. 잠시만 기다려 주세요. (' +
        Math.round(S.recoveryMs / 1000) +
        '초 이내 자동 복귀)'
      : '서버에 연결하고 있습니다. 연결이 되면 입장할 수 있습니다.';
    btnCreate.disabled = btnJoin.disabled = !connected || joining;
    if (!connected) {
      P.enabled = false;
      releaseLock();
    } else {
      route();
      releaseLockOnPause();
    }
  };
  on('connection', renderConnection);
  req('#connection-retry').addEventListener('click', () => {
    S.socket?.connect();
  });
  renderConnection();

  // 입장 화면의 캐릭터 꾸미기 — 미리보기 캔버스와 파츠 버튼을 켠다
  initCustomizer();
}

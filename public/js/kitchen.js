/* ────────────────────────────────────────────────────────────
   클라이언트 쪽 주방 읽기 — 상태는 서버가 갖고 있다.
   여기서는 서버 스냅샷(S.kitchen)을 보고
     · 지금 조준한 곳에서 뭘 할 수 있는지 문구를 만들고
     · 3D 가 그릴 진행도를 계산한다
   실제 판정은 서버(server/kitchen.mjs)가 다시 한다.
   ──────────────────────────────────────────────────────────── */
import {
  TIME, ITEMS, BURNERS, itemLabel, cookStatus, matchScore, focusPick
} from './config.js';
import { S, act, emit, myHand, serverNow, isPlaying } from './net.js';

const sec = (at) => (serverNow() - at) / 1000;
const K = () => S.kitchen;

/* ──────────────── 진행도 조회 (world.js 용) ──────────────── */
export function sinkAt() { return K() ? K().sink : null; }

export function cookerAt(i) {
  const k = K();
  return (k && k.cookers && k.cookers[i]) || null;
}

export function cookerProgress(i) {
  const c = cookerAt(i);
  if (!c) return 0;
  if (c.state === 'ready') return 1;
  if (c.state !== 'cooking') return 0;
  return Math.min(1, sec(c.at) / TIME.riceCook);
}

/** 밥솥 전체에 남은 밥 (HUD 용) */
export function bapReady() {
  const k = K();
  if (!k || !k.cookers) return { servings: 0, cooking: 0 };
  let servings = 0, cooking = 0;
  for (const c of k.cookers) {
    if (c.state === 'ready') servings += c.servings;
    if (c.state === 'cooking') cooking++;
  }
  return { servings, cooking };
}

export function burnerInfo(slot) {
  const k = K();
  const cell = k && k.burners[slot];
  if (!cell) return null;
  const def = ITEMS[cell.id];
  const el = sec(cell.at);
  const st = cookStatus(def, el);
  return { cell, def, el, label: st.label, color: st.color, q: st.q, burnt: el >= def.burn };
}

export function boardInfo(i) {
  const k = K();
  const b = k && k.boards[i];
  if (!b) return null;
  const el = sec(b.at);
  return { b, el, pct: Math.min(1, el / b.dur), done: el >= b.dur };
}

/* 내가 마지막으로 손댄 조립대 — 주문서 취소선의 기준이 된다 */
let lastMat = 0;
export const activeMatIndex = () => lastMat;
export function activeMat() {
  const m = matAt(lastMat);
  if (m && (m.gim || m.bap || m.fills.length || m.rolling)) return m;
  const k = K();
  if (!k) return m;
  // 손댄 곳이 비어 있으면 지금 가장 많이 채워진 조립대를 기준으로
  let best = m, n = m ? m.fills.length : -1;
  k.mats.forEach((x, i) => { if (x.fills.length > n) { best = x; n = x.fills.length; lastMat = i; } });
  return best;
}

/** 조립대 동작 — 어느 대에서 작업 중인지 기억한다 */
function matAct(action, i) { lastMat = i; act(action, { mat: i }); }

export function matAt(i) {
  const k = K();
  return (k && k.mats[i]) || null;
}

export function rollProgress(i) {
  const m = matAt(i);
  if (!m || !m.rolling) return 0;
  return Math.min(1, sec(m.rollAt) / TIME.roll);
}

export function broomTaken(rack) {
  const k = K();
  return !!(k && k.brooms[rack]);
}

/** 지금 해금된 속재료 */
export function unlockedFills() {
  const w = S.state && S.state.wave;
  return (w && w.unlocked) || [];
}

/** 조립대에 아직 안 들어간 재료 — 그 조립대에 넣은 것과 가장 잘 맞는 주문 기준 */
export function missingFills(i) {
  const m = matAt(i);
  const w = S.state && S.state.wave;
  // 손이 아니라 "이 조립대" 기준이다 — '말기! — ○○ 빠짐' 은 이 대의 내용물 이야기다
  const target = focusPick((w && w.customers) || [], m ? m.fills : []).focus;
  const want = target ? target.fills : unlockedFills();
  if (!m) return want.slice();
  const have = new Set(m.fills.map((f) => f.id));
  return want.filter((f) => !have.has(f));
}

/* ────────────────────────────────────────────────────────────
   서빙 대상 — 내가 든 김밥의 속재료와 가장 잘 맞는 주문.
   규칙 자체는 config.focusPick 한 곳에만 둔다.
   서버(waves.bestMatch)도 같은 규칙이라 화면과 실제 서빙이 어긋나지 않는다.
   ──────────────────────────────────────────────────────────── */
export function serveTarget() {
  const w = S.state && S.state.wave;
  const h = myHand();
  const fills = h && h.id === 'gimbap' ? (h.fills || []) : null;   // 빈손이면 가장 급한 주문
  return focusPick((w && w.customers) || [], fills).focus;
}

/* ────────────────────────────────────────────────────────────
   🎯 지금 화면이 가리켜야 할 손님
     · outline — 내가 든 김밥과 제일 잘 맞는 손님들 (동점이면 전부). 내 화면에만 그린다.
     · focusId — 그 중 가장 급한 한 명. 주문서 취소선과 '◀ 다음' 표시가 이 사람에게만 간다.
   기준은 손에 김밥이 있으면 그 김밥, 없으면 조립대에 넣은 재료다.
   ──────────────────────────────────────────────────────────── */
const NO_FOCUS = { focusId: null, outline: new Set(), fills: [], held: false, score: 0 };

export function focusNow() {
  const w = S.state && S.state.wave;
  if (!w || !w.customers) return NO_FOCUS;

  const h = myHand();
  const held = h && h.id === 'gimbap' ? (h.fills || []) : null;
  const m = held ? null : activeMat();
  const fills = held || (m ? m.fills : []);

  const pick = focusPick(w.customers, fills);
  return {
    focusId: pick.focusId,
    outline: held ? pick.bestIds : NO_FOCUS.outline,   // 윤곽선은 김밥을 들었을 때만
    fills,
    held: !!held,
    score: pick.score
  };
}

/** 주문 대비 지금 김밥이 얼마나 맞는지 (0~1) */
export function targetMatch(target) {
  const h = myHand();
  if (!target || !h || h.id !== 'gimbap') return null;
  return matchScore(target.fills, h.fills || []);
}

/* ────────────────────────────────────────────────────────────
   조준한 스테이션 + 손 상태 → 지금 할 수 있는 일
   ──────────────────────────────────────────────────────────── */
export function resolveAction(st) {
  if (!st) return null;
  const k = K();
  if (!k) return null;
  const h = myHand();
  const hl = h ? itemLabel(h) : null;
  const playing = isPlaying();

  /* 빗자루 거치대는 언제든 쓸 수 있다 */
  if (st.kind === 'broom') {
    if (!playing) return { text: '영업 시작 후에 쓸 수 있습니다', disabled: true };
    if (broomTaken(st.rack)) return { text: '누가 이미 들고 갔습니다', disabled: true };
    if (h) return { text: '손이 차 있습니다 (Q: 내려놓기)', disabled: true };
    return {
      text: '🧹 빗자루 집기 — 좌클릭으로 동료를 후려칩니다',
      key: 'E', danger: true, run: () => act('broom:take', { rack: st.rack })
    };
  }

  if (!playing) return { text: '방장이 영업을 시작하기를 기다리는 중', disabled: true };

  /* 빗자루를 들면 재료를 만질 수 없다 */
  if (h && h.id === 'broom' && st.kind !== 'bin' && st.kind !== 'customer') {
    return { text: '빗자루를 들고는 재료를 못 만집니다 (Q: 내려놓기)', disabled: true };
  }

  switch (st.kind) {
    case 'fridge': {
      const def = ITEMS[st.item];
      if (!def) return null;
      const locked = def.fill && !unlockedFills().includes(st.item);
      if (locked) {
        const w = S.state && S.state.wave;
        const nu = w && w.nextUnlock;
        return {
          text: def.emoji + ' ' + def.name + ' — 아직 안 들어왔습니다' +
            (nu && nu.id === st.item ? ' (웨이브 ' + nu.wave + ' 해금)' : ''),
          disabled: true
        };
      }
      if (h) return { text: '손이 차 있습니다 (Q: 버리기)', disabled: true };
      const hint = !def.station && def.fill ? ' (손질 불필요)' : '';
      return {
        text: def.emoji + ' ' + def.name + ' 집기' + hint,
        key: 'E', run: () => act('fridge:take', { item: st.item })
      };
    }

    case 'sink': {
      const s = k.sink;
      if (s) {
        if (s.rinses >= TIME.riceRinse) {
          if (h) return { text: '씻은 쌀이 기다립니다 (손이 참)', disabled: true };
          return { text: '씻은 쌀 집기', key: 'E', run: () => act('sink:take') };
        }
        return {
          text: '쌀 헹구기 (' + s.rinses + '/' + TIME.riceRinse + ') — E 연타',
          key: 'E', repeat: true, run: () => act('sink:rinse')
        };
      }
      if (h && h.id === 'rice' && h.stage === 'raw') {
        return { text: '쌀 씻기 시작', key: 'E', run: () => act('sink:put') };
      }
      return { text: '쌀을 들고 오세요', disabled: true };
    }

    case 'cooker': {
      const i = st.cooker;
      const c = cookerAt(i);
      if (!c) return null;
      if (c.state === 'cooking') {
        const left = Math.max(0, TIME.riceCook - sec(c.at));
        return { text: '밥솥 ' + (i + 1) + ' 취사 중... ' + left.toFixed(1) + '초', disabled: true };
      }
      if (c.state === 'ready') {
        if (h) return { text: '밥 ' + c.servings + '인분 남음 (손이 참)', disabled: true };
        return { text: '밥 푸기 — ' + c.servings + '인분 남음', key: 'E', run: () => act('cooker:take', { cooker: i }) };
      }
      if (h && h.id === 'rice' && h.stage === 'washed') {
        return { text: '쌀 안치기 — ' + TIME.riceCook + '초 취사', key: 'E', run: () => act('cooker:put', { cooker: i }) };
      }
      if (h && h.id === 'rice') return { text: '먼저 싱크대에서 씻어 오세요', disabled: true };
      return { text: '밥솥 ' + (i + 1) + ' — 씻은 쌀을 들고 오세요', disabled: true };
    }

    case 'burner': {
      const info = burnerInfo(st.slot);
      const b = BURNERS[st.slot];
      if (info) {
        if (h) return { text: ITEMS[info.cell.id].name + ' — ' + info.label + ' (손이 참)', disabled: true };
        return {
          text: ITEMS[info.cell.id].name + ' 꺼내기 — ' + info.label,
          key: 'E', danger: info.burnt, run: () => act('burner:take', { slot: st.slot })
        };
      }
      if (h && h.stage === 'raw' && ITEMS[h.id] && ITEMS[h.id].station === b.kind) {
        const verb = b.kind === 'pot' ? '데치기' : (h.id === 'egg' ? '지단 부치기' : '볶기');
        return {
          text: ITEMS[h.id].name + ' ' + verb + ' — ' + ITEMS[h.id].target + '초',
          key: 'E', run: () => act('burner:put', { slot: st.slot })
        };
      }
      const want = Object.keys(ITEMS)
        .filter((id) => ITEMS[id].station === b.kind && unlockedFills().includes(id))
        .map((id) => ITEMS[id].emoji + ITEMS[id].name).join(' · ');
      return { text: b.label + ' — ' + (want || '아직 쓸 재료 없음'), disabled: true };
    }

    case 'board': {
      const info = boardInfo(st.board);
      if (info) {
        if (!info.done) {
          const nm = info.b.id === 'roll' ? '김밥' : ITEMS[info.b.id].name;
          return { text: nm + ' 써는 중... ' + Math.round(info.pct * 100) + '%', disabled: true };
        }
        if (h) return { text: '다 썰었습니다 (손이 참)', disabled: true };
        const nm = info.b.id === 'roll' ? '썬 김밥' : '썬 ' + ITEMS[info.b.id].name;
        return { text: nm + ' 집기', key: 'E', run: () => act('board:take', { board: st.board }) };
      }
      if (h && ITEMS[h.id] && ITEMS[h.id].station === 'board' && h.stage === 'raw') {
        return {
          text: ITEMS[h.id].name + ' 썰기 — ' + ITEMS[h.id].dur + '초',
          key: 'E', run: () => act('board:put', { board: st.board })
        };
      }
      if (h && h.id === 'roll') {
        return { text: '김밥 썰기 — ' + TIME.cutRoll + '초', key: 'E', run: () => act('board:put', { board: st.board }) };
      }
      return { text: '도마 ' + (st.board + 1) + ' — 단무지·오이나 만 김밥을 들고 오세요', disabled: true };
    }

    case 'mat': {
      const i = st.mat;
      const m = matAt(i);
      if (!m) return null;
      if (m.rolling) {
        const p = rollProgress(i);
        if (p < 1) return { text: '마는 중... ' + Math.round(p * 100) + '%', disabled: true };
        if (h) return { text: '김밥이 다 말렸습니다 (손이 참)', disabled: true };
        return { text: '만 김밥 집기 — 도마로!', key: 'E', run: () => matAct('mat:take', i) };
      }
      if (h) {
        if (h.id === 'gim') {
          if (m.gim) return { text: '김이 이미 깔려 있습니다', disabled: true };
          return { text: '김 깔기', key: 'E', run: () => matAct('mat:put', i) };
        }
        if (h.id === 'bap') {
          if (!m.gim) return { text: '김부터 깔아야 합니다', disabled: true };
          if (m.bap) return { text: '밥이 이미 올라가 있습니다', disabled: true };
          return { text: '밥 펴기', key: 'E', run: () => matAct('mat:put', i) };
        }
        if (ITEMS[h.id] && ITEMS[h.id].fill) {
          if (h.stage === 'raw') return { text: '손질 안 된 ' + ITEMS[h.id].name + ' 은(는) 못 넣습니다', disabled: true };
          if (h.stage === 'burnt') return { text: '못 쓰게 된 재료입니다 (음쓰통으로)', disabled: true };
          if (!m.bap) return { text: '김 → 밥 순서로 먼저 올리세요', disabled: true };
          if (m.fills.some((f) => f.id === h.id)) return { text: ITEMS[h.id].name + ' 은(는) 이미 들어갔습니다', disabled: true };
          return { text: hl + ' 올리기', key: 'E', run: () => matAct('mat:put', i) };
        }
        return { text: hl + ' 은(는) 못 올립니다', disabled: true };
      }
      if (m.gim && m.bap && m.fills.length) {
        const miss = missingFills(i);
        return {
          text: '말기! — ' + TIME.roll + '초 (' + m.fills.length + '종' +
            (miss.length ? ' · ' + miss.map((f) => ITEMS[f].name).join('·') + ' 빠짐' : ' · 주문 충족') + ')',
          key: 'E', danger: miss.length > 0, run: () => matAct('mat:roll', i)
        };
      }
      if (m.gim || m.bap || m.fills.length) {
        return { text: '맨 위 재료 되돌리기', key: 'E', run: () => matAct('mat:undo', i) };
      }
      return { text: '조립대 ' + (i + 1) + ' — 김을 들고 오세요', disabled: true };
    }

    case 'bin': {
      if (!h) return { text: '음식물 쓰레기통 — 못 쓰는 재료를 여기에', disabled: true };
      if (h.id === 'broom') return { text: '빗자루는 제자리에 (Q)', disabled: true };
      return { text: hl + ' 버리기', key: 'E', run: () => act('bin:drop') };
    }

    /* 👤 손님을 직접 조준해서 서빙 */
    case 'customer': {
      const w = S.state && S.state.wave;
      const c = w && w.customers && w.customers.find((x) => x.id === st.id);
      if (!c) return null;
      const who = c.emoji + ' ' + c.name;
      const names = c.fills.map((id) => ITEMS[id].name).join(' · ');

      if (c.state === 'walkin') return { text: who + ' — 들어오는 중', disabled: true };
      if (c.state === 'happy') return { text: who + ' — 잘 먹고 가는 중', disabled: true };
      if (c.state === 'angry') return { text: who + ' — 화나서 가는 중', disabled: true };
      if (c.state === 'kicked') return { text: who + ' — 쫓겨나는 중', disabled: true };
      if (c.done >= c.need) return { text: who + ' — 이미 받았습니다', disabled: true };

      /* 🧹 빗자루를 들었으면 서빙 대신 쫓아내기 */
      if (h && h.id === 'broom') {
        return {
          text: '🧹 ' + who + ' 후려치기 — 체력 ' + c.hp + '/' + c.hpMax +
            ' (좌클릭, 0 이 되면 쫓겨납니다)',
          danger: true, disabled: true
        };
      }

      if (h && h.id === 'gimbap') {
        const pct = Math.round(matchScore(c.fills, h.fills || []) * 100);
        return {
          text: who + ' 에게 서빙! — ' + names + ' (일치 ' + pct + '%)',
          key: 'E', danger: pct < 100,
          run: () => act('serve', { customerId: c.id })
        };
      }
      if (h && h.id === 'roll') return { text: who + ' — 먼저 도마에서 썰어 오세요', disabled: true };
      return { text: who + ' 주문 — ' + names, disabled: true };
    }

    case 'serve': {
      const t = serveTarget();
      if (h && h.id === 'gimbap') {
        if (!t) return { text: '기다리는 주문이 없습니다', disabled: true };
        const m = targetMatch(t);
        const pct = Math.round((m === null ? 0 : m) * 100);
        const who = t.kind === 'counter' ? t.emoji + ' ' + t.name : '🖥️ 키오스크';
        return {
          text: who + ' 에게 서빙! (' + (t.done + 1) + '/' + t.need + '줄 · 주문 일치 ' + pct + '%)',
          key: 'E', danger: pct < 100, run: () => act('serve')
        };
      }
      if (h && h.id === 'roll') return { text: '먼저 도마에서 썰어 오세요', disabled: true };
      if (t) {
        const who = t.kind === 'counter' ? t.emoji + ' ' + t.name : '🖥️ 키오스크 주문';
        return { text: who + ' 가 ' + (t.need - t.done) + '줄 기다립니다', disabled: true };
      }
      return { text: '완성된 김밥을 들고 오세요', disabled: true };
    }

    case 'kiosk':
      return { text: '🖥️ 키오스크 — 일반 손님 주문이 여기로 들어옵니다', disabled: true };
  }
  return null;
}

/** Q — 버리기 / 빗자루 반납 */
export function dropHand() { act('drop'); }

/** 좌클릭 스윙 */
export function swingBroom(targetId, targetKind) {
  emit('player:swing', { targetId: targetId || null, targetKind: targetKind || 'player' });
}

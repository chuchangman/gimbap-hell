/* ────────────────────────────────────────────────────────────
   HUD — 웨이브 · 평판 · 주문서 · 손 · 조준 문구.

   서버 스냅샷을 그대로 읽어 그린다. 상태를 따로 들고 있지 않으므로
   "화면과 서버가 어긋난" 상태가 존재할 수 없다.

   갱신은 두 갈래다.
   - 스냅샷이 도착하면 (`state` · `kitchen` · `connection`)
   - 게임 중에는 15Hz 로 한 번 더 — 남은 시간과 인내심 막대가 초 단위로
     흐르고, 조준 문구는 매 프레임 바뀌는 `player.state` 에서 나온다.
     60Hz 로 다시 그릴 이유는 없다.
   ──────────────────────────────────────────────────────────── */
import { UI } from '@/config';
import { bapReady, focusNow } from '@/features/kitchen/kitchen';
import { myHand, on, S, serverNow, wave as waveOf } from '@/features/net/net';
import { state as P } from '@/features/player/player';
import {
  handHint,
  ITEMS,
  itemUnlockWave,
  KIND,
  REPUTATION_MAX,
  type ItemId,
} from '@repo/game-core';
import type { CustomerView, WaveEndPayload, WaveSnapshot } from '@repo/types';
import { useEffect, useState } from 'react';

const mmss = (sec: number): string => {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

/** 스냅샷이 오거나, 게임 중이면 15Hz 로 다시 그린다 */
function useHudClock(playing: boolean): void {
  const [, bump] = useState(0);
  const redraw = (): void => bump((n) => (n + 1) % 1000);

  useEffect(() => {
    const offs = (['state', 'kitchen', 'connection'] as const).map((e) => on(e, redraw));
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(redraw, UI.hudTickMs);
    return () => clearInterval(id);
  }, [playing]);
}

/* ──────────────── 조각들 ──────────────── */

function Prompt() {
  const p = P.prompt;
  if (!p) return <div id="prompt" className="hidden" />;
  const tone = p.disabled ? 'off' : p.danger ? 'danger' : '';
  return (
    <div id="prompt" className={tone}>
      {!p.disabled && <b className="key">{p.key || 'E'}</b>}
      <span className="msg">{p.text}</span>
    </div>
  );
}

function Hand() {
  const h = myHand();
  const def = h ? ITEMS[h.id] : null;
  if (!h || !def)
    return (
      <div id="hand" className="hand">
        <span className="nm empty">빈손</span>
      </div>
    );
  const burnt = h.stage === 'burnt';
  return (
    <div id="hand" className={'hand has' + (burnt ? ' spoiled' : '')}>
      <span className="emoji">{def.emoji || '📦'}</span>
      <span className="nm">{def.label?.[h.stage] || def.name}</span>
      {burnt ? (
        <span className="q bad">못 씀</span>
      ) : (
        h.id !== 'broom' && h.quality < 100 && <span className="q">품질 {h.quality}</span>
      )}
    </div>
  );
}

/* 뭘 해야 하는지 한 줄 — 그 재료가 풀리는 웨이브에만 띄운다.
   계속 띄우면 잔소리가 되고, 처음 보는 재료일 때가 제일 아쉽다. */
function HandHint({ wave }: { wave: WaveSnapshot }) {
  const h = myHand();
  const cur = wave.phase === 'prep' ? Math.min(wave.wave + 1, wave.totalWaves) : wave.wave;
  const hint = h && itemUnlockWave(h.id) === cur ? handHint(h) : null;
  return (
    <div id="hand-hint" className={'hand-hint' + (hint ? '' : ' hidden')}>
      {hint}
    </div>
  );
}

function TopBar({ wave, now }: { wave: WaveSnapshot; now: number }) {
  const prepping = wave.phase === 'prep';
  const left = prepping ? (wave.phaseEndsAt - now) / 1000 : 0;
  const rep = wave.reputation;
  return (
    <div className="hud-top">
      <div className={'chip' + (prepping ? ' prep' : '')} id="wave-chip">
        {prepping
          ? '준비 중 → 웨이브 ' + Math.min(wave.wave + 1, wave.totalWaves)
          : '🌊 웨이브 ' + wave.wave + ' / ' + wave.totalWaves}
      </div>
      <div className={'timer' + (prepping && left < 6 ? ' urgent' : '')} id="timer">
        {prepping ? mmss(left) : wave.customers.length + wave.waiting + '명 남음'}
      </div>
      <div className="rep">
        <span>평판</span>
        <div className="bar">
          <i
            id="rep-bar"
            className={rep < 40 ? 'low' : ''}
            style={{ width: (rep / REPUTATION_MAX) * 100 + '%' }}
          />
        </div>
        <b id="rep-num">{rep}</b>
      </div>
      <div className="score" id="score">
        <b>{wave.score}</b> 점
      </div>
    </div>
  );
}

/** 🧹 남은 체력 — 빗자루로 이만큼 더 때리면 쫓겨난다 */
function Hearts({ hp, hpMax }: { hp: number; hpMax: number }) {
  if (!hpMax) return null;
  return (
    <span className="hp">
      {'♥'.repeat(hp)}
      <b>{'♥'.repeat(Math.max(0, hpMax - hp))}</b>
    </span>
  );
}

function QueueRow({
  c,
  now,
  focusId,
  outlined,
  aimed,
  have,
}: {
  c: CustomerView;
  now: number;
  focusId: string | null;
  outlined: boolean;
  aimed: boolean;
  have: Set<string>;
}) {
  const secs = Math.max(0, (c.deadline - now) / 1000);
  const pct = c.state === 'walkin' ? 100 : Math.max(0, Math.min(100, (secs / c.patienceMax) * 100));
  const tone = pct > 50 ? '' : pct > 25 ? 'warn' : 'bad';
  const isFocus = c.id === focusId;
  const mark = isFocus ? ' focus' : outlined ? ' match' : '';
  return (
    <li
      className={(c.kind === KIND.COUNTER ? 'counter' : 'kiosk') + mark + (aimed ? ' aimed' : '')}
    >
      <div className="top">
        <span className="who">
          {c.emoji} {c.name}
        </span>
        {isFocus && <span className="pin">◀ 다음</span>}
        <Hearts hp={c.hp} hpMax={c.hpMax} />
        <span className="secs">{c.state === 'walkin' ? '입장' : Math.ceil(secs) + 's'}</span>
      </div>
      {/* 줄은 가장 급한 한 명에게만 — 다른 손님 행은 재료 이름 그대로 둔다 */}
      <div className="items">
        {c.fills.map((id, i) => (
          <span key={id + i} className={isFocus && have.has(id) ? 'got' : ''}>
            {ITEMS[id].name}
          </span>
        ))}
      </div>
      <i className="bar">
        <em className={tone} style={{ width: pct.toFixed(0) + '%' }} />
      </i>
    </li>
  );
}

/** 📋 주문서 — 재료는 이름으로. 기다리는 손님만, 급한 순서로 */
function Queue({ wave, now }: { wave: WaveSnapshot; now: number }) {
  const aimedStation = (P.target?.userData.station ?? null) as {
    kind?: string;
    id?: string;
  } | null;
  const aimedId = aimedStation?.kind === 'customer' ? aimedStation.id : null;
  const f = focusNow();
  const have = new Set<string>(f.fills.map((x: { id: ItemId }) => x.id));
  const rows = wave.customers
    .filter((c) => c.state === 'wait' || c.state === 'walkin')
    .sort((a, b) => a.deadline - b.deadline);

  return (
    <div id="queue" className="queue">
      <h4>📋 주문서{wave.waiting ? <em>+{wave.waiting}명 대기</em> : null}</h4>
      <ul>
        {rows.length ? (
          rows.map((c) => (
            <QueueRow
              key={c.id}
              c={c}
              now={now}
              focusId={f.focusId}
              outlined={f.outline.has(c.id)}
              aimed={aimedId === c.id}
              have={have}
            />
          ))
        ) : (
          <li className="none">
            {wave.phase === 'prep' ? '준비 시간 — 밥부터 안치세요' : '손님이 오는 중...'}
          </li>
        )}
      </ul>
      <p className="tip">
        손님을 조준하고 <b>E</b> 로 서빙 · 🧹 들고 <b>좌클릭</b>이면 쫓아내기
      </p>
    </div>
  );
}

/** 우측 — 밥 상태와 다음 해금 */
function Say({ wave }: { wave: WaveSnapshot }) {
  const b = bapReady();
  const nu = wave.nextUnlock;
  return (
    <div id="say" className="say">
      {b.servings ? (
        <>
          🍚 밥 <b>{b.servings}인분</b> 준비됨{b.cooking ? ' · 취사 중 ' + b.cooking : ''}
        </>
      ) : b.cooking ? (
        '🍚 취사 중... (' + b.cooking + '대)'
      ) : (
        <b className="warn">🍚 밥솥이 비었습니다</b>
      )}
      {nu && (
        <>
          <br />
          🔓 웨이브 {nu.wave} 에 <b>{nu.name}</b> 해금
        </>
      )}
    </div>
  );
}

/** 🍣 잘라놓은 김밥을 들고 있으면 무엇이 들었는지 펼쳐준다 */
function Roll() {
  const held = myHand();
  const fills = held && held.id === 'gimbap' ? held.fills || [] : null;
  if (!fills) return <div id="roll" className="roll hidden" />;
  const f = focusNow();
  return (
    <div id="roll" className="roll">
      <h4>🍣 내 김밥</h4>
      <div className="fills">
        {fills.length ? (
          fills.map((x, i) => {
            const q = x.quality ?? 100;
            return (
              <span key={x.id + i} className={q >= 90 ? '' : q >= 60 ? 'mid' : 'bad'}>
                {ITEMS[x.id].name}
              </span>
            );
          })
        ) : (
          <span className="none">속재료 없이 말았습니다</span>
        )}
      </div>
      <p className="hint">
        {f.outline.size ? (
          <>
            테두리 친 손님 <b>{f.outline.size}명</b>에게 맞습니다
          </>
        ) : f.focusId ? (
          '속재료가 없어 대상을 못 고릅니다'
        ) : (
          '기다리는 주문이 없습니다'
        )}
      </p>
    </div>
  );
}

function PauseOverlay() {
  const paused = !!(S.state?.phase === 'playing' && S.state.paused);
  const host = !!S.state && S.state.hostId === S.meId;
  return (
    <div id="pause-overlay" className={'pause-overlay' + (paused ? '' : ' hidden')}>
      <strong>⏸ 일시정지</strong>
      <span id="pause-hint">
        {host ? 'P를 눌러 게임을 재개하세요.' : '방장이 게임을 재개할 때까지 기다려 주세요.'}
      </span>
    </div>
  );
}

/* 🌊 웨이브 종료 팝업 — 크게 한 번 띄웠다 사라진다. 토스트는 우르르 쌓여서
   놓치기 쉬워 웨이브가 끝난 건 따로 알린다.
   key 를 바꿔 새로 마운트하면 CSS 애니메이션이 다시 돈다. */
function WavePop() {
  const [shown, setShown] = useState<{ seq: number; d: WaveEndPayload } | null>(null);
  useEffect(() => on('waveEnd', (d) => setShown((prev) => ({ seq: (prev?.seq ?? 0) + 1, d }))), []);
  if (!shown) return <div id="wave-pop" className="wave-pop" />;

  const { d } = shown;
  const done = !!d.victory;
  const happy = d.happy || 0;
  const angry = d.angry || 0;
  return (
    <div id="wave-pop" key={shown.seq} className={'wave-pop show' + (done ? ' final' : '')}>
      <b>{done ? '🎉 ' + d.wave + '웨이브 완주!' : '✅ 웨이브 ' + d.wave + ' 클리어'}</b>
      <span>
        {happy || angry ? (
          <>
            {happy ? (
              <>
                😊 만족 <em>{happy}</em>
              </>
            ) : null}
            {happy && angry ? ' · ' : ''}
            {angry ? (
              <>
                😡 놓침 <i>{angry}</i>
              </>
            ) : null}
          </>
        ) : (
          '손님이 모두 지나갔습니다'
        )}
        {done ? '' : ' · 곧 웨이브 ' + (d.wave + 1)}
      </span>
    </div>
  );
}

/* ──────────────── 전체 ──────────────── */

export function Hud() {
  const playing = S.state?.phase === 'playing';
  useHudClock(!!playing);
  const wave = waveOf();
  const now = serverNow();

  return (
    <div id="hud" className={playing ? '' : 'hidden'}>
      {wave && <TopBar wave={wave} now={now} />}
      <div className="hud-sub" id="stat-rolls">
        {wave &&
          `🍣 ${wave.servedRolls}줄 · ⭐ ${wave.avgQuality} · 😋 ${wave.happy} · 😡 ${wave.angry}`}
      </div>
      <WavePop />
      <PauseOverlay />

      {wave ? <Queue wave={wave} now={now} /> : <div id="queue" className="queue" />}
      <div className="hud-right">
        {wave ? <Say wave={wave} /> : <div id="say" className="say" />}
        <Roll />
      </div>

      {wave ? <HandHint wave={wave} /> : <div id="hand-hint" className="hand-hint hidden" />}

      <div id="crosshair" />
      <Prompt />

      <div className="hud-bottom">
        <Hand />
      </div>

      <div className="controls">
        <b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>Space</b> 점프 · <b>마우스</b> 시점
        <br />
        <b>E</b>/좌클릭 상호작용 · <b>Q</b> 버리기 · <b>H</b> 도움말 · <b>Esc</b> 마우스 해제
        <br />
        방장: <b>P</b> 일시정지/재개
        <br />
        <b>🧹 빗자루</b>를 들면 <b>좌클릭</b>으로 동료 · 손님을 후려칩니다
      </div>
    </div>
  );
}

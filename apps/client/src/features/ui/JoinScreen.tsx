/* ────────────────────────────────────────────────────────────
   입장 화면 — 이름 · 캐릭터 꾸미기 · 새 가게 열기 / 방 코드로 입장.

   `.customize` 안쪽은 `features/customize/customize.ts` 가 id 로 잡아
   칠한다. 3D 미리보기가 명령형 three 코드라 거기만 그대로 뒀다.
   ──────────────────────────────────────────────────────────── */
import { currentLook } from '@/features/customize/customize';
import { emit, S } from '@/features/net/net';
import { NAME_MAX, NAME_MIN, PLAYER_LIMIT, ROOM_CODE_LENGTH, SHOP_MAX } from '@repo/game-core';
import { useState } from 'react';

/** 파츠 한 줄 — 머리 · 얼굴 · 표정 · 상의 · 하의가 같은 모양이다 */
function PartRow({ part, label }: { part: string; label: string }) {
  return (
    <div className="cz-row" data-part={part}>
      <span className="cz-label">{label}</span>
      <button className="cz-arrow" data-d="-1" type="button">
        ◀
      </button>
      <b className="cz-name" />
      <button className="cz-arrow" data-d="1" type="button">
        ▶
      </button>
    </div>
  );
}

export function JoinScreen({ active, connected }: { active: boolean; connected: boolean }) {
  const [name, setName] = useState('');
  const [shop, setShop] = useState('');
  const [code, setCode] = useState(() =>
    location.hash.length === ROOM_CODE_LENGTH + 1 ? location.hash.slice(1).toUpperCase() : '',
  );
  const [err, setErr] = useState('');
  const [joining, setJoining] = useState(false);

  const busy = joining || !connected;

  const join = (event: 'room:create' | 'room:join', data: Record<string, unknown>): void => {
    if (joining) return;
    setJoining(true);
    setErr('가게에 연결하고 있습니다…');
    emit(event, data, (res) => {
      setJoining(false);
      if (!res?.ok) {
        setErr(res?.err || '입장하지 못했습니다.');
        return;
      }
      setErr('');
      S.meId = res.youId as string;
      location.hash = res.code as string;
    });
  };

  /* 서버도 같은 규칙으로 막는다 — 여기선 먼저 알려줄 뿐 */
  const nameOk = (): boolean => {
    if (name.trim().length >= NAME_MIN) return true;
    setErr(`이름은 ${NAME_MIN}글자 이상이어야 합니다.`);
    return false;
  };

  const create = (): void => {
    if (!nameOk()) return;
    join('room:create', { name: name.trim(), shop: shop.trim(), look: currentLook() });
  };

  const enter = (): void => {
    if (!nameOk()) return;
    const c = code.trim().toUpperCase();
    if (c.length !== ROOM_CODE_LENGTH) {
      setErr(`방 코드 ${ROOM_CODE_LENGTH}글자를 입력하세요.`);
      return;
    }
    join('room:join', { code: c, name: name.trim(), look: currentLook() });
  };

  return (
    <section id="screen-join" className={'screen solid scrollable' + (active ? ' active' : '')}>
      <div className="card">
        <h1 className="logo">
          🍣 김밥지옥
          <br />
          <span>웨이브 디펜스</span>
        </h1>
        <p className="tagline">
          손님이 웨이브로 밀려옵니다.
          <br />다 같이 김밥을 말아 인내심이 다하기 전에 내보내세요.
        </p>

        <label className="field">
          <span>
            이름{' '}
            <em id="name-limits">
              ({NAME_MIN}~{NAME_MAX}글자)
            </em>
          </span>
          <input
            id="input-name"
            placeholder="예: 김알바"
            autoComplete="off"
            minLength={NAME_MIN}
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr('');
            }}
          />
        </label>

        <div className="cz-heading">
          <b>나의 클레이 캐릭터</b>
          <span>선택한 모습이 게임에 그대로 적용돼요</span>
        </div>
        <div className="customize">
          <div className="cz-preview">
            <canvas id="cz-canvas" aria-label="캐릭터 3D 미리보기. 드래그해서 회전" tabIndex={0} />
            <div className="cz-view-controls">
              <button id="cz-turn" type="button" title="캐릭터 90도 회전">
                ↻ 회전
              </button>
              <button id="cz-walk" type="button" aria-pressed="false">
                걷기
              </button>
              <button id="cz-front" type="button">
                정면
              </button>
            </div>
            <span className="cz-preview-hint">드래그로 360° 돌려보기</span>
          </div>
          <div className="cz-rows">
            <div className="cz-color-label">피부색</div>
            <div className="cz-swatches" data-swatch="skin" />
            <PartRow part="hair" label="머리" />
            <div className="cz-swatches" data-swatch="hair" />
            <PartRow part="face" label="얼굴" />
            <PartRow part="expression" label="표정" />
            <PartRow part="top" label="상의" />
            <div className="cz-swatches" data-swatch="top" />
            <PartRow part="bottom" label="하의" />
            <div className="cz-swatches" data-swatch="bottom" />
            <div className="cz-color-label">신발색</div>
            <div className="cz-swatches" data-swatch="shoes" />
            <div className="cz-actions">
              <button id="cz-random" className="btn tiny" type="button">
                랜덤 조합
              </button>
              <button id="cz-reset" className="btn tiny" type="button">
                기본 조합
              </button>
            </div>
          </div>
        </div>

        <label className="field">
          <span>
            가게 이름 <em>(새로 열 때만 · 비우면 「이름」의 가게)</em>
          </span>
          <input
            id="input-shop"
            placeholder={name.trim() ? name.trim() + '의 가게' : '비워두면 「이름」의 가게'}
            autoComplete="off"
            maxLength={SHOP_MAX}
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
          />
        </label>

        <button id="btn-create" className="btn primary big" disabled={busy} onClick={create}>
          새 가게 열기
        </button>
        <div className="or">
          <span>또는</span>
        </div>
        <div className="join-row">
          <input
            id="input-code"
            placeholder="방 코드"
            autoComplete="off"
            maxLength={ROOM_CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enter();
            }}
          />
          <button id="btn-join" className="btn" disabled={busy} onClick={enter}>
            입장
          </button>
        </div>
        <p id="join-err" className="err" role="status" aria-live="polite">
          {err}
        </p>
        <p id="player-limit-hint" className="hint small">
          최대 {PLAYER_LIMIT}명 · 같은 Wi-Fi 면 주소만 공유하면 됩니다.
        </p>
      </div>
    </section>
  );
}

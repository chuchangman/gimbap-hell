/* ────────────────────────────────────────────────────────────
   소켓 + 공유 상태
   서버가 보내주는 스냅샷을 S 에 담아두고, 나머지 모듈은 여기서 읽는다.

   React state 로 옮기지 않는다 — 위치는 15Hz 로 들어오고 화면은 60Hz 이상
   이므로, 렌더 루프가 매 프레임 읽어야 하는 값을 컴포넌트 상태로 두면
   초당 수십 번 리렌더가 난다. UI 가 필요한 값만 useNetSnapshot 이 꺼내 간다.
   ──────────────────────────────────────────────────────────── */
import {
  createPositionBuffer,
  unpack,
  type RemotePose,
  type UnpackedPosition,
} from '@/features/net/interpolation';
import { DEFAULT_RECOVERY_MS } from '@repo/game-core';
import type {
  HeldItem,
  HelloPayload,
  HitPayload,
  KitchenSnapshot,
  Pose,
  PoseCorrection,
  PositionTuple,
  PublicState,
  SwingPayload,
  ToastPayload,
  WaveEndPayload,
  WaveSnapshot,
} from '@repo/types';
import { io, type Socket } from 'socket.io-client';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

export interface NetStore {
  socket: Socket | null;
  meId: string | null;
  meName: string;
  /** 방/웨이브 공개 상태 */
  state: PublicState | null;
  /** 주방 스냅샷 */
  kitchen: KitchenSnapshot | null;
  /** 다른 플레이어 위치 */
  positions: (UnpackedPosition & { id: string | null })[];
  /** 서버 시계 - 내 시계 (ms) */
  offset: number;
  connection: ConnectionState;
  frozenAt: number;
  restorePose: Pose | null;
  recoveryMs: number;
  motionVersion: number;
}

export const S: NetStore = {
  socket: null,
  meId: null,
  meName: '',
  state: null,
  kitchen: null,
  positions: [],
  offset: 0,
  connection: 'connecting',
  frozenAt: 0,
  restorePose: null,
  recoveryMs: DEFAULT_RECOVERY_MS,
  motionVersion: 0,
};

/* ──────────────── 이벤트 구독 ──────────────── */
export interface NetEvents {
  hello: HelloPayload;
  state: PublicState;
  kitchen: KitchenSnapshot;
  positions: (UnpackedPosition & { id: string | null })[];
  toast: ToastPayload;
  waveEnd: WaveEndPayload;
  swing: SwingPayload;
  hit: HitPayload;
  'position:correct': PoseCorrection;
  connection: ConnectionState;
  phase: PublicState['phase'];
  wave: WaveSnapshot;
}

type Listener<K extends keyof NetEvents> = (data: NetEvents[K]) => void;
const listeners = new Map<string, Listener<never>[]>();

export function on<K extends keyof NetEvents>(evt: K, fn: Listener<K>): () => void {
  const list = listeners.get(evt) || [];
  listeners.set(evt, list);
  list.push(fn as Listener<never>);
  return () => {
    const i = list.indexOf(fn as Listener<never>);
    if (i >= 0) list.splice(i, 1);
  };
}

function fire<K extends keyof NetEvents>(evt: K, data: NetEvents[K]): void {
  for (const fn of listeners.get(evt) || []) {
    try {
      (fn as Listener<K>)(data);
    } catch (err) {
      console.error('[net] ' + evt, err);
    }
  }
}

/** 서버 기준 현재 시각 (ms) */
export const serverNow = (): number => {
  if (S.connection !== 'connected' && S.frozenAt) return S.frozenAt;
  if (S.state && S.state.paused && S.state.pausedAt) return S.state.pausedAt;
  return Date.now() + S.offset;
};

/** 자리번호 → socket.id — 상태 스냅샷의 players[].slot 이 알려준다 */
function idOfSlot(slot: number): string | null {
  const list = S.state?.players || [];
  const p = list.find((x) => x.slot === slot);
  return p ? p.id : null;
}

/* 위치 보간은 interpolation.ts 로 뺐다 — 알고리즘은 그대로고,
   테스트가 직접 표본을 먹일 수 있게 되었을 뿐이다. */
const positions = createPositionBuffer(idOfSlot);

/** 지금 화면에 그릴 남들의 위치 (나는 뺀다) */
export function remotePositions(): RemotePose[] {
  return positions.sample(serverNow(), S.meId);
}

/** 내가 지금 손에 들고 있는 것 */
export function myHand(): HeldItem | null {
  if (!S.kitchen?.hands) return null;
  const h = S.kitchen.hands.find((x) => x.id === S.meId);
  return h ? h.holding : null;
}

export function handOf(id: string): HeldItem | null {
  if (!S.kitchen?.hands) return null;
  const h = S.kitchen.hands.find((x) => x.id === id);
  return h ? h.holding : null;
}

export const isHost = (): boolean => !!S.state && S.state.hostId === S.meId;
export const isPaused = (): boolean => !!S.state && !!S.state.paused;
export const wave = (): WaveSnapshot | null => S.state?.wave || null;
export const phase = (): PublicState['phase'] => (S.state ? S.state.phase : 'lobby');
export const isPlaying = (): boolean =>
  S.connection === 'connected' && phase() === 'playing' && !isPaused();

/* ──────────────── 보내기 ──────────────── */
export function emit(
  evt: string,
  data?: unknown,
  cb?: (result: { ok: boolean; err?: string } & Record<string, unknown>) => void,
): boolean {
  /* Socket.IO 는 끊긴 동안의 emit 을 버퍼에 쌓는다. 재연결 때 옛 조리·이동
     명령을 다시 흘리면 게임 타임라인의 다른 지점을 건드리게 된다. */
  if (!S.socket?.connected || S.connection !== 'connected') {
    cb?.({ ok: false, err: '연결 복구 중입니다. 잠시 기다려 주세요.' });
    return false;
  }
  if (cb)
    S.socket
      .timeout(8000)
      .emit(evt, data, (error: unknown, response: unknown) =>
        cb(
          error
            ? { ok: false, err: '응답이 늦어지고 있습니다. 연결 상태를 확인해 주세요.' }
            : (response as { ok: boolean } & Record<string, unknown>),
        ),
      );
  else S.socket.emit(evt, data);
  return true;
}

/** 주방 동작 — 서버가 다시 검사한다 */
export function act(action: string, payload?: Record<string, unknown>): void {
  emit('kitchen:act', { action, payload: payload || {} });
}

/* ──────────────── 연결 ──────────────── */
export function connect(): Promise<void> {
  /* 레거시는 index.html 이 /socket.io/socket.io.js 를 불러 window.io 를 썼다.
     번들러가 있으니 패키지에서 직접 가져온다 — 경로와 옵션은 그대로다. */
  const socket = io({ timeout: 8000, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
  S.socket = socket;

  const clearSession = (): void => {
    S.state = null;
    S.kitchen = null;
    S.positions = [];
    S.restorePose = null;
    positions.clear();
  };

  socket.on('hello', (d: HelloPayload) => {
    const hadSession = !!S.state;
    if (!d.restored) clearSession();
    S.meId = d.id;
    S.connection = 'connected';
    S.frozenAt = 0;
    S.motionVersion = d.motionVersion || 0;
    S.recoveryMs = d.recoveryMs || DEFAULT_RECOVERY_MS;
    S.restorePose = d.restored ? d.pose : null;
    fire('hello', d);
    fire('connection', S.connection);
    if (hadSession && !d.restored)
      fire('toast', {
        msg: '이전 연결을 복구하지 못했습니다. 방 코드로 다시 입장해 주세요.',
        kind: 'warn',
      });
    if (d.restored)
      fire('toast', { msg: '연결을 복구했습니다. 같은 자리에서 이어갑니다.', kind: 'good' });
  });

  socket.on('state', (st: PublicState) => {
    // 재생된 옛 패킷은 무시한다 — hello 가 새 state 보다 먼저 온다
    if (S.connection !== 'connected') return;
    S.offset = st.now - Date.now();
    const prev = S.state?.phase;
    const prevWave = S.state?.wave?.wave;
    S.state = st;
    if (st.phase === 'playing' && prev !== 'playing') S.motionVersion = 0;
    fire('state', st);
    if (prev !== st.phase) fire('phase', st.phase);
    const w = st.wave?.wave;
    if (w && w !== prevWave) fire('wave', st.wave!);
  });

  socket.on('kitchen', (k: KitchenSnapshot) => {
    if (S.connection !== 'connected') return;
    S.offset = k.now - Date.now();
    S.kitchen = k;
    fire('kitchen', k);
  });

  socket.on('positions', (d: { t?: number; list?: PositionTuple[] } | PositionTuple[]) => {
    if (S.connection !== 'connected') return;
    const raw = (Array.isArray(d) ? d : d.list) || [];
    const t = !Array.isArray(d) && typeof d.t === 'number' ? d.t : serverNow();
    positions.push(t, raw);
    /* S.positions 는 예전처럼 id 가 붙은 객체로 둔다 — 내 스폰 자리를 찾는 데 쓴다 */
    S.positions = raw.map(unpack).map((e) => ({ id: idOfSlot(e.slot), ...e }));
    fire('positions', S.positions);
  });

  socket.on('position:correct', (d: PoseCorrection) => {
    if (S.connection !== 'connected' || !Number.isInteger(d.version) || d.version < S.motionVersion)
      return;
    S.motionVersion = d.version;
    fire('position:correct', d);
  });

  socket.on('toast', (d: ToastPayload) => {
    if (S.connection === 'connected') fire('toast', d);
  });
  socket.on('waveEnd', (d: WaveEndPayload) => {
    if (S.connection === 'connected') fire('waveEnd', d);
  });
  socket.on('swing', (d: SwingPayload) => {
    if (S.connection === 'connected') fire('swing', d);
  });
  socket.on('hit', (d: HitPayload) => {
    if (S.connection === 'connected') fire('hit', d);
  });

  socket.on('disconnect', () => {
    S.frozenAt = serverNow();
    S.connection = 'reconnecting';
    fire('connection', S.connection);
  });
  socket.on('connect_error', () => {
    S.connection = 'reconnecting';
    fire('connection', S.connection);
  });
  socket.on('server:closing', (d: { msg: string }) => fire('toast', { msg: d.msg, kind: 'warn' }));

  return new Promise((resolve) => {
    /* 첫 시도가 실패해도 조작과 연결 상태는 보여준다. 배경 재연결이
       살아 있으므로 죽은 fatal 화면 없이 복구될 수 있다. */
    socket.once('hello', () => resolve());
    socket.once('connect_error', () => resolve());
  });
}

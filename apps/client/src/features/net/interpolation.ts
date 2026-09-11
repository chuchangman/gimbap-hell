/* ────────────────────────────────────────────────────────────
   원격 플레이어 위치 보간

   위치는 초당 15번만 오는데 화면은 60Hz 이상이다. 받은 좌표를 그대로
   그리면 초당 15번만 움직여 뚝뚝 끊긴다. 표본을 잠깐 쌓아두고 "조금
   과거"를 그리면 항상 앞뒤 두 표본 사이를 지나가므로 등속으로 흐른다.

   레거시 net.js 안에 모듈 전역으로 있던 것을 그대로 옮겨 담았다.
   알고리즘은 같고, 테스트가 직접 먹일 수 있게 되었을 뿐이다.
   ──────────────────────────────────────────────────────────── */
import { NETWORK } from '@/config';
import { NET, samplePath, type PathSample } from '@repo/game-core';
import type { PositionTuple } from '@repo/types';

/** 받는 쪽이 재생하는 지연 */
const INTERP_MS = NET.interpMs;
/** 이보다 오래된 표본은 버린다 */
const KEEP_MS = NETWORK.poseKeepMs;

export interface UnpackedPosition {
  slot: number;
  x: number;
  z: number;
  y: number;
  ry: number;
}

export interface RemotePose {
  id: string;
  x: number;
  z: number;
  y: number;
  ry: number;
}

/** 위치 항목은 [자리번호, x, z, y, ry] 배열로 온다 (옛 객체 형식도 받아준다) */
export function unpack(e: PositionTuple | UnpackedPosition): UnpackedPosition {
  return Array.isArray(e)
    ? { slot: e[0], x: e[1], z: e[2], y: e[3] || 0, ry: e[4] }
    : { slot: e.slot, x: e.x, z: e.z, y: e.y || 0, ry: e.ry };
}

export interface PositionBuffer {
  push(t: number, list: (PositionTuple | UnpackedPosition)[]): void;
  /** 지금 화면에 그릴 남들의 위치 (나는 뺀다) */
  sample(at: number, meId: string | null): RemotePose[];
  clear(): void;
  /** 진단용 — 자리별로 쌓인 표본 수 */
  size(slot: number): number;
}

/**
 * @param idOfSlot 자리번호 → socket.id. 상태 스냅샷의 players[].slot 이 알려준다.
 */
export function createPositionBuffer(idOfSlot: (slot: number) => string | null): PositionBuffer {
  /** 자리번호 → 시간순 표본 */
  const snaps = new Map<number, PathSample[]>();
  /** 자리번호 → 표본을 쌓을 때의 주인 id */
  const owner = new Map<number, string>();

  return {
    push(t, list) {
      const seen = new Set<number>();
      for (const e of list) {
        const p = unpack(e);
        seen.add(p.slot);
        /* 나간 자리를 새 사람이 물려받으면, 옛 좌표와 섞여 미끄러져 온다 */
        const who = idOfSlot(p.slot);
        if (who && owner.get(p.slot) !== who) {
          owner.set(p.slot, who);
          snaps.set(p.slot, []);
        }
        let buf = snaps.get(p.slot);
        if (!buf) snaps.set(p.slot, (buf = []));
        const last = buf[buf.length - 1];
        if (last && t <= last.t) continue; // 뒤늦게 온 패킷은 버린다
        buf.push({ t, x: p.x, z: p.z, y: p.y, ry: p.ry });
        while (buf.length > 2 && buf[1].t < t - KEEP_MS) buf.shift();
      }
      for (const slot of [...snaps.keys()]) {
        if (!seen.has(slot)) {
          snaps.delete(slot);
          owner.delete(slot);
        }
      }
    },

    sample(at, meId) {
      const out: RemotePose[] = [];
      for (const [slot, buf] of snaps) {
        const id = idOfSlot(slot);
        if (!id || id === meId) continue; // 아직 누군지 모르면 그리지 않는다
        const s = samplePath(buf, at - INTERP_MS);
        if (s) out.push({ id, x: s.x, z: s.z, y: s.y || 0, ry: s.ry });
      }
      return out;
    },

    clear() {
      snaps.clear();
      owner.clear();
    },

    size(slot) {
      return snaps.get(slot)?.length ?? 0;
    },
  };
}

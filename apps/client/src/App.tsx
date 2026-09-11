import { connect, S } from '@/features/net/net';
import { Shell } from '@/features/ui/Shell';
import { useEffect } from 'react';

/** 4단계 진행 중 — 화면 뼈대와 소켓 연결까지.
 *  다음 슬라이스에서 `ui.ts` 의 initUI 가 이 뼈대 위에 값을 칠하고,
 *  월드 · 플레이어 · 주방을 붙인다. */
export function App() {
  useEffect(() => {
    void connect();
    return () => {
      S.socket?.disconnect();
    };
  }, []);

  return <Shell />;
}

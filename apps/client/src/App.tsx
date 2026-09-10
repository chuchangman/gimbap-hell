import { connect, S } from '@/features/net/net';
import { useEffect, useState } from 'react';

/** 4단계 진행 중 — 지금은 연결만 확인한다.
 *  월드 · 플레이어 · 주방 · UI 는 다음 슬라이스에서 붙는다. */
export function App() {
  const [status, setStatus] = useState('연결 중…');

  useEffect(() => {
    let alive = true;
    void connect().then(() => {
      if (!alive) return;
      setStatus(S.connection === 'connected' ? '연결됨 · id=' + S.meId : '연결 실패');
    });
    return () => {
      alive = false;
      S.socket?.disconnect();
    };
  }, []);

  return <div style={{ padding: 16, fontFamily: 'system-ui' }}>{status}</div>;
}

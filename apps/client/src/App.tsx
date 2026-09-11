import { boot } from '@/features/app/boot';
import { Shell } from '@/features/ui/Shell';
import { useEffect, useRef } from 'react';

/**
 * 화면 뼈대를 그리고, 마운트된 뒤 조립점을 돌린다.
 * `canvas#gl` 을 `Shell` 이 그리므로 부팅은 마운트 뒤여야 한다.
 *
 * StrictMode 는 쓰지 않는다(`main.tsx`). 이펙트가 두 번 돌면 소켓 리스너와
 * 입력 리스너가 두 벌 붙는다 — 그래도 한 번만 돌도록 여기서 막아 둔다.
 */
export function App() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void boot();
  }, []);

  return <Shell />;
}

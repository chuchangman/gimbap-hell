import { App } from '@/App';
/* 레거시 public/css/style.css 618줄을 그대로 옮겨 왔다.
   Tailwind 로 다시 쓰지 않는다 — 발표용 화면이라 픽셀이 같아야 한다. */
import '@/styles/style.css';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('app')!).render(<App />);

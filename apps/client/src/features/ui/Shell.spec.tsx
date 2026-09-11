import { Shell } from '@/features/ui/Shell';
import { collectIds, countElements, describeElement } from '@/testing/dom-snapshot';
import { firstDifference } from '@/testing/mesh-snapshot';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LEGACY_CUSTOMIZE_JS from '../../../../../public/js/customize.js?raw';
import LEGACY_UI_JS from '../../../../../public/js/ui.js?raw';
/* 레거시 화면 그 자체를 읽어 비교한다. 손으로 옮겨 적으면 검사가 무의미하다. */
import INDEX_HTML from '../../../../../public/index.html?raw';

/* ────────────────────────────────────────────────────────────
   화면 뼈대 동등성 검사

   `ui.js` 는 화면을 id 로 잡아 innerHTML 로 칠한다. 뼈대가 한 군데라도
   어긋나면 조용히 죽거나 CSS 가 안 걸린다 — 레거시 <body> 와 React 가
   그린 트리를 태그 · 속성 · 글자까지 통째로 대조한다.
   ──────────────────────────────────────────────────────────── */

function legacyBody(): Element {
  const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
  // 모듈은 Vite 가 넣는다 — 레거시의 <script> 세 줄은 비교 대상이 아니다
  for (const s of doc.body.querySelectorAll('script')) s.remove();
  return doc.body;
}

function reactShell(): Element {
  const { container } = render(<Shell />);
  return container;
}

describe('화면 뼈대 — 레거시 index.html 동등성', () => {
  const legacy = describeElement(legacyBody());
  const mine = describeElement(reactShell());

  it('양쪽 모두 실제로 들어찬다 (빈 트리끼리면 비교가 무의미하다)', () => {
    expect(countElements(legacy)).toBeGreaterThan(150);
    expect(countElements(mine)).toBe(countElements(legacy));
  });

  it('id 가 하나도 빠지거나 늘지 않는다', () => {
    // 순서까지 같아야 한다 — 문서 순서가 곧 겹침 순서다
    expect(collectIds(mine)).toEqual(collectIds(legacy));
    expect(collectIds(legacy).length).toBeGreaterThan(40);
  });

  it('태그 · 속성 · 글자까지 레거시와 같다', () => {
    expect(firstDifference(mine.children, legacy.children)).toBe(null);
  });
});

/* ────────────────────────────────────────────────────────────
   레거시 스크립트가 잡는 자리가 전부 있는지

   위 비교가 통과해도 "레거시 <body> 를 옳게 옮겼다" 일 뿐이다.
   실제로 중요한 건 `ui.js` · `customize.js` 가 부르는 선택자가
   새 뼈대에서 찾아지는가다 — 소스에서 선택자를 그대로 긁어 확인한다.
   ──────────────────────────────────────────────────────────── */

function selectorsIn(source: string): string[] {
  const found = new Set<string>();
  // $('#hud') · $$('.screen') · querySelector('.customize') · getElementById('cz-canvas')
  for (const m of source.matchAll(/\$\$?\(\s*'([^']+)'/g)) found.add(m[1]);
  for (const m of source.matchAll(/querySelector(?:All)?\(\s*'([^']+)'/g)) found.add(m[1]);
  for (const m of source.matchAll(/getElementById\(\s*'([^']+)'/g)) found.add('#' + m[1]);
  // 첫 인자가 선택자가 아닌 것들(이벤트 이름 등)은 # . [ 로 시작하지 않는다
  return [...found].filter((s) => /^[#.[]/.test(s));
}

describe('레거시 스크립트가 잡는 자리', () => {
  const selectors = [
    ...new Set([...selectorsIn(LEGACY_UI_JS), ...selectorsIn(LEGACY_CUSTOMIZE_JS)]),
  ];

  it('선택자를 실제로 긁어냈다 (0개면 정규식이 헛돈 것이다)', () => {
    expect(selectors.length).toBeGreaterThan(40);
    expect(selectors).toContain('#hud');
    expect(selectors).toContain('.customize');
    expect(selectors).toContain('#cz-canvas');
  });

  /* 런타임에 칠해지는 안쪽을 가리키는 선택자는 빈 뼈대에 있을 수 없다.
     조용히 늘어나지 않게 목록을 고정해 둔다 — 부모는 아래에서 확인한다. */
  const RUNTIME_ONLY = ['#player-list li'];

  it('런타임 전용 선택자는 이 둘뿐이다', () => {
    expect(selectors.filter((s) => s.includes(' '))).toEqual(RUNTIME_ONLY);
  });

  it('모두 새 뼈대에서 찾아진다', () => {
    // testing-library 가 테스트마다 정리하므로 이 테스트 안에서 그린다
    const root = reactShell();
    const missing = selectors
      .filter((s) => !RUNTIME_ONLY.includes(s))
      .filter((s) => !root.querySelector(s));
    expect(missing).toEqual([]);
    // 런타임에 칠할 자리의 부모는 있어야 한다
    expect(root.querySelector('#player-list')).not.toBeNull();
  });
});

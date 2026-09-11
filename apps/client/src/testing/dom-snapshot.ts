/* 레거시 index.html 과 React 뼈대가 같은 화면인지 보려면 문자열이 아니라
   트리로 봐야 한다. 태그 · 속성 · 글자를 뽑아 deepEqual 로 비교한다.

   요소 사이의 "공백만 있는" 글자 마디는 버린다. HTML 은 태그 사이 줄바꿈이
   글자 마디로 남지만 JSX 는 지운다 — 그 차이가 화면에 나타나려면 그 자리가
   인라인 흐름이어야 한다. 레거시에서 그런 자리(`.room-code` · `.rep` ·
   `.overlay-head` · `.connection-status` · `.join-row` · `.cz-view-controls` ·
   `.hud-top` · `.player-list li` · `.score-hero`)는 style.css 에서 전부
   `display: flex` 라, 공백 마디가 익명 아이템이 되지 않고 사라진다.
   글자가 섞인 마디(` 점` 처럼)는 그대로 비교한다. */

export interface DescribedElement {
  tag: string;
  attrs: Record<string, string>;
  children: Array<DescribedElement | string>;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ');

const isBr = (v: DescribedElement | string | undefined): boolean =>
  typeof v === 'object' && v.tag === 'br';

export function describeElement(el: Element): DescribedElement {
  const attrs: Record<string, string> = {};
  for (const a of [...el.attributes].sort((x, y) => x.name.localeCompare(y.name)))
    attrs[a.name] = collapse(a.value).trim();

  /* 붙어 있는 글자 마디는 하나로 합친다 — HTML 은 한 마디인 것을
     React 가 여러 마디로 쪼개 놓기도 한다. */
  const parts: Array<DescribedElement | string> = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') parts.push(collapse(text));
    text = '';
  };
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      text += node.textContent ?? '';
      continue;
    }
    // 주석은 화면에 없다
    if (node.nodeType !== 1) continue;
    flush();
    parts.push(describeElement(node as Element));
  }
  flush();

  /* 줄이 시작하고 끝나는 자리의 공백은 렌더링되지 않는다 (CSS 줄상자 다듬기).
     요소의 처음·끝과 `<br>` 양옆이 그 자리다 — 잘라내고 비교한다.
     그래야 `<br />` 뒤 줄바꿈이 JSX 와 HTML 에서 다르게 남는 걸로
     헛된 차이가 나지 않는다. 가운데 공백은 그대로 둔다. */
  const children: Array<DescribedElement | string> = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (typeof part !== 'string') {
      children.push(part);
      continue;
    }
    let t = part;
    if (i === 0 || isBr(parts[i - 1])) t = t.replace(/^ /, '');
    if (i === parts.length - 1 || isBr(parts[i + 1])) t = t.replace(/ $/, '');
    // 공백만 남은 마디는 버린다 (맨 위 주석 — 그 자리는 전부 flex 다)
    if (t.trim() !== '') children.push(t);
  }
  return { tag: el.tagName.toLowerCase(), attrs, children };
}

/** 트리에 든 요소 수 — 검사가 빈 트리끼리 비교하고 있지 않은지 본다 */
export function countElements(d: DescribedElement): number {
  let n = 1;
  for (const c of d.children) if (typeof c !== 'string') n += countElements(c);
  return n;
}

/** 트리 안의 모든 id — 어느 쪽에 무엇이 빠졌는지 바로 보려고 쓴다 */
export function collectIds(d: DescribedElement, out: string[] = []): string[] {
  if (d.attrs.id) out.push(d.attrs.id);
  for (const c of d.children) if (typeof c !== 'string') collectIds(c, out);
  return out;
}

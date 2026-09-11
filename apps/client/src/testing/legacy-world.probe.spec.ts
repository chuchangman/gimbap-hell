import { describe, expect, it } from 'vitest';

/* 탐침: 레거시 world.js 를 jsdom 에서 읽을 수 있는가?
   읽을 수 있어야 이식본을 그것과 대조할 수 있다.
   읽지 못하면 검증 전략을 다시 짜야 한다. */
describe('레거시 world.js 로딩 가능성', () => {
  it('import 되고 주요 export 가 보인다', async () => {
    const legacy = (await import('@legacy/world.js')) as Record<string, unknown>;
    expect(typeof legacy.makeItemMesh).toBe('function');
    expect(typeof legacy.previewBody).toBe('function');
    expect(legacy.scene).toBeTruthy();
    expect(Array.isArray(legacy.interactables)).toBe(true);
  });

  it('makeItemMesh 를 실제로 호출할 수 있다', async () => {
    const legacy = await import('@legacy/world.js');
    for (const item of [
      { id: 'gim', stage: 'raw', quality: 100 },
      { id: 'rice', stage: 'washed', quality: 100 },
      { id: 'ham', stage: 'done', quality: 80 },
      { id: 'ham', stage: 'burnt', quality: 0 },
      { id: 'broom', stage: 'done', quality: 100 },
      { id: 'gimbap', stage: 'done', quality: 90, fills: [{ id: 'ham', quality: 80 }] },
    ]) {
      const mesh = legacy.makeItemMesh(item);
      expect(mesh, JSON.stringify(item)).toBeTruthy();
    }
  });

  it('previewBody 를 실제로 호출할 수 있다 (캔버스 없이)', async () => {
    const legacy = await import('@legacy/world.js');
    const body = legacy.previewBody({
      h: 0,
      hc: 0,
      f: 0,
      t: 1,
      tc: 0,
      b: 0,
      bc: 0,
      e: 1,
      sc: 0,
      shc: 0,
    });
    expect(body).toBeTruthy();
    legacy.disposePreviewBody(body);
  });
});

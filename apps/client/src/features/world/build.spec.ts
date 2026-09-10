import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/* 레거시 initWorld 는 WebGLRenderer 를 먼저 만든다. jsdom 에는 WebGL 이 없으니
   렌더러만 가짜로 바꾼다 — initWorld 가 쓰는 것은 setPixelRatio · toneMapping ·
   shadowMap · setSize · render 뿐이라 씬 구축에는 영향이 없다. */
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeRenderer {
    domElement: unknown = {};
    shadowMap = { enabled: false };
    info = { memory: { geometries: 0, textures: 0 }, render: { calls: 0, triangles: 0 } };
    toneMapping = 0;
    toneMappingExposure = 1;
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

const legacyMod = await import('@legacy/world.js');
const { buildWorld } = await import('@/features/world/build');
const { scene: mineScene } = await import('@/features/world/scene');
const { interactables: mineInteractables } = await import('@/features/world/scene');
const { describeObject, countMeshes } = await import('@/testing/mesh-snapshot');

/* 방과 설비를 통째로 지어 놓고 레거시와 씬 트리를 비교한다.
   800줄 가까운 기하 코드를 눈으로 확인할 방법은 없다 — 정점으로 본다. */

describe('방 · 설비 씬 구축', () => {
  beforeAll(() => {
    legacyMod.initWorld(document.createElement('canvas'));
    buildWorld();
  });

  it('두 씬은 서로 다른 객체다 (같으면 비교가 자기 자신과의 비교다)', () => {
    expect(mineScene).not.toBe(legacyMod.scene);
    expect(mineInteractables).not.toBe(legacyMod.interactables);
  });

  it('실제로 씬이 들어찬다 (양쪽이 나란히 비면 비교가 무의미하다)', () => {
    expect(countMeshes(mineScene)).toBeGreaterThan(300);
    expect(countMeshes(legacyMod.scene)).toBeGreaterThan(300);
    // 얼마나 되는지 기록해 둔다 — 나중에 확 줄면 뭔가 빠진 것이다
    expect(countMeshes(mineScene)).toBe(countMeshes(legacyMod.scene));
  });

  it('씬 트리가 레거시와 정점까지 같다', () => {
    expect(describeObject(mineScene)).toEqual(describeObject(legacyMod.scene));
  });

  it('배경색과 안개가 레거시와 같다', () => {
    expect((mineScene.background as THREE.Color).getHexString()).toBe(
      (legacyMod.scene.background as THREE.Color).getHexString(),
    );
    const mine = mineScene.fog as THREE.Fog;
    const theirs = legacyMod.scene.fog as THREE.Fog;
    expect([mine.color.getHexString(), mine.near, mine.far]).toEqual([
      theirs.color.getHexString(),
      theirs.near,
      theirs.far,
    ]);
  });

  it('조준 가능한 설비가 레거시와 같은 순서·같은 데이터로 등록된다', () => {
    expect(mineInteractables.length).toBe(legacyMod.interactables.length);
    expect(mineInteractables.map((m) => m.userData.station)).toEqual(
      legacyMod.interactables.map((m) => m.userData.station),
    );
    // 설비 9종이 모두 있어야 한다
    const kinds = new Set(
      mineInteractables.map((m) => (m.userData.station as { kind?: string }).kind),
    );
    for (const kind of [
      'fridge',
      'sink',
      'cooker',
      'burner',
      'board',
      'mat',
      'bin',
      'broom',
      'serve',
    ])
      expect(kinds, kind).toContain(kind);
  });

  it('그림자는 어느 메시에도 켜져 있지 않다', () => {
    let shadowed = 0;
    mineScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o.castShadow || o.receiveShadow)) shadowed++;
    });
    expect(shadowed).toBe(0);
  });
});

import * as legacy from '@legacy/assets.js';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetAssets, asset, checkContract, hasAsset, loadedAssets, partOf } from './assets';
import { CONTRACT, CUSTOMER_CONTRACT } from './contract';

/* CONTRACT 는 항목 60여 개에 좌표 숫자가 200개 가까이 들어 있다.
   손으로 옮기면 한두 개는 반드시 틀린다 — 레거시와 통째로 대조해 고정한다. */

describe('CONTRACT', () => {
  it('레거시 규격과 항목·숫자가 모두 같다', () => {
    expect(CONTRACT).toEqual(legacy.CONTRACT);
  });

  it('항목 수가 줄지 않았다', () => {
    expect(Object.keys(CONTRACT).length).toBe(Object.keys(legacy.CONTRACT).length);
    expect(Object.keys(CONTRACT).length).toBeGreaterThan(50);
  });

  it('손님 모델 규격은 CONTRACT 에 없고 별도로 쓴다', () => {
    expect(CONTRACT['char/character-01']).toBeUndefined();
    expect(CUSTOMER_CONTRACT.parts).toContain('Head');
  });
});

describe('partOf', () => {
  it('이름으로 자식 노드를 찾고 없으면 null 을 준다', () => {
    const root = new THREE.Object3D();
    const child = new THREE.Object3D();
    child.name = 'lid';
    const deep = new THREE.Object3D();
    deep.name = 'water';
    child.add(deep);
    root.add(child);

    expect(partOf(root, 'lid')).toBe(child);
    expect(partOf(root, 'water')).toBe(deep);
    expect(partOf(root, 'nope')).toBe(null);
    expect(partOf(null, 'lid')).toBe(null);
    expect(partOf(undefined, 'lid')).toBe(null);
  });

  it('레거시와 같은 노드를 고른다', () => {
    const build = () => {
      const root = new THREE.Object3D();
      for (const name of ['a', 'b', 'a']) {
        const o = new THREE.Object3D();
        o.name = name;
        root.add(o);
      }
      return root;
    };
    const mine = build();
    const theirs = build();
    // 같은 이름이 둘일 때 먼저 만난 것을 고르는지 (traverse 순서)
    expect(partOf(mine, 'a')).toBe(mine.children[0]);
    expect(legacy.partOf(theirs, 'a')).toBe(theirs.children[0]);
  });
});

describe('checkContract', () => {
  /* 스파이는 매 테스트마다 새로 건다. describe 본문에서 한 번만 걸면
     첫 afterEach 의 restoreAllMocks 가 되돌려 버려 두 번째부터 죽는다. */
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 규격에 맞는 크기의 박스 하나 */
  const boxOf = (size: [number, number, number], parts: string[] = []) => {
    const root = new THREE.Object3D();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]));
    root.add(mesh);
    for (const name of parts) {
      const o = new THREE.Object3D();
      o.name = name;
      root.add(o);
    }
    return root;
  };

  it('규격에 없는 이름은 경고한다', () => {
    checkContract('nope/whatever', new THREE.Object3D());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('규격에 없는 이름');
  });

  it('부품이 빠지면 오류로 알린다', () => {
    checkContract('station/cooker', boxOf([1.3, 1.45, 2.1]));
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('lid');
  });

  it('부품이 다 있고 크기가 맞으면 아무 말도 안 한다', () => {
    checkContract('station/cooker', boxOf([1.3, 1.45, 2.1], ['lid']));
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('크기가 두 배 넘게 어긋나면 경고하고, 그 안이면 넘어간다', () => {
    // 규격 [1.05, 0.07, 0.85] — x 를 3배로
    checkContract('station/board', boxOf([3.2, 0.07, 0.85]));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('x');

    warn.mockClear();
    // 1.9배는 허용 범위 안이다
    checkContract('station/board', boxOf([1.99, 0.07, 0.85]));
    expect(warn).not.toHaveBeenCalled();
  });

  it('손님 모델 이름은 별도 규격으로 검사한다', () => {
    checkContract('char/character-01', boxOf([1.9, 2.04, 0.55]));
    // 부품이 하나도 없으니 오류가 나야 한다 — 규격에 없는 이름 경고가 아니라
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('Head');
  });
});

describe('asset', () => {
  beforeEach(() => {
    __resetAssets();
  });

  it('모델이 없으면 build() 가 만든 것을 그대로 준다', () => {
    const made = new THREE.Object3D();
    expect(hasAsset('item/gim')).toBe(false);
    expect(asset('item/gim', () => made)).toBe(made);
    expect(loadedAssets()).toEqual([]);
  });
});

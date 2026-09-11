import { makeItemMesh } from '@/features/world/items';
import { countMeshes, describeObject } from '@/testing/mesh-snapshot';
import * as legacy from '@legacy/world.js';
import type { HeldItem } from '@repo/game-core';
import { describe, expect, it } from 'vitest';

/* 손에 드는 것 · 김밥 · 속재료를 레거시와 같은 입력으로 만들고
   메시 트리를 통째로 비교한다 — 좌표 · 회전 · 배율 · 지오메트리 정점 ·
   재질 색까지 전부. 눈으로 보는 대신 값으로 본다. */

const item = (id: string, stage: string, fills?: { id: string; quality: number }[]): HeldItem =>
  ({ uid: 1, id, stage, quality: 100, ...(fills ? { fills } : {}) }) as unknown as HeldItem;

const FILL_IDS = [
  'danmuji',
  'ham',
  'spinach',
  'crab',
  'cucumber',
  'egg',
  'carrot',
  'fishcake',
] as const;

/** 레거시와 이식본에 같은 것을 만들게 하고 트리를 비교한다 */
function sameMesh(build: (make: (i: HeldItem | null) => unknown) => unknown, label: string) {
  const mine = describeObject(build(makeItemMesh as never) as never);
  const theirs = describeObject(build(legacy.makeItemMesh as never) as never);
  expect(mine, label).toEqual(theirs);
  return mine;
}

describe('makeItemMesh', () => {
  it('아무것도 없으면 빈 그룹이다', () => {
    expect(describeObject(makeItemMesh(null))).toEqual(describeObject(legacy.makeItemMesh(null)));
    expect(countMeshes(makeItemMesh(null))).toBe(0);
  });

  it('손질 끝난 속재료 8종이 레거시와 같다', () => {
    for (const id of FILL_IDS) {
      const built = makeItemMesh(item(id, 'done'));
      expect(describeObject(built), id + ' done').toEqual(
        describeObject(legacy.makeItemMesh(item(id, 'done'))),
      );
      // 정말로 뭔가 만들어졌는지 — 빈 그룹끼리 비교하면 의미가 없다
      expect(countMeshes(built), id + ' 메시 수').toBeGreaterThan(0);
    }
  });

  it('탄 속재료도 레거시와 같은 색으로 어두워진다', () => {
    for (const id of FILL_IDS) {
      expect(describeObject(makeItemMesh(item(id, 'burnt'))), id + ' burnt').toEqual(
        describeObject(legacy.makeItemMesh(item(id, 'burnt'))),
      );
    }
    // 탄 것과 안 탄 것은 실제로 달라야 한다
    expect(describeObject(makeItemMesh(item('ham', 'burnt')))).not.toEqual(
      describeObject(makeItemMesh(item('ham', 'done'))),
    );
  });

  it('손질 전 원물 7종이 레거시와 같다 (맛살은 raw 여도 완성 형태)', () => {
    for (const id of FILL_IDS) {
      const built = makeItemMesh(item(id, 'raw'));
      expect(describeObject(built), id + ' raw').toEqual(
        describeObject(legacy.makeItemMesh(item(id, 'raw'))),
      );
      expect(countMeshes(built), id + ' raw 메시 수').toBeGreaterThan(0);
    }
    // 맛살만 raw 와 done 이 같은 형태다
    expect(describeObject(makeItemMesh(item('crab', 'raw')))).toEqual(
      describeObject(makeItemMesh(item('crab', 'done'))),
    );
    // 나머지는 raw 와 done 이 달라야 한다
    expect(describeObject(makeItemMesh(item('ham', 'raw')))).not.toEqual(
      describeObject(makeItemMesh(item('ham', 'done'))),
    );
  });

  it('김 · 쌀(마른/씻은) · 밥 · 빗자루가 레거시와 같다', () => {
    for (const [id, stage] of [
      ['gim', 'raw'],
      ['rice', 'raw'],
      ['rice', 'washed'],
      ['bap', 'done'],
      ['broom', 'done'],
    ] as const) {
      const built = makeItemMesh(item(id, stage));
      expect(describeObject(built), id + '/' + stage).toEqual(
        describeObject(legacy.makeItemMesh(item(id, stage))),
      );
      expect(countMeshes(built), id + ' 메시 수').toBeGreaterThan(0);
    }
    // 씻은 쌀에는 물 표면이 하나 더 있다
    expect(countMeshes(makeItemMesh(item('rice', 'washed')))).toBeGreaterThan(
      countMeshes(makeItemMesh(item('rice', 'raw'))),
    );
  });

  it('만 김밥과 완성 김밥이 속재료 조합대로 레거시와 같다', () => {
    const combos: { id: string; quality: number }[][] = [
      [],
      [{ id: 'ham', quality: 80 }],
      [
        { id: 'danmuji', quality: 100 },
        { id: 'ham', quality: 90 },
        { id: 'spinach', quality: 70 },
      ],
      [
        { id: 'danmuji', quality: 100 },
        { id: 'ham', quality: 90 },
        { id: 'spinach', quality: 70 },
        { id: 'crab', quality: 60 },
        { id: 'egg', quality: 50 },
        { id: 'carrot', quality: 40 },
        { id: 'fishcake', quality: 30 },
      ],
    ];
    for (const fills of combos) {
      for (const id of ['roll', 'gimbap']) {
        const built = makeItemMesh(item(id, 'done', fills));
        expect(describeObject(built), id + ' ' + fills.length + '종').toEqual(
          describeObject(legacy.makeItemMesh(item(id, 'done', fills))),
        );
        expect(countMeshes(built), id + ' 메시 수').toBeGreaterThan(5);
      }
    }
    // 속이 다르면 결과도 달라야 한다
    expect(
      describeObject(makeItemMesh(item('gimbap', 'done', [{ id: 'ham', quality: 80 }]))),
    ).not.toEqual(
      describeObject(makeItemMesh(item('gimbap', 'done', [{ id: 'egg', quality: 80 }]))),
    );
  });

  it('모르는 id 는 레거시와 같은 회색 상자를 준다', () => {
    expect(describeObject(makeItemMesh(item('nope', 'done')))).toEqual(
      describeObject(legacy.makeItemMesh(item('nope', 'done'))),
    );
  });

  it('sameMesh 헬퍼가 실제로 트리를 비교한다', () => {
    const built = sameMesh((make) => make(item('gimbap', 'done')), 'gimbap');
    expect(built.children.length).toBeGreaterThan(5);
  });
});

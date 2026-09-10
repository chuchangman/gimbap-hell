import { animatePreviewBody, previewBody } from '@/features/world/character';
import { countMeshes, describeObject } from '@/testing/mesh-snapshot';
import * as legacy from '@legacy/world.js';
import { DEFAULT_LOOK, PART_COLORS, PARTS, type Look } from '@repo/game-core';
import { describe, expect, it } from 'vitest';

/* 캐릭터는 조합이 많다 — 머리 9 · 얼굴 5 · 표정 8 · 상의 6 · 하의 3 에
   색 팔레트까지 곱해진다. previewBody 가 makeBody · makeFace · buildHair ·
   buildTop · buildFaceStyle · applyLook · characterMood 를 모두 타므로,
   조합을 바꿔가며 레거시와 메시 트리를 통째로 비교한다. */

const look = (over: Partial<Look>): Look => ({ ...DEFAULT_LOOK, ...over });

/** 한 축만 바꿔가며 만든 조합 목록 */
function lookMatrix(): { label: string; look: Partial<Look> | null }[] {
  const out: { label: string; look: Partial<Look> | null }[] = [];
  PARTS.hair.forEach((p, h) => out.push({ label: 'hair=' + p.id, look: look({ h }) }));
  PARTS.face.forEach((p, f) => out.push({ label: 'face=' + p.id, look: look({ f }) }));
  PARTS.expression.forEach((p, e) => out.push({ label: 'expr=' + p.id, look: look({ e }) }));
  PARTS.top.forEach((p, t) => out.push({ label: 'top=' + p.id, look: look({ t }) }));
  PARTS.bottom.forEach((p, b) => out.push({ label: 'bottom=' + p.id, look: look({ b }) }));
  PART_COLORS.hair.forEach((_c, hc) => out.push({ label: 'hairColor=' + hc, look: look({ hc }) }));
  PART_COLORS.skin.forEach((_c, sc) => out.push({ label: 'skin=' + sc, look: look({ sc }) }));
  PART_COLORS.shoes.forEach((_c, shc) => out.push({ label: 'shoes=' + shc, look: look({ shc }) }));
  return out;
}

describe('previewBody', () => {
  it('기본 조합이 레거시와 정점까지 같다', () => {
    const mine = previewBody(DEFAULT_LOOK);
    const theirs = legacy.previewBody(DEFAULT_LOOK);
    expect(describeObject(mine)).toEqual(describeObject(theirs));
    // 실제로 몸이 만들어졌는지 — 빈 그룹끼리 비교하면 의미가 없다
    expect(countMeshes(mine)).toBeGreaterThan(10);
  });

  it('머리 · 얼굴 · 표정 · 상하의 · 색을 한 축씩 바꿔도 레거시와 같다', () => {
    for (const { label, look: L } of lookMatrix()) {
      expect(describeObject(previewBody(L)), label).toEqual(describeObject(legacy.previewBody(L)));
    }
  });

  it('조합을 섞어도 레거시와 같다', () => {
    const combos: Partial<Look>[] = [
      { h: 5, hc: 3, f: 1, t: 3, tc: 5, b: 2, bc: 4, e: 6, sc: 2, shc: 3 },
      { h: 8, hc: 0, f: 4, t: 0, tc: 0, b: 0, bc: 0, e: 0, sc: 6, shc: 4 },
      { h: 6, hc: 5, f: 2, t: 5, tc: 7, b: 1, bc: 7, e: 3, sc: 4, shc: 1 },
    ];
    for (const L of combos) {
      expect(describeObject(previewBody(L)), JSON.stringify(L)).toEqual(
        describeObject(legacy.previewBody(L)),
      );
    }
  });

  it('망가진 조합도 레거시와 같이 정리된다', () => {
    const bad: unknown[] = [
      null,
      undefined,
      {},
      { h: -1, hc: 999, f: 1.9, t: '2', tc: NaN, b: null, bc: Infinity, e: 3, sc: 4, shc: 2 },
    ];
    for (const L of bad) {
      expect(describeObject(previewBody(L as Partial<Look>)), JSON.stringify(L)).toEqual(
        describeObject(legacy.previewBody(L)),
      );
    }
  });

  it('서로 다른 조합은 실제로 다른 몸을 만든다', () => {
    // 같은 결과만 나오면 위 비교가 전부 무의미하다
    expect(describeObject(previewBody(look({ h: 0 })))).not.toEqual(
      describeObject(previewBody(look({ h: 5 }))),
    );
    expect(describeObject(previewBody(look({ e: 0 })))).not.toEqual(
      describeObject(previewBody(look({ e: 5 }))),
    );
    expect(describeObject(previewBody(look({ t: 0 })))).not.toEqual(
      describeObject(previewBody(look({ t: 3 }))),
    );
  });
});

describe('animatePreviewBody', () => {
  it('걷기 · 들기 자세가 시간에 따라 레거시와 같이 움직인다', () => {
    for (const walking of [false, true]) {
      for (const holding of [false, true]) {
        const mine = previewBody(DEFAULT_LOOK);
        const theirs = legacy.previewBody(DEFAULT_LOOK);
        for (const seconds of [0, 0.1, 0.37, 1, 2.5, 10]) {
          animatePreviewBody(mine, seconds, walking, holding);
          legacy.animatePreviewBody(theirs, seconds, walking, holding);
          const label = 'walk=' + walking + ' hold=' + holding + ' t=' + seconds;
          expect(describeObject(mine), label).toEqual(describeObject(theirs));
        }
      }
    }
  });

  it('걸으면 실제로 자세가 바뀐다', () => {
    const still = previewBody(DEFAULT_LOOK);
    const walker = previewBody(DEFAULT_LOOK);
    animatePreviewBody(still, 0.5, false, false);
    animatePreviewBody(walker, 0.5, true, false);
    expect(describeObject(still)).not.toEqual(describeObject(walker));
  });
});

/* ────────────────────────────────────────────────────────────
   지오메트리 공유

   같은 크기 상자와 같은 색을 쓰는 메시가 수백 개인데 전부 제 것을 따로
   들고 있었다 — 메시 510개에 재질 510개, 지오메트리 510개.
   모양이 같으면 지오메트리를 하나로 같이 쓴다.

   ⚠ 공유하면 dispose() 가 위험해진다 — 아직 그 자원을 쓰는 메시가 깨진다.
     disposeObject 가 공유 자원은 건너뛴다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from 'three';

const geoCache = new Map<string, THREE.BufferGeometry>();

/* ────────────────────────────────────────────────────────────
   모서리 깎은 상자

   그냥 BoxGeometry 를 쓰면 모서리가 완벽한 90도라, 어느 각도에서 봐도
   면과 면 사이가 한 픽셀 선으로만 갈린다. 로우폴리 렌더가 또렷해 보이는 건
   모서리를 살짝 깎아 그 자리에 좁은 면이 하나 더 생기고,
   그 면이 주광을 받아 밝은 테두리처럼 빛나기 때문이다.

   만드는 법 — 면마다 안으로 물린 네 귀퉁이, 모두 24점.
   그 볼록 껍질이 곧 깎인 상자다.
   껍질의 삼각형 연결은 크기와 무관하게 늘 같으므로 딱 한 번만 구해 돌려 쓴다.
   ──────────────────────────────────────────────────────────── */
/** 깎는 폭 (m). 너무 크면 둥근 비누처럼 보인다 */
export const BEVEL = 0.012;
/** 한 번 구한 삼각형 연결 */
let bevelIndex: number[] | null = null;

type Point3 = [number, number, number];

/** 면마다 안으로 물린 24점 */
export function bevelPoints(w: number, h: number, d: number): Point3[] {
  const b = Math.min(BEVEL, Math.min(w, h, d) * 0.28);
  const H = [w / 2, h / 2, d / 2];
  const P: Point3[] = [];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const sn of [-1, 1])
      for (const su of [-1, 1])
        for (const sv of [-1, 1]) {
          const p: Point3 = [0, 0, 0];
          p[a] = sn * H[a];
          p[u] = su * (H[u] - b);
          p[v] = sv * (H[v] - b);
          P.push(p);
        }
  }
  return P;
}

/** 24점의 볼록 껍질 — 한 평면에 놓인 점은 모아서 한 번만 부채꼴로 자른다 */
export function bevelHull(P: Point3[]): number[] {
  const n = P.length;
  const sub = (a: Point3, c: Point3): Point3 => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const cross = (a: Point3, c: Point3): Point3 => [
    a[1] * c[2] - a[2] * c[1],
    a[2] * c[0] - a[0] * c[2],
    a[0] * c[1] - a[1] * c[0],
  ];
  const dot = (a: Point3, c: Point3): number => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];

  const planes = new Map<string, { nv: Point3; off: number }>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        let nv = cross(sub(P[j], P[i]), sub(P[k], P[i]));
        const L = Math.hypot(nv[0], nv[1], nv[2]);
        if (L < 1e-9) continue;
        nv = [nv[0] / L, nv[1] / L, nv[2] / L];
        let hi = 0;
        let lo = 0;
        for (let m = 0; m < n; m++) {
          const s = dot(nv, sub(P[m], P[i]));
          if (s > 1e-7) hi++;
          else if (s < -1e-7) lo++;
          if (hi && lo) break;
        }
        if (hi && lo) continue; // 바깥 면이 아니다
        if (hi) nv = [-nv[0], -nv[1], -nv[2]]; // 법선을 바깥으로
        const off = dot(nv, P[i]);
        const key = nv.map((x) => x.toFixed(4)).join(',') + '|' + off.toFixed(4);
        if (!planes.has(key)) planes.set(key, { nv, off });
      }

  const idx: number[] = [];
  for (const { nv, off } of planes.values()) {
    const on: number[] = [];
    for (let m = 0; m < n; m++) if (Math.abs(dot(nv, P[m]) - off) < 1e-6) on.push(m);
    if (on.length < 3) continue;
    const c: Point3 = [0, 0, 0];
    for (const m of on) for (let t = 0; t < 3; t++) c[t] += P[m][t] / on.length;
    let ux = sub(P[on[0]], c);
    const uL = Math.hypot(ux[0], ux[1], ux[2]);
    ux = [ux[0] / uL, ux[1] / uL, ux[2] / uL];
    const vy = cross(nv, ux);
    on.sort((a, c2) => {
      const pa = sub(P[a], c);
      const pb = sub(P[c2], c);
      return Math.atan2(dot(pa, vy), dot(pa, ux)) - Math.atan2(dot(pb, vy), dot(pb, ux));
    });
    for (let t = 1; t < on.length - 1; t++) idx.push(on[0], on[t], on[t + 1]);
  }
  return idx;
}

/** 모서리 깎은 상자 지오메트리 */
export function bevelBoxGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const P = bevelPoints(w, h, d);
  if (!bevelIndex) bevelIndex = bevelHull(P); // 연결은 크기와 무관 — 최초 1회만
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(P.length * 3);
  for (let i = 0; i < P.length; i++) {
    arr[i * 3] = P[i][0];
    arr[i * 3 + 1] = P[i][1];
    arr[i * 3 + 2] = P[i][2];
  }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.setIndex(bevelIndex.slice());
  g.computeVertexNormals();
  return g;
}

export function sharedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

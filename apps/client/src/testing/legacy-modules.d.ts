/* 마이그레이션 기간에만 쓰는 레거시 모듈 선언.
 *
 * 동등성 테스트가 읽는 public/js/*.js 에는 타입이 없다. 상대경로로 import 하면
 * strict 모드에서 TS7016 으로 막히고, 레거시 트리에 .d.ts 를 새로 만드는 건
 * 곧 지울 코드에 타입을 붙이는 일이다. 비상대 지정자 '@legacy/...' 로 부르면
 * 아래 선언이 적용되고, 실제 파일 연결은 vite.config 의 test.alias 가 한다
 * (테스트에서만 걸리고 앱 빌드에는 영향이 없다).
 *
 * 아래 목록이 곧 "동등성 테스트가 레거시의 어느 표면에 의존하는가" 다.
 * 5단계에서 레거시가 사라질 때 이 파일도 함께 사라진다. */

declare module '@legacy/assets.js' {
  import type { Object3D } from 'three';
  export const CONTRACT: Record<
    string,
    { size: [number, number, number]; origin: string; parts: string[] }
  >;
  export function partOf(root: Object3D | null | undefined, name: string): Object3D | null;
  export function hasAsset(name: string): boolean;
  export function asset(name: string, build: () => Object3D): Object3D;
  export function loadedAssets(): string[];
  export function preloadAssets(): Promise<void>;
}

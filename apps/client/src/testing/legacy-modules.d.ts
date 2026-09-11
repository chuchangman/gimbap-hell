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

declare module '@legacy/world.js' {
  import type { Object3D, PerspectiveCamera, Scene } from 'three';
  export const scene: Scene;
  export const camera: PerspectiveCamera;
  export const interactables: Object3D[];
  export function makeItemMesh(item: unknown): Object3D;
  export function previewBody(look: unknown): import('three').Group;
  export function animatePreviewBody(
    group: import('three').Group,
    seconds: number,
    walking?: boolean,
    holding?: boolean,
  ): void;
  export function disposePreviewBody(group: Object3D): void;
  export function initWorld(canvas: HTMLCanvasElement): void;
  export function render(swinging: boolean): void;
  export function stats(): Record<string, number> | null;
}

declare module '@legacy/customize.js' {
  export function initCustomizer(): void;
  export function currentLook(): Record<string, number>;
  export function stopCustomizer(): void;
}

declare module '@legacy/net.js' {
  /** 레거시 net.js 의 공유 상태. 동등성 테스트가 여기에 같은 스냅샷을 심는다. */
  export const S: Record<string, unknown>;
}

declare module '@legacy/kitchen.js' {
  export function resolveAction(st: unknown): Record<string, unknown> | null;
  export function focusNow(): { focusId: string | null; outline: Set<string>; held: boolean };
  export function serveTarget(): Record<string, unknown> | null;
  export function targetMatch(target: unknown): number | null;
  export function missingFills(i: number): string[];
  export function unlockedFills(): string[];
  export function bapReady(): { servings: number; cooking: number };
  export function cookerProgress(i: number): number;
  export function rollProgress(i: number): number;
  export function burnerInfo(slot: number): Record<string, unknown> | null;
  export function boardInfo(i: number): Record<string, unknown> | null;
  export function broomTaken(rack: number): boolean;
  export function matAt(i: number): Record<string, unknown> | null;
  export function sinkAt(): Record<string, unknown> | null;
  export function activeMat(): Record<string, unknown> | null;
  export function activeMatIndex(): number;
}

declare module '@legacy/player.js' {
  export const state: {
    target: unknown;
    prompt: { text?: string; disabled?: boolean; key?: string } | null;
    canvas: unknown;
    overlayOpen: boolean;
    enabled: boolean;
    onToggleHelp: () => void;
    onCloseOverlay: () => void;
  };
  export function initPlayer(canvas: HTMLCanvasElement): void;
  export function updatePlayer(dt: number): void;
  export function resetPose(spawn?: unknown): void;
  export function correctPose(pose: unknown): void;
  export function setLook(y: number, p: number): void;
  export function getPose(): { x: number; z: number; yaw: number; pitch: number };
  export function applyKnockback(dirX: number, dirZ: number, power: number): void;
  export function isSwinging(): boolean;
  export function releaseLock(): void;
  export function isLocked(): boolean;
}

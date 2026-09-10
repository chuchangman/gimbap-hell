import { scene } from '@/features/world/scene';
import * as THREE from 'three';

/* 캔버스 텍스처 라벨/게이지
   그릴 내용이 바뀌지 않으면 캔버스도 텍스처도 건드리지 않는다.
   (안 그러면 매 프레임 GPU 로 텍스처를 다시 올린다)

   레거시 world.js 310-495 줄을 그대로 옮겼다. */

export interface TextOptions {
  color?: string;
  bg?: string | false;
  scale?: number;
}

export class Panel {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  sprite: THREE.Sprite | THREE.Mesh;
  sig: string | null;

  /**
   * flat=true 면 빌보드가 아니라 고정 평면으로 만든다.
   * 벽·냉장고에 붙는 안내는 회전하면 몸통을 파고들어 잘리므로 평면이어야 한다.
   */
  constructor(w: number, h: number, scale: number, depthTest?: boolean, flat?: boolean) {
    this.cv = document.createElement('canvas');
    this.cv.width = w;
    this.cv.height = h;
    this.ctx = this.cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    if (flat) {
      this.sprite = new THREE.Mesh(
        new THREE.PlaneGeometry(scale, (scale * h) / w),
        new THREE.MeshBasicMaterial({
          map: this.tex,
          transparent: true,
          depthTest: !!depthTest,
          depthWrite: false,
        }),
      );
    } else {
      this.sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.tex,
          transparent: true,
          depthTest: !!depthTest,
        }),
      );
      this.sprite.scale.set(scale, (scale * h) / w, 1);
    }
    this.sprite.renderOrder = depthTest ? 5 : 10;
    this.sig = null;
  }
  clear() {
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
  }

  /** 주어진 폭에 들어가도록 글자 크기를 낮춰 잡는다 */
  fitFont(str: string, maxW: number, weight: string, baseSize: number): number {
    let size = baseSize;
    const set = () => {
      this.ctx.font = weight + ' ' + size + 'px system-ui, sans-serif';
    };
    set();
    while (size > 9 && this.ctx.measureText(str).width > maxW) {
      size -= 1;
      set();
    }
    return size;
  }

  text(str: string, opts?: TextOptions): void {
    const o = opts || {};
    const sig = 'T' + str + (o.color || '') + (o.bg || '');
    if (this.sig === sig) return;
    this.sig = sig;
    const ctx = this.ctx,
      W = this.cv.width,
      H = this.cv.height;
    this.clear();
    if (o.bg !== false) {
      ctx.fillStyle = o.bg || 'rgba(18,15,12,.82)';
      ctx.beginPath();
      ctx.roundRect(2, 2, W - 4, H - 4, 14);
      ctx.fill();
    }
    ctx.fillStyle = o.color || '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 캔버스를 넘치면 글자를 줄인다 — 어떤 문구가 와도 잘리지 않는다
    let size = Math.round(H * (o.scale || 0.44));
    const maxW = W - 16;
    ctx.font = '600 ' + size + 'px system-ui, sans-serif';
    while (size > 9 && ctx.measureText(str).width > maxW) {
      size -= 1;
      ctx.font = '600 ' + size + 'px system-ui, sans-serif';
    }
    ctx.fillText(str, W / 2, H / 2);
    this.tex.needsUpdate = true;
  }

  gauge(title: string, pct: number, color: string, sub?: string): void {
    // 1% 단위로만 다시 그린다 — 프레임마다 텍스처를 올리지 않기 위해
    const q = Math.round(Math.min(1, Math.max(0, pct)) * 100);
    const sig = 'G' + title + q + color + (sub || '');
    if (this.sig === sig) return;
    this.sig = sig;

    const ctx = this.ctx,
      W = this.cv.width,
      H = this.cv.height;
    this.clear();
    ctx.fillStyle = 'rgba(18,15,12,.86)';
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.fitFont(title, W - 16, '700', 30);
    ctx.fillText(title, W / 2, H * 0.3);
    const bx = 18,
      bw = W - 36,
      by = H * 0.52,
      bh = 18;
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 9);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(bx, by, Math.max(6, bw * (q / 100)), bh, 9);
    ctx.fill();
    if (sub) {
      ctx.fillStyle = '#d8c8ae';
      this.fitFont(sub, W - 16, '600', 23);
      ctx.fillText(sub, W / 2, H * 0.84);
    }
    this.tex.needsUpdate = true;
  }

  /** 주문 내용을 재료 이름으로 (손님 머리 위) */
  order(title: string, names: string, pct: number, color: string, sub?: string): void {
    const q = Math.round(Math.min(1, Math.max(0, pct)) * 100);
    const sig = 'O' + title + names + q + color + (sub || '');
    if (this.sig === sig) return;
    this.sig = sig;
    const ctx = this.ctx,
      W = this.cv.width,
      H = this.cv.height;
    this.clear();
    ctx.fillStyle = 'rgba(18,15,12,.88)';
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    this.fitFont(title, W - 16, '700', 24);
    ctx.fillText(title, W / 2, H * 0.17);

    // 재료 이름 — 폭에 맞춰 두 줄까지 접는다
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#ffe6b0';
    const words = String(names).split(' · ');
    const lines = [];
    let cur = '';
    for (const wd of words) {
      const test = cur ? cur + ' · ' + wd : wd;
      if (ctx.measureText(test).width > W - 28 && cur) {
        lines.push(cur);
        cur = wd;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    const show = lines.slice(0, 2);
    show.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.42 + i * 24 - (show.length - 1) * 12));

    const bx = 16,
      bw = W - 32,
      by = H * 0.74,
      bh = 13;
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 7);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(bx, by, Math.max(5, bw * (q / 100)), bh, 7);
    ctx.fill();
    if (sub) {
      ctx.fillStyle = '#d8c8ae';
      this.fitFont(sub, W - 16, '600', 21);
      ctx.fillText(sub, W / 2, H * 0.91);
    }
    this.tex.needsUpdate = true;
  }
}

export function stationPanel(
  scale: number,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D = scene,
): Panel {
  const panel = new Panel(256, 96, scale);
  panel.sprite.position.set(x, y, z);
  panel.sprite.visible = false;
  parent.add(panel.sprite);
  return panel;
}

/* 글자 폭을 재는 공용 캔버스 */
const scratch = document.createElement('canvas').getContext('2d')!;

/**
 * 글자가 들어갈 만큼 캔버스를 넓혀서 Panel 을 만든다.
 * 월드 폭도 같은 비율로 키우므로 글자 높이는 라벨마다 일정하게 유지된다.
 */
export function fittedPanel(
  text: string,
  worldWidth?: number,
  depthTest?: boolean,
  baseH?: number,
  flat?: boolean,
): Panel {
  const H = baseH || 64;
  const size = Math.round(H * 0.44);
  scratch.font = '600 ' + size + 'px system-ui, sans-serif';
  const need = scratch.measureText(String(text)).width + 34; // 좌우 여백
  const W = Math.max(256, Math.ceil(need / 32) * 32);
  return new Panel(W, H, (worldWidth || 0.9) * (W / 256), depthTest, flat);
}

/**
 * 벽·냉장고 같은 면에 붙이는 안내판.
 * 빌보드가 아니라 고정 평면이라 어느 각도에서 봐도 몸통에 파묻히지 않는다.
 *   rotY: 0 = +z 를 향함, PI/2 = +x, -PI/2 = -x, PI = -z
 */
export function wallLabel(
  text: string,
  rowHeight: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  color?: string,
  parent?: THREE.Object3D,
): Panel {
  const H = 64;
  scratch.font = '600 ' + Math.round(H * 0.44) + 'px system-ui, sans-serif';
  const need = scratch.measureText(String(text)).width + 30;
  const W = Math.max(160, Math.ceil(need / 16) * 16);
  // 세로 높이를 고정하고 가로는 글자 길이만큼 — 판마다 글자 크기가 같아진다
  const p = new Panel(W, H, rowHeight * (W / H), true, true);
  p.text(text, { color: color || '#fff' });
  p.sprite.position.set(x, y, z);
  p.sprite.rotation.y = rotY;
  (parent || scene).add(p.sprite);
  return p;
}

export function labelSprite(
  text: string,
  scale?: number,
  y?: number,
  parent?: THREE.Object3D,
  color?: string,
): Panel {
  const p = fittedPanel(text, scale || 0.9, true);
  p.text(text, { color: color || '#fff' });
  p.sprite.position.y = y ?? 0;
  (parent || scene).add(p.sprite);
  return p;
}

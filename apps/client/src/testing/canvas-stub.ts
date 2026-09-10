/* jsdom 에는 2D 캔버스가 없다 (node-canvas 를 깔지 않으면 getContext 가 null).
   레거시 world.js 의 Panel · wallLabel 은 글자 폭을 재서 캔버스 크기를 정하고,
   그 크기가 스프라이트 배율에 그대로 들어간다 — 컨텍스트가 없으면 씬 자체를
   못 짓는다.

   픽셀을 실제로 그릴 필요는 없다. 이식본과 레거시가 **같은 스텁**을 쓰므로
   measureText 가 결정적이기만 하면 양쪽 배율이 똑같이 나오고, 그게 대조에
   필요한 전부다. (텍스처 픽셀은 mesh-snapshot 이 비교하지 않는다.) */

interface StubContext {
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  textAlign: string;
  textBaseline: string;
  lineWidth: number;
  globalAlpha: number;
  canvas: HTMLCanvasElement;
  measureText(text: string): { width: number };
  [key: string]: unknown;
}

/** 폰트 문자열에서 px 크기를 뽑는다. 못 찾으면 16 */
function fontSize(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 16;
}

function makeContext(canvas: HTMLCanvasElement): StubContext {
  const noop = (): void => {};
  const ctx: StubContext = {
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    globalAlpha: 1,
    canvas,
    /* 글자 폭은 크기 × 글자 수에 비례한다고 본다. 한글·이모지가 라틴 문자보다
       넓은 것까지는 흉내 낸다 — 줄바꿈 분기(order() 의 두 줄 접기)가
       한쪽에서만 갈리지 않도록 폭이 그럴듯해야 한다. */
    measureText(text: string) {
      const size = fontSize(ctx.font);
      let units = 0;
      for (const ch of String(text)) units += ch.codePointAt(0)! > 0x2000 ? 1 : 0.55;
      return { width: units * size };
    },
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    roundRect: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    fillText: noop,
    strokeText: noop,
    drawImage: noop,
    setTransform: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop,
  };
  return ctx;
}

const contexts = new WeakMap<HTMLCanvasElement, StubContext>();

HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string): unknown {
  if (kind !== '2d') return null; // WebGL 은 테스트에서 가짜 렌더러가 맡는다
  let ctx = contexts.get(this);
  if (!ctx) contexts.set(this, (ctx = makeContext(this)));
  return ctx;
} as HTMLCanvasElement['getContext'];

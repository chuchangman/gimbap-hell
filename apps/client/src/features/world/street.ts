/* 문 오른쪽 통창과 그 너머의 저비용 거리 풍경.
   레거시 world.js 806-931 줄을 그대로 옮겼다. */
import { sharedGeo } from '@/features/world/geometry';
import { mat } from '@/features/world/materials';
import { box, cyl } from '@/features/world/primitives';
import { D } from '@/features/world/registry';
import { DOOR, scene } from '@/features/world/scene';
import * as THREE from 'three';

function buildStreetCar(
  color: number,
  laneZ: number,
  direction: number,
  offset: number,
  speed: number,
): void {
  const car = new THREE.Group();
  box(1.75, 0.38, 0.76, color, 0, 0.4, 0, car);
  box(0.92, 0.34, 0.68, new THREE.Color(color).multiplyScalar(0.86).getHex(), -0.15, 0.71, 0, car);
  box(0.34, 0.23, 0.02, 0xaed6df, -0.24, 0.72, 0.355, car); // 옆 창문
  box(0.3, 0.23, 0.02, 0xaed6df, 0.16, 0.72, 0.355, car);
  box(0.08, 0.11, 0.54, 0xffe6a1, 0.89, 0.43, 0, car); // 전조등
  box(0.08, 0.11, 0.54, 0xc94d45, -0.89, 0.43, 0, car); // 후미등
  const wheels = [];
  for (const x of [-0.57, 0.57])
    for (const z of [-0.39, 0.39]) {
      const wheel = cyl(0.19, 0.1, 0x25282a, x, 0.24, z, car, 10);
      wheel.rotation.x = Math.PI / 2;
      wheels.push(wheel);
    }
  car.position.z = laneZ;
  car.rotation.y = direction < 0 ? Math.PI : 0;
  scene.add(car);
  D.outside.cars.push({ mesh: car, wheels, direction, offset, speed });
}

function buildStreetPerson(
  shirt: number,
  pants: number,
  z: number,
  direction: number,
  offset: number,
  period: number,
  active: number,
): void {
  const person = new THREE.Group();
  const skin = 0xd6a274;
  const head = new THREE.Mesh(
    sharedGeo('street_head', () => new THREE.SphereGeometry(0.2, 8, 6)),
    mat(skin),
  );
  head.position.y = 1.48;
  person.add(head);
  box(0.4, 0.62, 0.25, shirt, 0, 1.02, 0, person);
  const legL = box(0.13, 0.6, 0.14, pants, -0.11, 0.43, 0, person);
  const legR = box(0.13, 0.6, 0.14, pants, 0.11, 0.43, 0, person);
  box(0.12, 0.53, 0.13, skin, -0.27, 1.02, 0, person);
  box(0.12, 0.53, 0.13, skin, 0.27, 1.02, 0, person);
  person.position.z = z;
  person.scale.setScalar(0.82);
  scene.add(person);
  D.outside.people.push({ mesh: person, legL, legR, direction, offset, period, active });
}

/** 문 오른쪽 통창과 그 너머의 저비용 거리 풍경. 실내 충돌에는 포함하지 않는다. */
export function buildStorefrontAndStreet(): void {
  const wall = 0xf2eee5;
  const frame = 0x60747a;
  const windowLeft = -4.8,
    windowRight = 7.8;
  const windowW = windowRight - windowLeft;
  const windowX = (windowLeft + windowRight) / 2;

  /* 기존 통짜 앞벽 대신 출입문과 통창의 빈자리를 남긴 벽 조각을 세운다. */
  box(1.05, 3.4, 0.18, wall, -7.475, 1.7, -11);
  box(1.9, 1.05, 0.18, wall, DOOR.x, 2.875, -11); // 문 위
  box(0.25, 3.4, 0.18, wall, -4.925, 1.7, -11); // 문·창 사이 기둥
  box(0.2, 3.4, 0.18, wall, 7.9, 1.7, -11);
  box(windowW, 0.28, 0.18, wall, windowX, 0.14, -11);
  box(windowW, 0.4, 0.18, wall, windowX, 3.2, -11);

  /* 한 장의 유리와 가는 프레임. 반사는 약하게 두어 바깥 움직임이 잘 보이게 한다. */
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(windowW - 0.1, 2.65),
    new THREE.MeshPhongMaterial({
      color: 0xb8dce5,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      shininess: 70,
    }),
  );
  glass.position.set(windowX, 1.65, -10.91);
  glass.renderOrder = 3;
  scene.add(glass);
  box(windowW, 0.12, 0.13, frame, windowX, 0.31, -10.9);
  box(windowW, 0.12, 0.13, frame, windowX, 2.99, -10.9);
  for (const x of [windowLeft, -0.62, 3.56, windowRight])
    box(0.12, 2.8, 0.13, frame, x, 1.65, -10.9);

  /* 인도·2차선 도로·맞은편 건물. 모두 창밖이므로 플레이어 충돌은 만들지 않는다. */
  box(24, 0.1, 2.0, 0xaaa9a2, 0, -0.02, -12.0);
  box(24, 0.18, 0.18, 0xd8d1c4, 0, 0.04, -12.95);
  box(30, 0.08, 5.4, 0x3f464a, 0, -0.07, -15.65);
  box(24, 0.1, 1.4, 0xa9aaa5, 0, -0.02, -18.85);
  for (let x = -14; x <= 14; x += 3.2) box(1.55, 0.018, 0.1, 0xf2e6b9, x, -0.02, -15.65);

  const buildings = [
    { x: -9, w: 8.0, h: 4.6, c: 0xb77b62, trim: 0x6d4b43 },
    { x: -1.5, w: 6.4, h: 3.8, c: 0xd1b583, trim: 0x755b47 },
    { x: 6.2, w: 8.6, h: 5.2, c: 0x879da0, trim: 0x485b60 },
  ];
  for (const b of buildings) {
    box(b.w, b.h, 0.6, b.c, b.x, b.h / 2, -19.8);
    box(b.w * 0.72, 0.24, 0.18, b.trim, b.x, 2.55, -19.45);
    const cols = Math.max(2, Math.floor(b.w / 1.7));
    for (let i = 0; i < cols; i++) {
      const wx = b.x - b.w * 0.36 + i * ((b.w * 0.72) / Math.max(1, cols - 1));
      box(0.72, 0.78, 0.04, 0xb9d8dc, wx, 1.25, -19.47);
    }
  }

  buildStreetCar(0xd86455, -14.25, 1, 1.0, 2.6);
  buildStreetCar(0x4d82b8, -16.65, -1, 9.5, 2.2);
  buildStreetCar(0xe0aa4f, -14.25, 1, 15.0, 2.4);
  buildStreetPerson(0xe18a5c, 0x4d6380, -12.15, 1, 1.2, 21, 8.5);
  buildStreetPerson(0x5c8d72, 0x5a4c65, -12.38, -1, 10.5, 27, 9.0);
  buildStreetPerson(0x7d68a8, 0x4b5965, -18.65, 1, 17.0, 31, 8.0);
}

export function animateStreet(now: number): void {
  const seconds = now / 1000;
  const minX = -14,
    maxX = 14,
    span = maxX - minX;
  for (const car of D.outside.cars) {
    const u = (((seconds * car.speed + car.offset) % span) + span) % span;
    car.mesh.position.x = car.direction > 0 ? minX + u : maxX - u;
    const spin = ((seconds * car.speed) / 0.19) * car.direction;
    for (const wheel of car.wheels) wheel.rotation.y = spin;
  }
  for (const person of D.outside.people) {
    const phase = (((seconds + person.offset) % person.period) + person.period) % person.period;
    person.mesh.visible = phase < person.active;
    if (!person.mesh.visible) continue;
    const t = phase / person.active;
    person.mesh.position.x =
      person.direction > 0 ? THREE.MathUtils.lerp(-10, 10, t) : THREE.MathUtils.lerp(10, -10, t);
    person.mesh.position.y = Math.abs(Math.sin(phase * 7.2)) * 0.035;
    const stride = Math.sin(phase * 7.2) * 0.34;
    person.legL.rotation.z = stride;
    person.legR.rotation.z = -stride;
  }
}

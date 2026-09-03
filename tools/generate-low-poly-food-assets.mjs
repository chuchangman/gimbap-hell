import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets');
const ONLY = new Set(process.argv.slice(2));
let generatedCount = 0;

const C = {
  gim: '#0b1710', gimEdge: '#163021', riceRaw: '#efe7d2', rice: '#fbf7ec',
  danmuji: '#f5d020', hamRaw: '#f3c0c2', ham: '#f09a9e',
  spinachRaw: '#3f8f38', spinach: '#1f6b3a', crab: '#f7f3ec', crabRed: '#dc3c26',
  cucumber: '#8cc63f', cucumberSkin: '#2b6b26', eggWhite: '#fdf6e4',
  eggYolk: '#f7a815', carrot: '#e2661a', fishcake: '#dfd6c6',
  fishcakeDone: '#a77762', steel: '#b9bec4', steelDark: '#7e858c', water: '#74c0e8',
};

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

function box(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const p = [], n = [], i = [];
  const faces = [
    [[x,-y,-z],[x,y,-z],[x,y,z],[x,-y,z],[1,0,0]],
    [[-x,-y,z],[-x,y,z],[-x,y,-z],[-x,-y,-z],[-1,0,0]],
    [[-x,y,-z],[-x,y,z],[x,y,z],[x,y,-z],[0,1,0]],
    [[-x,-y,z],[-x,-y,-z],[x,-y,-z],[x,-y,z],[0,-1,0]],
    [[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z],[0,0,1]],
    [[x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z],[0,0,-1]],
  ];
  for (const f of faces) {
    const base = p.length / 3;
    for (let k = 0; k < 4; k++) { p.push(...f[k]); n.push(...f[4]); }
    i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: p, normals: n, indices: i };
}

function cylinder(radius, height, sides = 10, radiusTop = radius) {
  const p = [], n = [], i = [], h = height / 2;
  for (let s = 0; s <= sides; s++) {
    const a = s / sides * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const slope = (radius - radiusTop) / height;
    const len = Math.hypot(1, slope);
    p.push(radius * ca, -h, radius * sa, radiusTop * ca, h, radiusTop * sa);
    n.push(ca / len, slope / len, sa / len, ca / len, slope / len, sa / len);
  }
  for (let s = 0; s < sides; s++) {
    const a = s * 2;
    i.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  for (const [yy, rr, ny, reverse] of [[-h, radius, -1, true], [h, radiusTop, 1, false]]) {
    const center = p.length / 3;
    p.push(0, yy, 0); n.push(0, ny, 0);
    const rim = p.length / 3;
    for (let s = 0; s < sides; s++) {
      const a = s / sides * Math.PI * 2;
      p.push(rr * Math.cos(a), yy, rr * Math.sin(a)); n.push(0, ny, 0);
    }
    for (let s = 0; s < sides; s++) {
      const q = rim + s, r = rim + (s + 1) % sides;
      // glTF는 기본적으로 뒷면을 그리지 않는다. 위 캡은 +y, 아래 캡은 -y를 향해야 한다.
      if (reverse) i.push(center, q, r); else i.push(center, r, q);
    }
  }
  return { positions: p, normals: n, indices: i };
}

function uvSphere(rx, ry, rz, slices = 10, stacks = 5) {
  const p = [], n = [], i = [];
  for (let y = 0; y <= stacks; y++) {
    const v = y / stacks, phi = v * Math.PI;
    for (let x = 0; x <= slices; x++) {
      const u = x / slices, a = u * Math.PI * 2;
      const px = Math.sin(phi) * Math.cos(a), py = Math.cos(phi), pz = Math.sin(phi) * Math.sin(a);
      p.push(px * rx, py * ry, pz * rz);
      const nx = px / rx, ny = py / ry, nz = pz / rz, l = Math.hypot(nx, ny, nz);
      n.push(nx / l, ny / l, nz / l);
    }
  }
  for (let y = 0; y < stacks; y++) for (let x = 0; x < slices; x++) {
    const a = y * (slices + 1) + x, b = a + slices + 1;
    i.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return { positions: p, normals: n, indices: i };
}

/* 완벽한 타원 대신 둘레와 높이가 살짝 흔들리는 밥 덩어리.
   실루엣은 low-poly로 유지하면서 '하얀 공'처럼 보이는 느낌을 줄인다. */
function riceMound(rx, ry, rz, slices = 14, stacks = 7) {
  const p = [], n = [], i = [];
  for (let y = 0; y <= stacks; y++) {
    const v = y / stacks, phi = v * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let x = 0; x <= slices; x++) {
      const a = x / slices * Math.PI * 2;
      const wobble = 1 + sp * (.035 * Math.sin(a * 3 + .4) + .022 * Math.cos(a * 5 - .7));
      const px = sp * Math.cos(a) * wobble, pz = sp * Math.sin(a) * wobble;
      const py = cp * (1 + .018 * Math.sin(a * 4) * sp);
      p.push(px * rx, py * ry, pz * rz);
      const nx = px / rx, ny = py / ry, nz = pz / rz, l = Math.hypot(nx, ny, nz);
      n.push(nx / l, ny / l, nz / l);
    }
  }
  for (let y = 0; y < stacks; y++) for (let x = 0; x < slices; x++) {
    const a = y * (slices + 1) + x, b = a + slices + 1;
    i.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return { positions: p, normals: n, indices: i };
}

function eggShape(rx = .13, height = .33, rz = .13, slices = 10, stacks = 7) {
  const p = [], n = [], i = [];
  for (let y = 0; y <= stacks; y++) {
    const v = y / stacks, phi = v * Math.PI;
    const taper = .82 + .20 * v; // 위는 조금 좁고 아래는 둥글게
    for (let x = 0; x <= slices; x++) {
      const a = x / slices * Math.PI * 2;
      const ring = Math.sin(phi) * taper, py = Math.cos(phi);
      const px = ring * Math.cos(a), pz = ring * Math.sin(a);
      p.push(px * rx, py * height / 2, pz * rz);
      const nx = px / rx, ny = py / (height / 2), nz = pz / rz, l = Math.hypot(nx,ny,nz);
      n.push(nx/l,ny/l,nz/l);
    }
  }
  for (let y = 0; y < stacks; y++) for (let x = 0; x < slices; x++) {
    const a = y * (slices + 1) + x, b = a + slices + 1;
    i.push(a,a+1,b, a+1,b+1,b);
  }
  return { positions:p, normals:n, indices:i };
}

function revolveProfile(profile, sides = 12) {
  const p = [], n = [], i = [];
  for (let q = 0; q < profile.length; q++) {
    const prev = profile[Math.max(0,q-1)], next = profile[Math.min(profile.length-1,q+1)];
    const dr = next[0]-prev[0], dy = next[1]-prev[1];
    for (let s = 0; s <= sides; s++) {
      const a = s/sides*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
      p.push(profile[q][0]*ca,profile[q][1],profile[q][0]*sa);
      const nx=dy*ca, ny=-dr, nz=dy*sa, l=Math.hypot(nx,ny,nz)||1;
      n.push(nx/l,ny/l,nz/l);
    }
  }
  for (let q=0;q<profile.length-1;q++) for (let s=0;s<sides;s++) {
    const a=q*(sides+1)+s, b=a+sides+1;
    i.push(a,b,a+1, a+1,b,b+1);
  }
  return { positions:p, normals:n, indices:i };
}

function extrudeY(points, height) {
  const p = [], n = [], i = [], h = height / 2, count = points.length;
  for (let k = 0; k < count; k++) {
    const [x0, z0] = points[k], [x1, z1] = points[(k + 1) % count];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
    const base = p.length / 3, nx = dz / l, nz = -dx / l;
    p.push(x0,-h,z0, x0,h,z0, x1,h,z1, x1,-h,z1);
    for (let q = 0; q < 4; q++) n.push(nx, 0, nz);
    i.push(base,base+1,base+2, base,base+2,base+3);
  }
  for (const [yy, ny, reverse] of [[-h,-1,true],[h,1,false]]) {
    const base = p.length / 3;
    for (const [x,z] of points) { p.push(x,yy,z); n.push(0,ny,0); }
    for (let k = 1; k < count - 1; k++) {
      if (reverse) i.push(base,base+k,base+k+1); else i.push(base,base+k+1,base+k);
    }
  }
  return { positions: p, normals: n, indices: i };
}

function irregularTube(height, rings = 7, sides = 7, rx = 0.036, rz = 0.027, phase = 0) {
  const p = [], n = [], i = [];
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1), y = (t - 0.5) * height;
    const cx = Math.sin(t * 11 + phase) * 0.006, cz = Math.cos(t * 9 + phase) * 0.005;
    const bulge = 0.78 + 0.22 * Math.sin(t * Math.PI);
    for (let s = 0; s < sides; s++) {
      const a = s / sides * Math.PI * 2 + r * 0.22;
      p.push(cx + Math.cos(a) * rx * bulge, y, cz + Math.sin(a) * rz * bulge);
      const nx = Math.cos(a) / rx, nz = Math.sin(a) / rz, l = Math.hypot(nx, nz);
      n.push(nx / l, 0, nz / l);
    }
  }
  for (let r = 0; r < rings - 1; r++) for (let s = 0; s < sides; s++) {
    const a = r * sides + s, b = r * sides + (s + 1) % sides, c = a + sides, d = b + sides;
    i.push(a,c,d, a,d,b);
  }
  return { positions: p, normals: n, indices: i };
}

function transform(g, { t = [0,0,0], r = [0,0,0], s = [1,1,1] } = {}) {
  const [cx,sx] = [Math.cos(r[0]),Math.sin(r[0])], [cy,sy] = [Math.cos(r[1]),Math.sin(r[1])], [cz,sz] = [Math.cos(r[2]),Math.sin(r[2])];
  const rotate = (x,y,z) => {
    let qy = y * cx - z * sx, qz = y * sx + z * cx, qx = x;
    let rx = qx * cy + qz * sy, rz = -qx * sy + qz * cy, ry = qy;
    return [rx * cz - ry * sz, rx * sz + ry * cz, rz];
  };
  const positions = [];
  for (let k = 0; k < g.positions.length; k += 3) {
    const q = rotate(g.positions[k] * s[0], g.positions[k+1] * s[1], g.positions[k+2] * s[2]);
    positions.push(q[0] + t[0], q[1] + t[1], q[2] + t[2]);
  }
  const normals = [];
  for (let k = 0; k < g.normals.length; k += 3) {
    const q = rotate(g.normals[k] / s[0], g.normals[k+1] / s[1], g.normals[k+2] / s[2]);
    const l = Math.hypot(...q); normals.push(q[0]/l, q[1]/l, q[2]/l);
  }
  return { positions, normals, indices: g.indices.slice() };
}

class Asset {
  constructor(name) { this.name = name; this.parts = []; }
  add(name, geometry, color, options = {}) { this.parts.push({ name, geometry, color, options }); return this; }
  write(file) {
    const json = { asset: { version: '2.0', generator: 'Gimbap Hell low-poly food generator' },
      scene: 0, scenes: [{ name: this.name, nodes: [] }], nodes: [], meshes: [], materials: [],
      accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
    const chunks = [];
    const append = (typed, target) => {
      const raw = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
      const padded = Buffer.alloc((raw.length + 3) & ~3); raw.copy(padded);
      const offset = chunks.reduce((sum, b) => sum + b.length, 0); chunks.push(padded);
      json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: raw.length, target });
      return json.bufferViews.length - 1;
    };
    const materialMap = new Map();
    const material = (color, options) => {
      const key = color + JSON.stringify(options);
      if (materialMap.has(key)) return materialMap.get(key);
      const alpha = options.opacity ?? 1;
      const m = { name: options.materialName || color, pbrMetallicRoughness: {
        baseColorFactor: [...rgb(color).slice(0,3), alpha], metallicFactor: options.metallic ?? 0,
        roughnessFactor: options.roughness ?? 0.86 } };
      if (alpha < 1) { m.alphaMode = 'BLEND'; m.doubleSided = true; }
      if (options.doubleSided) m.doubleSided = true;
      json.materials.push(m); const idx = json.materials.length - 1; materialMap.set(key, idx); return idx;
    };
    for (const part of this.parts) {
      const g = part.geometry;
      const pos = new Float32Array(g.positions), norm = new Float32Array(g.normals);
      const maxIndex = Math.max(...g.indices), Indices = maxIndex < 65536 ? Uint16Array : Uint32Array;
      const ind = new Indices(g.indices);
      const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
      for (let k = 0; k < pos.length; k += 3) for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], pos[k+a]); max[a] = Math.max(max[a], pos[k+a]);
      }
      const posView = append(pos, 34962), normView = append(norm, 34962), indView = append(ind, 34963);
      const posAcc = json.accessors.push({ bufferView: posView, componentType: 5126, count: pos.length/3, type: 'VEC3', min, max }) - 1;
      const normAcc = json.accessors.push({ bufferView: normView, componentType: 5126, count: norm.length/3, type: 'VEC3' }) - 1;
      const indAcc = json.accessors.push({ bufferView: indView, componentType: Indices === Uint16Array ? 5123 : 5125, count: ind.length, type: 'SCALAR' }) - 1;
      const mesh = json.meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: posAcc, NORMAL: normAcc }, indices: indAcc, material: material(part.color, part.options) }] }) - 1;
      const node = { name: part.name, mesh };
      if (part.options.nodeTranslation) node.translation = part.options.nodeTranslation;
      json.nodes.push(node); json.scenes[0].nodes.push(json.nodes.length - 1);
    }
    const bin = Buffer.concat(chunks); json.buffers[0].byteLength = bin.length;
    const j = Buffer.from(JSON.stringify(json)); const jp = Buffer.alloc((j.length + 3) & ~3, 0x20); j.copy(jp);
    const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(jp.length,0); jh.writeUInt32LE(0x4e4f534a,4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length,0); bh.writeUInt32LE(0x004e4942,4);
    header.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length,8);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.concat([header,jh,jp,bh,bin]));
  }
}

const T = (g, t, r, s) => transform(g, { t, r, s });
const save = (name, build) => {
  if (ONLY.size && !ONLY.has(name)) return;
  const asset = new Asset(name); build(asset);
  asset.write(path.join(OUT, name + '.glb'));
  generatedCount++;
  console.log(`${name}.glb`);
};

// 손질 후 속재료: y 길이 1.0, 단면은 xz. 형태만 봐도 서로 구분되도록 만든다.
save('fill/danmuji', a => a.add('danmuji', box(.056,1,.056), C.danmuji));
save('fill/ham', a => {
  a.add('ham', box(.074,1,.040), C.ham);
  a.add('ham_mark', T(box(.014,1.002,.041),[-.020,0,0]), '#f7b5b8');
});
save('fill/egg', a => {
  a.add('yolk', T(box(.088,1,.026),[0,0,-.008]), C.eggYolk);
  a.add('white', T(box(.088,1.002,.011),[0,0,.014]), C.eggWhite);
});
save('fill/crab', a => {
  a.add('red_skin', cylinder(.030,1,10), C.crabRed);
  a.add('white_core', cylinder(.023,1.004,10), C.crab);
});
save('fill/cucumber', a => {
  a.add('flesh', T(box(.050,1,.048),[0,0,.004]), C.cucumber);
  a.add('skin', T(box(.052,1.002,.013),[0,0,-.024]), C.cucumberSkin);
  a.add('seed_line', T(box(.009,1.003,.050),[0,0,.004]), '#d7e88c');
});
save('fill/spinach', a => {
  a.add('leaf_bundle', irregularTube(1,8,7,.039,.028,.4), C.spinach);
  a.add('leaf_highlight', T(irregularTube(.82,6,6,.019,.014,2.1),[.017,.02,.008]), '#2f8050');
});
save('fill/carrot', a => {
  const pts = [[-.043,-.020],[-.020,-.020],[-.020,.001],[-.002,.001],[-.002,-.020],[.020,-.020],[.020,.001],[.043,.001],[.043,.020],[.020,.020],[.020,.007],[-.002,.007],[-.002,.020],[-.025,.020],[-.025,.006],[-.043,.006]];
  a.add('julienne_bundle', extrudeY(pts,1), C.carrot);
});
save('fill/fishcake', a => {
  const xs = [-.048,-.032,-.016,0,.016,.032,.048], upper = [], lower = [];
  xs.forEach((x,k) => upper.push([x, Math.sin(k*Math.PI/2)*.008 + .006]));
  [...xs].reverse().forEach((x,rev) => { const k=xs.length-1-rev; lower.push([x, Math.sin(k*Math.PI/2)*.008 - .006]); });
  a.add('wavy_ribbon', extrudeY([...upper,...lower],1), C.fishcakeDone);
});

// 손질 전 원물.
save('raw/danmuji', a => {
  // 완벽한 원통 대신 가운데가 살짝 굵고 양끝이 다른 절임무 형태.
  const profile=[[0,-.25],[.057,-.25],[.069,-.235],[.076,-.15],[.074,-.04],
    [.078,.07],[.071,.18],[.059,.25],[0,.25]];
  a.add('radish_body', T(revolveProfile(profile,12),[0,0,0],[0,0,Math.PI/2]), '#efd226', { roughness:.94 });
  a.add('cut_skin', T(cylinder(.060,.008,12),[.254,0,0],[0,0,Math.PI/2]), '#e7c621', { roughness:.96 });
  a.add('cut_flesh', T(cylinder(.052,.010,12),[.259,0,0],[0,0,Math.PI/2]), '#ffe568', { roughness:.98 });
  a.add('far_cut', T(cylinder(.053,.007,12),[-.254,0,0],[0,0,Math.PI/2]), '#f8dc4b', { roughness:.98 });
  for(const [i,y,z] of [[0,.018,.010],[1,-.022,.022],[2,.006,-.027],[3,.035,-.016]])
    a.add(`cut_pore_${i}`, T(uvSphere(.004,.006,.004,6,3),[.265,y,z]), '#d1ad1d', { roughness:1 });
  for(const [i,x,r] of [[0,-.12,.073],[1,.02,.076],[2,.15,.066]])
    a.add(`pickle_ridge_${i}`, T(cylinder(r,.008,12),[x,0,0],[0,0,Math.PI/2]), '#e2bf1e', { roughness:.98 });
});
save('raw/ham', a => {
  const hamOutline=[[-.17,-.082],[-.162,-.105],[-.135,-.12],[.135,-.12],[.162,-.105],[.17,-.082],
    [.17,.082],[.158,.105],[.132,.12],[-.132,.12],[-.158,.105],[-.17,.082]];
  const inner=hamOutline.map(([x,z])=>[x*.93,z*.88]);
  // 얇고 짙은 염지층 안에 밝은 살코기가 들어간 통햄 단면.
  a.add('ham_rind', extrudeY(hamOutline,.11), '#b96f76', { roughness:.91 });
  a.add('ham_meat', T(extrudeY(inner,.094),[0,-.003,0]), '#e7a5aa', { roughness:.86 });
  a.add('ham_cut_surface', T(extrudeY(inner,.008),[0,.052,0],[0,0,0],[.985,1,.985]), '#efb3b6', { roughness:.91 });
  a.add('ham_bottom_seam', T(extrudeY(inner,.006),[0,-.053,0]), '#cc858b', { roughness:.94 });
  // 지방 결은 직선 스티커 대신 작은 타원들을 이어 붙여 자연스럽게 굽힌다.
  const veins=[
    [[-.125,-.052],[-.096,-.047],[-.066,-.036],[-.038,-.019]],
    [[-.018,.020],[.012,.010],[.040,-.006],[.067,-.020]],
    [[.055,.070],[.083,.062],[.108,.048],[.132,.030]],
    [[-.108,.070],[-.083,.077],[-.056,.073]],
  ];
  veins.forEach((points,v)=>points.forEach(([x,z],j)=>
    a.add(`fat_marble_${v}_${j}`, T(uvSphere(.019-j*.001,.0034,.0075,7,3),[x,.059,z],[0,-.34+j*.17,0]),
      (v+j)%2?'#f6d5d0':'#fae2dc', { roughness:.97 })));
  // 큰 지방 알갱이와 염지 기공을 섞어 단면이 플라스틱처럼 매끈해 보이지 않게 한다.
  for(const [i,x,z,rx,rz] of [[0,-.036,-.076,.012,.007],[1,.090,-.072,.009,.006],[2,.126,.078,.008,.005],
    [3,-.136,.018,.007,.010],[4,.020,.079,.010,.006]])
    a.add(`fat_fleck_${i}`, T(uvSphere(rx,.0032,rz,7,3),[x,.060,z],[0,i*.51,0]), '#f8d8d1', { roughness:.98 });
  for(const [i,x,z,s] of [[0,-.12,.004,.004],[1,-.025,-.078,.0035],[2,.070,.082,.004],[3,.130,-.045,.0035],
    [4,-.070,.035,.003],[5,.035,.045,.003]])
    a.add(`cure_pore_${i}`, T(uvSphere(s,.0025,s,6,3),[x,.062,z]), '#a86168', { roughness:1 });
});
save('raw/egg', a => {
  a.add('egg_shell', eggShape(.13,.33,.125,12,9), '#f2e5cd', { roughness:.97 });
  // 눈에 띄지 않을 만큼만 껍질 반점을 올려 플라스틱 공처럼 보이지 않게 한다.
  for(const [i,x,y,z,s] of [[0,.090,.040,.070,.006],[1,-.075,.070,.078,.005],
    [2,.035,-.085,.110,.004],[3,-.105,-.020,.035,.004],[4,.060,.105,-.055,.004],
    [5,-.040,.125,.030,.0035]])
    a.add(`shell_speck_${i}`, T(uvSphere(s,s*.38,s,6,3),[x,y,z]), '#c8ad82', { roughness:1 });
});
save('raw/cucumber', a => {
  const profile=[[0,-.25],[.064,-.25],[.073,-.23],[.079,-.13],[.076,-.02],
    [.081,.10],[.074,.22],[.064,.25],[0,.25]];
  a.add('skin', T(revolveProfile(profile,12),[0,0,0],[0,0,Math.PI/2]), '#2f6f2d', { roughness:.93 });
  for(let i=0;i<6;i++) {
    const angle=i/6*Math.PI*2, y=Math.cos(angle)*.074, z=Math.sin(angle)*.074;
    a.add(`skin_ridge_${i}`, T(box(.38,.008,.010),[0,y,z],[angle,0,0]), i%2?'#397d34':'#245e27', { roughness:.98 });
  }
  a.add('cut_rind', T(cylinder(.067,.010,12),[.254,0,0],[0,0,Math.PI/2]), '#77ad45', { roughness:.97 });
  a.add('cut_face', T(cylinder(.057,.012,12),[.260,0,0],[0,0,Math.PI/2]), '#b8d96d', { roughness:.98 });
  const seeds=[[.024,0],[-.018,.020],[-.018,-.020],[.004,.030],[.004,-.030]];
  seeds.forEach(([y,z],i)=>a.add(`seed_${i}`,T(uvSphere(.004,.011,.005,6,3),[.268,y,z],[0,0,Math.PI/2]),'#e7efb5',{roughness:1}));
  for(const [i,x,y,z] of [[0,-.14,.071,.018],[1,-.02,-.052,.052],[2,.13,.025,-.071]])
    a.add(`skin_bump_${i}`, T(uvSphere(.007,.004,.006,6,3),[x,y,z]), '#4b8b3c', { roughness:1 });
});
save('raw/spinach', a => {
  const leaf=[[-.115,0],[-.075,-.045],[.015,-.072],[.115,-.046],[.165,0],
    [.115,.046],[.015,.072],[-.075,.045]];
  for (let k=0;k<6;k++) {
    const z=(k-2.5)*.038, angle=(k-2.5)*.14, y=(k%3-1)*.018;
    a.add(`stem_${k}`, T(cylinder(.010,.28,7),[-.125,y,z],[0,0,Math.PI/2]), k%2?'#78ad58':'#659c4c', { roughness:.98 });
    a.add(`leaf_${k}`, T(extrudeY(leaf,.014),[.070,y+.008,z],[0,angle,(k-2.5)*.035]), k%2 ? '#3f8f38' : '#347d35', { roughness:.96 });
    a.add(`vein_${k}`, T(cylinder(.006,.245,6),[.070,y+.018,z],[0,angle,Math.PI/2]), '#78a95a', { roughness:1 });
  }
  a.add('stem_bundle', T(cylinder(.037,.09,8),[-.245,0,0],[0,0,Math.PI/2]), '#9bb96b', { roughness:.98 });
  a.add('tie', T(cylinder(.044,.026,8),[-.205,0,0],[0,0,Math.PI/2]), '#d7b875', { roughness:.90 });
});
save('raw/carrot', a => {
  const profile=[[0,-.235],[.014,-.235],[.026,-.19],[.040,-.10],[.057,.02],
    [.076,.13],[.084,.195],[.066,.22],[0,.22]];
  a.add('carrot_root', T(revolveProfile(profile,12),[0,0,0],[0,0,Math.PI/2]), '#dc641d', { roughness:.96 });
  for(const [i,x,r] of [[0,-.12,.078],[1,-.035,.063],[2,.055,.050],[3,.135,.036]])
    a.add(`root_groove_${i}`, T(cylinder(r,.009,12),[x,0,0],[0,0,Math.PI/2]), '#b94c19', { roughness:1 });
  a.add('stem_cap', T(cylinder(.047,.028,10),[-.226,0,0],[0,0,Math.PI/2]), '#587c32', { roughness:.98 });
  for (let k=-2;k<=2;k++) {
    a.add(`carrot_stem_${k}`, T(cylinder(.009,.11,7),[-.275,.025,k*.020],[0,0,Math.PI/2]), '#568938', { roughness:.98 });
    a.add(`carrot_leaf_${k}`, T(uvSphere(.060,.018,.025,7,3),[-.325,.045+(k%2)*.020,k*.028],[0,k*.35,k*.18]), k%2?'#4f8f38':'#3f7d32', { roughness:.98 });
  }
});
save('raw/fishcake', a => {
  const sheet=[[-.20,-.112],[-.178,-.132],[-.132,-.145],[-.073,-.137],[-.015,-.148],[.048,-.139],
    [.112,-.146],[.168,-.132],[.20,-.108],[.198,.104],[.174,.126],[.120,.142],[.058,.135],
    [-.004,.147],[-.070,.137],[-.137,.145],[-.182,.128],[-.20,.105]];
  for (let k=0;k<3;k++) {
    const y=-.025+k*.025, z=(k-1)*.022, rot=(k-1)*.065;
    a.add(`fishcake_edge_${k}`, T(extrudeY(sheet,.026),[0,y,z],[0,rot,0]), k===2?'#a96f49':'#9d6847', { roughness:.96 });
    a.add(`fishcake_surface_${k}`, T(extrudeY(sheet,.010),[0,y+.017,z],[0,rot,0],[.955,1,.92]), k%2?'#d9b184':'#e4bd8d', { roughness:.90 });
  }
  // 맨 윗장에 눌린 주름, 기름 기포, 불규칙한 구운 반점을 따로 얹는다.
  for(const [i,x,z,len,rot] of [[0,-.085,-.050,.13,.12],[1,.070,.018,.11,-.18],[2,-.010,.080,.085,.35],
    [3,.115,.088,.060,-.42]])
    a.add(`fishcake_crease_${i}`, T(box(len,.0025,.006),[x,.043,z+.022],[0,rot,0]), '#bc8b60', { roughness:.98 });
  for (let d=0;d<18;d++) {
    const x=-.162+(d%7)*.052+(d%2)*.008, z=-.100+((d*5)%7)*.032;
    a.add(`toast_${d}`, T(uvSphere(.008+(d%3)*.002,.0022,.005+(d%2)*.002,6,3),[x,.046,z]), d%4?'#b77c50':'#ca9362', { roughness:1 });
  }
  for(const [i,x,z] of [[0,-.13,.095],[1,.118,-.072],[2,.020,-.105]])
    a.add(`oil_blister_${i}`, T(uvSphere(.012,.003,.009,7,3),[x,.046,z]), '#efd0a4', { roughness:.78 });
});

// 김, 쌀, 밥.
save('item/gim', a => {
  a.add('gim_sheet', box(.64,.014,.52), '#101110', { doubleSided: true, roughness:.96 });
});
save('item/rice', a => {
  const bowlProfile = [[0,-.070],[.078,-.070],[.102,-.062],[.135,-.045],[.174,-.010],[.203,.036],[.212,.058],
    [.211,.064],[.186,.064],[.176,.040],[.151,.008],[.120,-.018],[.088,-.031],[0,-.031]];
  a.add('bowl', revolveProfile(bowlProfile,16), '#edf1eb', { roughness:.84 });
  a.add('bowl_base', T(cylinder(.098,.012,14),[0,-.069,0]), '#aebfba', { roughness:.86 });
  a.add('bowl_accent', T(cylinder(.146,.006,16),[0,-.031,0]), '#b8cfca', { roughness:.90 });
  a.add('rice_shadow', T(cylinder(.168,.006,16),[0,.006,0]), '#bdb39f', { roughness:.98 });
  a.add('rice_surface', T(riceMound(.166,.033,.166,16,4),[0,.026,0]), '#e9dfca', { roughness:.96 });
  for (let k=0;k<52;k++) {
    const a0=k*2.399, rr=.148*Math.sqrt((k+.55)/52), x=Math.cos(a0)*rr, z=Math.sin(a0)*rr;
    const y=.054+.010*(1-rr/.148)+(k%4)*.0008;
    const long=.0125+(k%4)*.0007, wide=.0052+(k%3)*.0004;
    a.add(`grain_${k}`, T(uvSphere(long,.0042,wide,7,3),[x,y,z],[0,a0+(k%5)*.12,0]),
      k%5 ? C.riceRaw : '#fffaf0', { roughness:.98 });
  }
  // 게임 코드가 washed 상태에서만 켠다. 노드 이름은 런타임 계약상 유지한다.
  a.add('water', T(cylinder(.176,.002,16),[0,.066,0]), C.water, { opacity:.28, roughness:.34 });
});
save('item/bap', a => {
  a.add('rice_mound', riceMound(.194,.104,.164,16,8), '#f4efe5', { roughness:.82 });
  for (let k=0;k<46;k++) {
    const a0=k*2.399, rr=.162*Math.sqrt((k+.4)/46), x=Math.cos(a0)*rr, z=Math.sin(a0)*rr*.84;
    const y=.101*Math.sqrt(Math.max(0,1-(x*x/.039)-(z*z/.028)))+.008;
    const long=.0135+(k%3)*.0008, wide=.0062+(k%2)*.0005;
    a.add(`cooked_grain_${k}`, T(uvSphere(long,.0052,wide,7,3),[x,y,z],[0,a0+(k%4)*.18,0]),
      k%4 ? '#fffdf8' : '#e8e0d3', { roughness:.78 });
  }
});

// 공용 주방 가구와 도구.
// counter는 모든 조리대가 같은 GLB를 복제한 뒤 tint_* 노드의 색만 바꿔 쓴다.
save('station/counter', a => {
  a.add('tint_kick', T(box(.86,.13,.86),[0,.065,0]), '#555555');
  a.add('tint_body', T(box(1,.82,1),[0,.54,0]), '#a8a8a8');
  a.add('tint_trim', T(box(1,.024,1),[0,.945,0]), '#777777');
  a.add('top', T(box(1,.09,1),[0,.99,0]), '#f5f0e2');
});

save('station/fridge', a => {
  const body='#c9dce8', edge='#a8c5d5', inside='#526878';
  a.add('back', T(box(.60,2.90,5.90),[-.275,1.45,0]), body);
  a.add('lower_body', T(box(1.15,1.02,5.90),[0,.51,0]), body);
  a.add('upper_body', T(box(1.15,.16,5.90),[0,2.82,0]), body);
  a.add('middle_shelf', T(box(.55,.12,5.90),[.30,1.88,0]), edge);
  for(let k=0;k<=5;k++)
    a.add(`divider_${k}`, T(box(.55,1.72,.09),[.30,1.88,-2.875+k*1.15]), edge);
  for(let row=0;row<2;row++) for(let k=0;k<5;k++)
    a.add(`inside_${row}_${k}`, T(box(.03,.80,1.06),[.045,1.42+row*.92,-2.30+k*1.15]), inside);
  a.add('top_trim', T(box(1.17,.07,5.90),[0,2.885,0]), '#e2edf3');
});

save('item/broom', a => {
  a.add('handle', T(cylinder(.035,1.26,10),[0,.17,0]), '#9a6834');
  a.add('handle_cap', T(cylinder(.045,.07,10),[0,.765,0]), '#6f4728');
  a.add('collar', T(box(.22,.10,.15),[0,-.47,0]), '#8e6232');
  a.add('head', T(box(.34,.20,.14),[0,-.55,0],[0,0,.05]), '#d5a94e');
  for(let k=0;k<7;k++)
    a.add(`bristle_${k}`, T(box(.038,.18,.12),[-.135+k*.045,-.71,0],[0,0,(k-3)*.018]), k%2 ? '#ba8737' : '#c99842');
});

save('station/board', a => {
  a.add('board_body', box(1.05,.07,.85), '#d8ad74');
  a.add('board_top', T(box(1.00,.012,.80),[0,.041,0]), '#e6c38e');
  for(let k=0;k<4;k++)
    a.add(`wood_grain_${k}`, T(box(.94,.004,.012),[0,.049,-.29+k*.19]), k%2 ? '#c99d65' : '#d4aa72');
  a.add('hanging_hole', T(cylinder(.035,.014,8),[-.44,.051,-.34]), '#8f6d48');
});

save('item/knife', a => {
  a.add('blade', T(box(.060,.030,.40),[0,0,-.08]), '#dfe5e8', { metallic:.35, roughness:.48 });
  a.add('cutting_edge', T(box(.063,.010,.39),[0,-.018,-.08]), '#f4f7f8', { metallic:.30, roughness:.40 });
  a.add('spine', T(box(.035,.046,.40),[0,.020,-.08]), '#aeb9bf', { metallic:.30, roughness:.52 });
  a.add('tang', T(box(.045,.045,.06),[0,0,.15]), '#8d949a', { metallic:.25, roughness:.58 });
  a.add('handle', T(box(.075,.060,.20),[0,0,.28]), '#2f2924');
  a.add('handle_ridge', T(box(.079,.016,.18),[0,.038,.28]), '#1d1916');
});

save('station/mat', a => {
  for(let k=0;k<12;k++)
    a.add(`bamboo_${k}`, T(cylinder(.026,.72,8),[-.33+k*.06,0,0],[Math.PI/2,0,0]), k%2 ? '#d3a55b' : '#c5954e');
  for(const [k,z] of [-.25,.25].entries())
    a.add(`binding_${k}`, T(cylinder(.010,.68,7),[0,.028,z],[0,0,Math.PI/2]), '#6f5432');
});

save('station/pot', a => {
  const profile=[[0,0],[.22,0],[.255,.025],[.270,.065],[.270,.285],[.242,.285],[.238,.075],[0,.075]];
  a.add('pot_body', revolveProfile(profile,12), '#aeb8bd', { metallic:.48, roughness:.50 });
  a.add('pot_rim', revolveProfile([[.242,.273],[.278,.273],[.285,.285],[.278,.297],[.242,.297]],12), '#d4dadd', { metallic:.52, roughness:.42 });
  for(const s of [-1,1])
    a.add(`handle_${s}`, T(box(.12,.055,.11),[s*.31,.205,0]), '#596168', { metallic:.20, roughness:.65 });
  a.add('water', cylinder(.232,.012,12), '#74c0e8', { opacity:.48, roughness:.25, nodeTranslation:[0,.195,0] });
});

save('station/pan', a => {
  const profile=[[0,0],[.225,0],[.275,.018],[.295,.048],[.290,.085],[.258,.095],[.235,.045],[0,.045]];
  a.add('pan_body', revolveProfile(profile,12), '#302d2a', { metallic:.12, roughness:.76 });
  a.add('pan_inner', T(cylinder(.238,.010,12),[0,.052,0]), '#45403b', { metallic:.08, roughness:.80 });
  a.add('handle', T(cylinder(.032,.48,8),[0,.060,.48],[Math.PI/2,0,0]), '#211d1a', { roughness:.88 });
  a.add('handle_end', T(box(.09,.075,.13),[0,.060,.72]), '#28231f');
});

save('station/cooker', a => {
  // 크림색 공용 받침대와 밥솥 본체를 한 파일로 묶는다.
  a.add('counter_kick', T(box(1.15,.13,1.95),[0,.065,0]), '#5e5749');
  a.add('counter_body', T(box(1.30,.82,2.10),[0,.54,0]), '#e0cfa8');
  a.add('counter_trim', T(box(1.30,.024,2.10),[0,.945,0]), '#9d9075');
  a.add('counter_top', T(box(1.30,.09,2.10),[0,.99,0]), '#f5f0e2');
  a.add('cooker_body', T(cylinder(.36,.44,12),[.05,1.24,0]), '#eeeae2', { roughness:.78 });
  a.add('body_band', T(cylinder(.365,.035,12),[.05,1.07,0]), '#aaa59d', { metallic:.12, roughness:.66 });
  a.add('lid', T(cylinder(.37,.12,12),[.05,1.24,0]), '#d8d4cc', { roughness:.72, nodeTranslation:[0,.27,0] });
  a.add('steam_vent', T(cylinder(.055,.055,8),[.05,1.585,0]), '#73777a');
  a.add('control_panel', T(box(.24,.16,.025),[.05,1.22,.365]), '#292d30');
  a.add('display', T(box(.16,.075,.012),[.05,1.23,.382]), '#58c87a');
  for(const s of [-1,1]) a.add(`cooker_handle_${s}`, T(box(.08,.055,.17),[.05+s*.39,1.27,0]), '#cbc6bd');
});

save('station/sink', a => {
  // 청록색 업소용 받침대
  a.add('counter_kick', T(box(1.15,.13,1.95),[0,.065,0]), '#3f5962');
  a.add('counter_body', T(box(1.30,.82,2.10),[0,.54,0]), '#8fb4c4');
  a.add('counter_trim', T(box(1.30,.024,2.10),[0,.945,0]), '#637f8b');
  a.add('counter_top', T(box(1.30,.09,2.10),[0,.99,0]), '#d7dee2', { metallic:.24, roughness:.58 });

  // 상자를 겹치지 않고 벽 네 장과 바닥으로 만들어 실제로 열린 개수대로 보이게 한다.
  const rim='#b9c4c9', deep='#5d6870';
  a.add('basin_left', T(box(.055,.20,1.36),[-.41,1.14,0]), rim, { metallic:.32, roughness:.48 });
  a.add('basin_right', T(box(.055,.20,1.36),[.51,1.14,0]), rim, { metallic:.32, roughness:.48 });
  a.add('basin_front', T(box(.975,.20,.055),[.05,1.14,-.68]), rim, { metallic:.32, roughness:.48 });
  a.add('basin_back', T(box(.975,.20,.055),[.05,1.14,.68]), rim, { metallic:.32, roughness:.48 });
  a.add('basin_floor', T(box(.92,.03,1.36),[.05,1.055,0]), deep, { metallic:.24, roughness:.62 });
  a.add('drain', T(cylinder(.075,.016,10),[.05,1.074,0]), '#3f474d', { metallic:.45, roughness:.42 });

  // 수도꼭지: 밑동, 높은 목, 앞으로 꺾인 관, 아래쪽 주둥이.
  const steel='#b9c1c6';
  a.add('faucet_base', T(cylinder(.055,.30,10),[-.44,1.19,0]), steel, { metallic:.55, roughness:.38 });
  a.add('faucet_neck', T(cylinder(.043,.30,10),[-.44,1.46,0]), steel, { metallic:.55, roughness:.38 });
  a.add('faucet_arm', T(cylinder(.040,.30,10),[-.30,1.60,0],[0,0,Math.PI/2]), steel, { metallic:.55, roughness:.38 });
  a.add('faucet_spout', T(cylinder(.034,.16,10),[-.16,1.52,0]), steel, { metallic:.55, roughness:.38 });
  for(const s of [-1,1]) {
    a.add(`tap_${s}`, T(cylinder(.027,.14,8),[-.44,1.30,s*.15],[Math.PI/2,0,0]), '#d8dde1', { metallic:.30, roughness:.52 });
    a.add(`tap_mark_${s}`, T(cylinder(.046,.020,10),[-.44,1.30,s*.225],[Math.PI/2,0,0]), s<0?'#4f8fd0':'#d06060');
  }
  a.add('water', cylinder(.032,.38,8), '#74c0e8', { opacity:.52, roughness:.20, nodeTranslation:[-.16,1.25,0] });
});

save('station/stove', a => {
  a.add('counter_kick', T(box(1.15,.13,6.65),[0,.065,0]), '#181614');
  a.add('counter_body', T(box(1.30,.82,6.80),[0,.54,0]), '#3a3734');
  a.add('counter_trim', T(box(1.30,.024,6.80),[0,.945,0]), '#211f1d');
  a.add('stove_top', T(box(1.20,.075,6.65),[0,1.005,0]), '#2d2a27', { metallic:.10, roughness:.82 });
  const slots=[-2.6,-1.3,0,1.3,2.6];
  slots.forEach((z,i) => {
    a.add(`burner_ring_${i}`, T(cylinder(.23,.032,12),[-.05,1.063,z]), '#201d1b', { metallic:.18, roughness:.76 });
    a.add(`burner_plate_${i}`, T(cylinder(.13,.042,10),[-.05,1.085,z]), '#403a35', { metallic:.12, roughness:.78 });
    a.add(`burner_cap_${i}`, T(cylinder(.078,.036,10),[-.05,1.108,z]), '#171513', { metallic:.10, roughness:.84 });
    for(let k=0;k<4;k++)
      a.add(`grate_${i}_${k}`, T(box(.46,.026,.045),[-.05,1.105,z],[0,k*Math.PI/4,0]), '#24211e', { metallic:.12, roughness:.82 });
    a.add(`knob_${i}`, T(cylinder(.064,.058,10),[-.68,.88,z],[0,0,Math.PI/2]), '#24211f', { roughness:.86 });
    a.add(`knob_face_${i}`, T(cylinder(.043,.016,10),[-.714,.88,z],[0,0,Math.PI/2]), '#514a44', { roughness:.78 });
    a.add(`knob_mark_${i}`, T(box(.012,.014,.052),[-.725,.88,z+.027]), '#e4ded2');
  });
});

/* ── 방 — 중심 원점. 게임 코드가 기존 방 좌표에 통째로 놓는다. ── */
save('room/floor', a => {
  a.add('floor_slab', T(box(16,.10,20),[0,0,0]), '#dce8ee', { roughness:.94 });
  // 작업 구역 색은 넣지 않고, 바닥 재질을 읽을 수 있는 얇은 타일 줄눈만 둔다.
  const grout='#aebfca';
  for(let x=-7;x<=7;x+=1)
    a.add(`grout_x_${x+7}`, T(box(.018,.008,19.92),[x,.054,0]), grout, { roughness:.96 });
  for(let z=-9;z<=9;z+=1)
    a.add(`grout_z_${z+9}`, T(box(15.92,.008,.018),[0,.054,z]), grout, { roughness:.96 });
});

save('room/ceiling', a => {
  a.add('ceiling_slab', T(box(16,.10,20),[0,0,0]), '#f8f6f0', { roughness:.96 });
  // 긴 천장 면이 한 장의 종이처럼 보이지 않도록 아주 얕은 패널 이음만 만든다.
  for(const x of [-4,4])
    a.add(`ceiling_seam_x_${x}`, T(box(.025,.008,19.80),[x,-.054,0]), '#dddcd6', { roughness:.98 });
  for(const z of [-6.6,0,6.6])
    a.add(`ceiling_seam_z_${String(z).replace('.','_')}`, T(box(15.80,.008,.025),[0,-.054,z]), '#dddcd6', { roughness:.98 });
});

function roomWallX(a, baseColor, interiorSign) {
  const faceZ=interiorSign*.064, trimZ=interiorSign*.080;
  a.add('wall_shell', box(16,3.4,.10), baseColor, { roughness:.94 });
  a.add('tile_skirt', T(box(15.90,1.16,.025),[0,-1.10,faceZ]), '#bce5d3', { roughness:.90 });
  for(let x=-7.2,i=0;x<=7.2;x+=.8,i++)
    a.add(`tile_joint_v_${i}`, T(box(.018,1.16,.010),[x,-1.10,trimZ]), '#78ad98', { roughness:.96 });
  for(const [i,y] of [-1.30,-.90].entries())
    a.add(`tile_joint_h_${i}`, T(box(15.90,.018,.010),[0,y,trimZ]), '#78ad98', { roughness:.96 });
  a.add('molding', T(box(15.90,.07,.035),[0,-.49,trimZ]), '#eef5f1', { roughness:.88 });
}

function roomWallZ(a, baseColor, interiorSign) {
  const faceX=interiorSign*.064, trimX=interiorSign*.080;
  a.add('wall_shell', box(.10,3.4,20), baseColor, { roughness:.94 });
  a.add('tile_skirt', T(box(.025,1.16,19.90),[faceX,-1.10,0]), '#bce5d3', { roughness:.90 });
  for(let z=-9.6,i=0;z<=9.6;z+=.8,i++)
    a.add(`tile_joint_v_${i}`, T(box(.010,1.16,.018),[trimX,-1.10,z]), '#78ad98', { roughness:.96 });
  for(const [i,y] of [-1.30,-.90].entries())
    a.add(`tile_joint_h_${i}`, T(box(.010,.018,19.90),[trimX,y,0]), '#78ad98', { roughness:.96 });
  a.add('molding', T(box(.035,.07,19.90),[trimX,-.49,0]), '#eef5f1', { roughness:.88 });
}

save('room/wall-back', a => roomWallX(a, '#f2e2c4', -1));
save('room/wall-front', a => roomWallX(a, '#f6ead0', 1));
save('room/wall-left', a => roomWallZ(a, '#cbe6da', 1));
save('room/wall-right', a => roomWallZ(a, '#e9d9c8', -1));

save('station/bin', a => {
  a.add('bin_body', T(cylinder(.42,.86,12,.35),[0,.44,0]), '#3f7a4a');
  a.add('body_band', T(cylinder(.435,.055,12),[0,.62,0]), '#315f3b');
  a.add('lid', T(cylinder(.45,.08,12),[0,.94,0]), '#294f31');
  a.add('lid_handle', T(cylinder(.18,.065,10),[0,.995,0]), '#203e27');
  a.add('pedal', T(box(.30,.055,.17),[-.34,.045,0]), '#4a4f55', { metallic:.20, roughness:.62 });
  a.add('pedal_link', T(cylinder(.022,.82,6),[-.44,.46,0]), '#6b7178', { metallic:.28, roughness:.58 });
});

console.log(`Generated ${generatedCount} low-poly food, kitchen, and room assets.`);

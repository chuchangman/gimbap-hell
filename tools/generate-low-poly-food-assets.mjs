import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets');

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
    i.push(a, b, a + 1, a + 1, b, b + 1);
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
    i.push(a,b,a+1, a+1,b,b+1);
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
      if (reverse) i.push(base,base+k+1,base+k); else i.push(base,base+k,base+k+1);
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
  const asset = new Asset(name); build(asset);
  asset.write(path.join(OUT, name + '.glb'));
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
  a.add('radish', T(cylinder(.075,.50,10),[0,0,0],[0,0,Math.PI/2]), C.danmuji);
  a.add('cut_end', T(cylinder(.064,.006,10),[.253,0,0],[0,0,Math.PI/2]), '#ffe253');
});
save('raw/ham', a => {
  a.add('ham_block', box(.34,.11,.24), C.hamRaw);
  for (let k=-1;k<=1;k++) a.add(`ham_layer_${k+2}`, T(box(.342,.006,.242),[0,k*.035,0]), '#e9a9ad');
});
save('raw/egg', a => {
  a.add('egg_shell', eggShape(.13,.33,.13,10,7), '#f4ead5', { roughness:.98 });
});
save('raw/cucumber', a => {
  a.add('skin', T(cylinder(.08,.50,10),[0,0,0],[0,0,Math.PI/2]), C.cucumberSkin);
  a.add('cut_face', T(cylinder(.069,.008,10),[.254,0,0],[0,0,Math.PI/2]), C.cucumber);
  a.add('seed', T(uvSphere(.012,.004,.005,6,3),[.259,.018,0],[0,0,Math.PI/2]), '#e4efad');
  a.add('seed2', T(uvSphere(.012,.004,.005,6,3),[.259,-.012,.020],[0,0,Math.PI/2]), '#e4efad');
});
save('raw/spinach', a => {
  for (let k=0;k<5;k++) {
    const z=(k-2)*.045, x=(k-2)*.085;
    a.add(`stem_${k}`, T(cylinder(.012,.30,7),[x*.45,-.015,z],[0,0,Math.PI/2]), '#72a950');
    a.add(`leaf_${k}`, T(uvSphere(.115,.028,.072,7,4),[x+.03,(k%2)*.025,z],[0,k*.7,(k-2)*.10]), k%2 ? C.spinachRaw : '#347d35');
  }
});
save('raw/carrot', a => {
  a.add('carrot_root', T(cylinder(.085,.42,10,.025),[0,0,0],[0,0,-Math.PI/2]), C.carrot);
  for (let k=-1;k<=1;k++) a.add(`carrot_leaf_${k}`, T(uvSphere(.070,.025,.035,7,3),[-.22,.045,k*.035],[0,k*.6,k*.22]), '#4f8f38');
});
save('raw/fishcake', a => {
  for (let k=0;k<2;k++) {
    const z=-.025+k*.05, rot=(k?-.08:.10);
    a.add(`fishcake_sheet_${k}`, T(box(.40,.025,.29),[0,-.012+k*.028,z],[0,rot,0]), C.fishcake);
    for (let d=-2;d<=2;d++) a.add(`toast_${k}_${d}`, T(box(.025,.001,.022),[d*.07,.001+k*.028,z+d%2*.018],[0,rot,0]), '#d9c39c');
  }
});

// 김, 쌀, 밥.
save('item/gim', a => {
  a.add('gim_sheet', box(.64,.014,.52), C.gim, { doubleSided: true });
  a.add('top_edge', T(box(.64,.004,.018),[0,.009,.251]), C.gimEdge);
  a.add('bottom_edge', T(box(.64,.004,.018),[0,.009,-.251]), C.gimEdge);
  for (let k=-2;k<=2;k++) a.add(`fiber_${k}`, T(box(.006,.002,.47),[k*.105,.008,0]), k%2 ? '#294c32' : '#355b3d');
});
save('item/rice', a => {
  const bowlProfile = [[0,-.070],[.10,-.070],[.145,-.052],[.180,-.016],[.205,.032],[.210,.058],
    [.188,.058],[.180,.034],[.155,.004],[.120,-.023],[0,-.023]];
  a.add('bowl', revolveProfile(bowlProfile,12), '#e8eee9', { roughness:.88 });
  a.add('bowl_base', T(cylinder(.105,.012,12),[0,-.064,0]), '#b8c9c5', { roughness:.82 });
  a.add('rice_surface', T(cylinder(.153,.020,12),[0,.027,0]), C.riceRaw);
  for (let k=0;k<14;k++) {
    const a0=k*2.399, rr=.030+.009*(k%4), x=Math.cos(a0)*rr*(1+k/18), z=Math.sin(a0)*rr*(1+k/18);
    a.add(`grain_${k}`, T(uvSphere(.018,.007,.009,6,3),[x,.041+(k%3)*.002,z],[0,a0,k*.17]), k%3 ? C.riceRaw : '#faf5e8');
  }
  a.add('water', T(cylinder(.158,.003,12),[0,.052,0]), C.water, { opacity:.14, roughness:.30 });
});
save('item/bap', a => {
  a.add('rice_mound', uvSphere(.20,.11,.17,10,6), C.rice);
  for (let k=0;k<12;k++) {
    const a0=k*2.4, rr=.025+.012*(k%5), x=Math.cos(a0)*rr*(1+k/10), z=Math.sin(a0)*rr*(1+k/10);
    const y=.085*Math.sqrt(Math.max(0,1-(x*x/.04)-(z*z/.0289)));
    a.add(`cooked_grain_${k}`, T(uvSphere(.020,.008,.010,6,3),[x,y+.012,z],[0,a0,k*.21]), k%2 ? '#ffffff' : '#f0eadb');
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

save('station/bin', a => {
  a.add('bin_body', T(cylinder(.42,.86,12,.35),[0,.44,0]), '#3f7a4a');
  a.add('body_band', T(cylinder(.435,.055,12),[0,.62,0]), '#315f3b');
  a.add('lid', T(cylinder(.45,.08,12),[0,.94,0]), '#294f31');
  a.add('lid_handle', T(cylinder(.18,.065,10),[0,.995,0]), '#203e27');
  a.add('pedal', T(box(.30,.055,.17),[-.34,.045,0]), '#4a4f55', { metallic:.20, roughness:.62 });
  a.add('pedal_link', T(cylinder(.022,.82,6),[-.44,.46,0]), '#6b7178', { metallic:.28, roughness:.58 });
});

console.log('Generated 28 low-poly food and kitchen assets.');

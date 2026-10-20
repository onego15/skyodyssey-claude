// Scene construction: sky, ocean, terrain meshes, clouds, lighting and
// the per-frame environment update (fog banks, cloud layers, time of day).
import * as THREE from 'three';
import { Terrain, bakeWorldHeight, SEA_FLOOR, canyonInfo } from './terrain.js';
import { WORLD, CLOUD_SEA, FOG_BANK, ISLANDS, RUNWAYS, runwayLocal, RUINS, CANYON } from './layout.js';
import { Simplex2, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import { TIMES } from './env.js';
import { buildProps } from './props.js';

const tmpColor = new THREE.Color();

function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
export { canvasTexture };

// Tileable periodic value noise (no directional streaks) for terrain detail.
function detailTexture() {
  const rnd = mulberry32(77);
  const S = 512;
  const octs = [[8, 0.45], [16, 0.25], [32, 0.15], [64, 0.1], [128, 0.05]];
  const grids = octs.map(([n]) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; });
  const sm = (t) => t * t * (3 - 2 * t);
  return canvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0;
      octs.forEach(([n, amp], k) => {
        const fx = x / S * n, fy = y / S * n;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const G = grids[k], A = (i, j) => G[((j + n) % n) * n + ((i + n) % n)];
        const top = A(ix, iy) + (A(ix + 1, iy) - A(ix, iy)) * tx;
        const bot = A(ix, iy + 1) + (A(ix + 1, iy + 1) - A(ix, iy + 1)) * tx;
        v += amp * (top + (bot - top) * ty);
      });
      const k = 196 + v * 70 + (rnd() - 0.5) * 10;
      const i = (y * S + x) * 4;
      img.data[i] = clamp(k * 0.98, 0, 255); img.data[i + 1] = clamp(k, 0, 255); img.data[i + 2] = clamp(k * 0.95, 0, 255); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
}

function waterNormalTexture() {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const rnd = mulberry32(5);
  const waves = [];
  for (let k = 0; k < 28; k++) {
    const fx = Math.round((rnd() * 2 - 1) * (2 + k * 0.6));
    const fy = Math.round((rnd() * 2 - 1) * (2 + k * 0.6));
    if (fx === 0 && fy === 0) continue;
    waves.push({ fx, fy, a: 1 / (1 + Math.hypot(fx, fy) * 0.5), p: rnd() * 6.28 });
  }
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const w of waves) v += w.a * Math.sin((w.fx * x + w.fy * y) / S * Math.PI * 2 + w.p);
    hgt[y * S + x] = v;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)];
    const dy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
    const nx = -dx * 0.25, ny = -dy * 0.25, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4;
    data[i] = (nx / l * 0.5 + 0.5) * 255;
    data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FS = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunColor; uniform vec3 uGlow; uniform float uStars;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float s = max(dot(d, uSunDir), 0.0);
  float hz = pow(1.0 - abs(h), 6.0);
  col += uGlow * pow(s, 4.0) * hz * 0.55;
  col += uSunColor * (pow(s, 32.0) * 0.35 + pow(s, 600.0) * 1.2);
  col += uSunColor * smoothstep(0.99955, 0.9998, s) * 6.0;
  if (uStars > 0.0 && h > 0.0) {
    vec3 q = floor(d * 400.0);
    float st = step(0.9975, hash(q));
    col += vec3(st) * uStars * smoothstep(0.0, 0.4, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_VS = /* glsl */`
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS = /* glsl */`
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uZenith; uniform vec3 uHorizon;
uniform vec3 uDeep; uniform vec3 uShallow; uniform sampler2D uNormal; uniform sampler2D uDepth;
uniform vec2 uWorldMin; uniform vec2 uWorldSize; uniform float uRiver; uniform float uAmbient;
varying vec3 vWorld;
#include <fog_pars_fragment>
vec3 sampleN(vec2 uv) { vec3 n = texture2D(uNormal, uv).xyz * 2.0 - 1.0; return n; }
void main() {
  float dist = length(cameraPosition - vWorld);
  vec2 p = vWorld.xz;
  vec3 n1 = sampleN(p / 210.0 + uTime * vec2(0.010, 0.006));
  vec3 n2 = sampleN(p / 61.0 + uTime * vec2(-0.017, 0.011));
  vec3 n3 = sampleN(p / 17.0 + uTime * vec2(0.03, -0.025));
  float fade = 1.0 / (1.0 + dist * 0.0006);
  vec2 slope = (n1.xy * 0.8 + n2.xy * 0.6 + n3.xy * 0.35 * fade) * (0.35 + 0.65 * fade);
  if (uRiver > 0.5) slope = (n2.xy + n3.xy) * 0.4;
  vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.6));
  float depth = 40.0;
  if (uRiver < 0.5) {
    vec2 tuv = (p - uWorldMin) / uWorldSize;
    if (tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) depth = texture2D(uDepth, tuv).r * 50.0;
  } else depth = 16.0;
  vec3 base = mix(uShallow, uDeep, smoothstep(0.5, 26.0, depth));
  float sunAmt = max(uSunDir.y, 0.05);
  base *= (0.35 + 0.75 * sunAmt) * uAmbient;
  vec3 col = mix(base, sky, clamp(fres, 0.0, 1.0) * 0.7);
  float spec = pow(max(dot(R, uSunDir), 0.0), 380.0) * 5.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.18;
  col += uSunColor * spec;
  float foamN = texture2D(uNormal, p / 9.0 + uTime * 0.05).x;
  float foam = smoothstep(2.2, 0.2, depth) * smoothstep(0.35, 0.65, foamN + 0.25 * sin(uTime * 1.3 + depth * 2.0));
  if (uRiver > 0.5) foam = smoothstep(0.6, 0.75, foamN) * 0.35;
  col = mix(col, vec3(0.95, 0.97, 1.0) * (0.6 + 0.5 * sunAmt), foam * 0.75);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const CLOUDSEA_VS = /* glsl */`
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const CLOUDSEA_FS = /* glsl */`
uniform float uTime; uniform vec3 uCenter; uniform float uRadius; uniform vec3 uLit; uniform vec3 uShade;
uniform float uLayer; uniform sampler2D uNoise; uniform vec3 uSunDir;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz;
  float n = texture2D(uNoise, p / 2600.0 + vec2(uTime * 0.002, uLayer * 0.13)).r * 0.55
          + texture2D(uNoise, p / 900.0 - vec2(uTime * 0.004, -uTime * 0.002) + uLayer * 0.31).r * 0.3
          + texture2D(uNoise, p / 260.0 + uLayer * 0.7).r * 0.15;
  float r = length(p - uCenter.xz) / uRadius;
  float edge = 1.0 - smoothstep(0.7, 1.0, r);
  float a = smoothstep(0.42 - uLayer * 0.04, 0.62, n * (0.55 + 0.6 * edge)) * edge;
  float camDy = abs(cameraPosition.y - vWorld.y);
  float camD = length(cameraPosition.xz - p);
  a *= smoothstep(0.0, 60.0, camDy + camD * 0.08);
  if (a < 0.01) discard;
  float lightK = 0.65 + 0.35 * smoothstep(0.3, 0.9, n);
  vec3 col = mix(uShade, uLit, lightK * (0.75 + 0.25 * uLayer));
  if (cameraPosition.y < vWorld.y) col *= 0.8;
  gl_FragColor = vec4(col, a * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function noiseTexture(seed) {
  const n = new Simplex2(seed);
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < 5; o++) {
      v += amp * n.noise(Math.cos(a) * f * 1.3 + o * 7, Math.sin(a) * f * 1.3 + Math.cos(b) * f * 1.3 * 0.0 + o * 3)
        * 0.5 + amp * n.noise(Math.cos(b) * f * 1.3 + o * 11, Math.sin(b) * f * 1.3 + Math.sin(a) * f) * 0.5;
      amp *= 0.5; f *= 2;
    }
    const k = clamp(128 + v * 230, 0, 255);
    const i = (y * S + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = k; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function puffTexture(seed) {
  const rnd = mulberry32(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 26; k++) {
      const r = 30 + rnd() * 60;
      const x = w / 2 + (rnd() - 0.5) * (w - 2 * r) * 0.9;
      const y = h * 0.55 + (rnd() - 0.6) * (h - 2 * r) * 0.6;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(0.6, 'rgba(255,255,255,0.25)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
}

const TERRAIN_STYLE = {
  default: {
    sand: '#d6c69c', grass: '#5d8238', grass2: '#98a85c', forest: '#36552a', rock: '#8a8174', rock2: '#5f5952', snow: '#f2f4f8', under: '#6d8a78',
  },
  phantom: {
    sand: '#e2d6b4', grass: '#4b9a7e', grass2: '#7fb98c', forest: '#2f6a5c', rock: '#8f93a6', rock2: '#62667a', snow: '#f4f6fa', under: '#5e8c8e',
  },
};

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0;
    this.terrain = new Terrain();
    this.colliders = [];
    this.n = new Simplex2(31);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 1200;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.6;
    scene.add(this.sunLight, this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xffffff, 0.00007);

    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildRiver();
    this.buildClouds();
    this.buildCloudSea();
    this.buildFogBank();
    this.props = buildProps(this);
    this.setTime('dawn');
  }

  buildSky() {
    this.skyUniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uStars: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildTerrain() {
    const detail = detailTexture();
    this.terrainMeshes = [];
    const noise = this.n;
    const col = new THREE.Color(), c2 = new THREE.Color();
    for (const g of this.terrain.grids) {
      const style = g.id === 'phantom' ? TERRAIN_STYLE.phantom : TERRAIN_STYLE.default;
      const S = {};
      for (const k in style) S[k] = new THREE.Color(style[k]);
      const n = g.n;
      const pos = new Float32Array(n * n * 3);
      const nor = new Float32Array(n * n * 3);
      const colr = new Float32Array(n * n * 3);
      const uv = new Float32Array(n * n * 2);
      const H = (i, j) => g.h[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const k = j * n + i;
          const x = g.minX + i * g.cell, z = g.minZ + j * g.cell;
          const h = g.h[k];
          pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
          const nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1), ny = 2 * g.cell;
          const l = Math.hypot(nx, ny, nz);
          nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
          const slope = 1 - ny / l; // 0 flat .. 1 vertical
          uv[k * 2] = x / 61; uv[k * 2 + 1] = z / 61;
          const nn = noise.fbm(x * 0.004, z * 0.004, 3);
          const nb = noise.noise(x * 0.02 + 40, z * 0.02);
          if (h < 1.5) {
            col.copy(S.under).lerp(S.sand, smoothstep(-12, 1.5, h));
          } else if (h < 5 + nn * 3) {
            col.copy(S.sand);
          } else {
            col.copy(S.grass).lerp(S.grass2, clamp(0.5 + nn * 0.9, 0, 1));
            col.lerp(S.forest, clamp(smoothstep(0.0, 0.5, noise.fbm(x * 0.0018 + 3, z * 0.0018, 3)) * 0.8, 0, 1));
            // drier up high
            c2.copy(S.rock).lerp(S.grass2, 0.4);
            col.lerp(c2, smoothstep(500, 900, h + nn * 120) * 0.7);
            const rockT = smoothstep(0.28 + nb * 0.05, 0.5, slope);
            c2.copy(S.rock).lerp(S.rock2, clamp(0.5 + nb, 0, 1));
            col.lerp(c2, rockT);
            const snowT = smoothstep(1080, 1250, h + nn * 110) * (1 - smoothstep(0.45, 0.7, slope));
            col.lerp(S.snow, snowT);
          }
          // cheap ambient occlusion from local concavity, plus patchy variation
          const avg = (H(i - 2, j) + H(i + 2, j) + H(i, j - 2) + H(i, j + 2)) * 0.25;
          const ao = clamp(1 + (h - avg) / 40, 0.62, 1.08);
          const patch = 1 + 0.09 * noise.noise(x * 0.011 + 17, z * 0.011 - 5);
          col.multiplyScalar(ao * patch);
          colr[k * 3] = col.r; colr[k * 3 + 1] = col.g; colr[k * 3 + 2] = col.b;
        }
      }
      const idx = new Uint32Array(g.res * g.res * 6);
      let p = 0;
      for (let j = 0; j < g.res; j++) for (let i = 0; i < g.res; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = d; idx[p++] = b; idx[p++] = c;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, map: detail });
      if (g.id === 'phantom') this.phantomMat = mat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.userData.grid = g;
      this.scene.add(mesh);
      this.terrainMeshes.push(mesh);
    }
    this.installMirage(this.phantomMat);
  }

  // The phantom island fades into fog until the player is close.
  installMirage(mat) {
    this.mirage = { value: 1 };
    const center = new THREE.Vector3(ISLANDS.phantom.x, 0, ISLANDS.phantom.z);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uMirage = this.mirage;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nuniform float uMirage;')
        .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uMirage);\n#endif');
    };
    this.mirageCenter = center;
  }

  buildWater() {
    const { data, res } = bakeWorldHeight(this.terrain, 512);
    this.worldHeight = { data, res };
    const d8 = new Uint8Array(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      const v = clamp(-data[i] / 50, 0, 1) * 255;
      d8[i * 4] = v; d8[i * 4 + 1] = v; d8[i * 4 + 2] = v; d8[i * 4 + 3] = 255;
    }
    const depthTex = new THREE.DataTexture(d8, res, res, THREE.RGBAFormat);
    depthTex.magFilter = THREE.LinearFilter; depthTex.minFilter = THREE.LinearFilter;
    depthTex.needsUpdate = true;
    this.waterUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() },
      uNormal: { value: null }, uDepth: { value: null },
      uWorldMin: { value: new THREE.Vector2(WORLD.minX, WORLD.minZ) },
      uWorldSize: { value: new THREE.Vector2(WORLD.maxX - WORLD.minX, WORLD.maxZ - WORLD.minZ) },
      uRiver: { value: 0 }, uAmbient: { value: 1 },
    }]);
    this.waterUniforms.uNormal.value = waterNormalTexture();
    this.waterUniforms.uDepth.value = depthTex;
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms, vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true,
    });
    const geo = new THREE.PlaneGeometry(120000, 120000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.renderOrder = -1;
    this.water.frustumCulled = false;
    this.scene.add(this.water);
  }

  buildRiver() {
    // A ribbon of water following the canyon floor.
    const pts = [];
    for (let i = 0; i < CANYON.length - 1; i++) {
      const a = CANYON[i], b = CANYON[i + 1];
      const steps = 24;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push(new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.floor, b.floor, t), lerp(a.z, b.z, t)));
      }
    }
    const last = CANYON[CANYON.length - 1];
    pts.push(new THREE.Vector3(last.x, last.floor, last.z));
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
      const dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1;
      const rx = dz / l, rz = -dx / l;
      const w = 34 + 10 * Math.sin(i * 0.3);
      const y = this.terrain.height(p.x, p.z) + 1.6;
      pos.push(p.x - rx * w, Math.max(y, 0.3), p.z - rz * w, p.x + rx * w, Math.max(y, 0.3), p.z + rz * w);
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = this.waterMat.clone();
    mat.uniforms = this.waterUniforms; // share
    this.riverMat = new THREE.ShaderMaterial({
      uniforms: { ...this.waterUniforms, uRiver: { value: 1 } },
      vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.river = new THREE.Mesh(geo, this.riverMat);
    this.scene.add(this.river);
  }

  buildClouds() {
    this.puffTex = [puffTexture(1), puffTexture(2), puffTexture(3)];
    const rnd = mulberry32(99);
    const puffs = [];
    const make = (cx, cy, cz, scale, n, alpha = 0.95) => {
      for (let k = 0; k < n; k++) {
        const sx = scale * (0.7 + rnd() * 0.7);
        const dy = (rnd() - 0.3) * scale * 0.35;
        puffs.push({
          x: cx + (rnd() - 0.5) * scale * 2.2, y: cy + dy, z: cz + (rnd() - 0.5) * scale * 1.6,
          sx: sx * 1.6, sy: sx, shade: clamp(0.55 + (dy / (scale * 0.35)) * 0.6, 0.3, 1), tex: k % 3, alpha,
        });
      }
    };
    const avoid = Object.values(RUNWAYS);
    let placed = 0;
    while (placed < 80) {
      const x = lerp(WORLD.minX, WORLD.maxX, rnd()), z = lerp(WORLD.minZ, WORLD.maxZ, rnd());
      if (avoid.some((r) => Math.hypot(r.x - x, r.z - z) < 1400)) continue;
      if (Math.hypot(x - CLOUD_SEA.x, z - CLOUD_SEA.z) < CLOUD_SEA.r * 0.8) continue;
      if (Math.hypot(x - FOG_BANK.x, z - FOG_BANK.z) < FOG_BANK.outer) continue;
      make(x, 650 + rnd() * 650, z, 160 + rnd() * 170, 6 + Math.floor(rnd() * 7));
      placed++;
    }
    // puffs hugging the rim of the cloud sea
    for (let k = 0; k < 46; k++) {
      const a = rnd() * Math.PI * 2, r = CLOUD_SEA.r * (0.72 + rnd() * 0.3);
      make(CLOUD_SEA.x + Math.sin(a) * r, CLOUD_SEA.y + 30 + rnd() * 80, CLOUD_SEA.z + Math.cos(a) * r, 220 + rnd() * 160, 5);
    }
    this.cloudField = this.makeBillboards(puffs, 2);
    this.scene.add(this.cloudField);
  }

  // One draw call for many camera-facing cloud puffs.
  makeBillboards(puffs, renderOrder) {
    const atlas = document.createElement('canvas');
    atlas.width = 768; atlas.height = 256;
    const ag = atlas.getContext('2d');
    this.puffTex.forEach((t, i) => ag.drawImage(t.image, i * 256, 0));
    const tex = new THREE.CanvasTexture(atlas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const n = puffs.length;
    const iPos = new Float32Array(n * 3), iScale = new Float32Array(n * 2), iMisc = new Float32Array(n * 3);
    puffs.forEach((p, i) => {
      iPos.set([p.x, p.y, p.z], i * 3); iScale.set([p.sx, p.sy], i * 2); iMisc.set([p.shade, p.tex, p.alpha], i * 3);
    });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(iScale, 2));
    geo.setAttribute('iMisc', new THREE.InstancedBufferAttribute(iMisc, 3));
    geo.instanceCount = n;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uMap: { value: null }, uLit: { value: new THREE.Color('#ffffff') }, uShade: { value: new THREE.Color('#aab') }, uOpacity: { value: 1 },
    }]);
    uniforms.uMap.value = tex;
    const mat = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, fog: true,
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iScale; attribute vec3 iMisc;
        uniform vec3 uLit; uniform vec3 uShade;
        varying vec2 vUv; varying vec3 vCol; varying float vA;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
          mvPosition.xy += position.xy * iScale;
          vUv = vec2((uv.x + iMisc.y) / 3.0, uv.y);
          vCol = mix(uShade, uLit, iMisc.x);
          float d = -mvPosition.z;
          vA = iMisc.z * smoothstep(8.0, max(iScale.y * 0.9, 30.0), d);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform float uOpacity;
        varying vec2 vUv; varying vec3 vCol; varying float vA;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * vA * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vCol, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  buildCloudSea() {
    const tex = noiseTexture(5);
    this.cloudSeaMats = [];
    this.cloudSea = new THREE.Group();
    for (let L = 0; L < 4; L++) {
      const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3(CLOUD_SEA.x, 0, CLOUD_SEA.z) },
        uRadius: { value: CLOUD_SEA.r }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() },
        uLayer: { value: L / 3 }, uNoise: { value: null }, uSunDir: { value: new THREE.Vector3() },
      }]);
      uniforms.uNoise.value = tex;
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: CLOUDSEA_VS, fragmentShader: CLOUDSEA_FS, fog: true,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const geo = new THREE.CircleGeometry(CLOUD_SEA.r, 96);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(CLOUD_SEA.x, CLOUD_SEA.y + L * 22, CLOUD_SEA.z);
      m.renderOrder = 3 + L;
      this.cloudSea.add(m);
      this.cloudSeaMats.push(mat);
    }
    this.scene.add(this.cloudSea);
  }

  buildFogBank() {
    const rnd = mulberry32(1234);
    const puffs = [];
    for (let k = 0; k < 190; k++) {
      const a = rnd() * Math.PI * 2;
      const r = lerp(FOG_BANK.inner + 200, FOG_BANK.outer - 300, rnd());
      const sc = 500 + rnd() * 500;
      puffs.push({ x: FOG_BANK.x + Math.sin(a) * r, y: 80 + rnd() * 420, z: FOG_BANK.z + Math.cos(a) * r, sx: sc * 1.8, sy: sc, shade: 0.75 + rnd() * 0.25, tex: k % 3, alpha: 0.85 });
    }
    this.fogBank = this.makeBillboards(puffs, 1);
    this.scene.add(this.fogBank);
  }

  setTime(key) {
    const T = TIMES[key];
    this.timeKey = key;
    this.T = T;
    const u = this.skyUniforms;
    u.uSunDir.value.copy(T.sun);
    u.uZenith.value.set(T.zenith); u.uHorizon.value.set(T.horizon); u.uGround.value.set(T.ground);
    u.uSunColor.value.set(T.sunColor); u.uGlow.value.set(T.glow);
    u.uStars.value = key === 'sunset' ? 0.12 : 0;
    this.baseFogColor = new THREE.Color(T.horizon).lerp(new THREE.Color(T.ground), 0.15);
    this.scene.fog.color.copy(this.baseFogColor);
    this.baseFogDensity = T.fogDensity;
    this.sunLight.color.set(T.sunColor);
    this.sunLight.intensity = T.sunIntensity;
    this.hemi.color.set(T.hemiSky); this.hemi.groundColor.set(T.hemiGround);
    this.hemi.intensity = T.hemiIntensity;
    const w = this.waterUniforms;
    w.uSunDir.value.copy(T.sun); w.uSunColor.value.set(T.sunColor);
    w.uZenith.value.set(T.zenith); w.uHorizon.value.set(T.horizon);
    w.uDeep.value.set(T.water.deep); w.uShallow.value.set(T.water.shallow);
    w.uAmbient.value = key === 'sunset' ? 0.75 : 1;
    const lit = new THREE.Color(T.cloud), shade = new THREE.Color(T.cloudShade);
    this.cloudField.material.uniforms.uLit.value.copy(lit);
    this.cloudField.material.uniforms.uShade.value.copy(shade);
    this.fogBank.material.uniforms.uLit.value.copy(lit);
    this.fogBank.material.uniforms.uShade.value.copy(shade).lerp(lit, 0.4);
    for (const m of this.cloudSeaMats) {
      m.uniforms.uLit.value.copy(lit); m.uniforms.uShade.value.copy(shade);
      m.uniforms.uSunDir.value.copy(T.sun);
    }
    if (this.props) this.props.setTime(key);
  }

  // Per-frame environment update. Returns info about atmosphere at the camera.
  update(dt, camera, focus) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * 0.9);
    this.water.position.set(Math.round(camera.position.x / 100) * 100, 0, Math.round(camera.position.z / 100) * 100);
    this.waterUniforms.uTime.value = this.time;
    for (const m of this.cloudSeaMats) m.uniforms.uTime.value = this.time;

    // Shadow camera follows the aircraft.
    const sun = this.T.sun;
    this.sunLight.position.set(focus.x + sun.x * 500, focus.y + sun.y * 500, focus.z + sun.z * 500);
    this.sunLight.target.position.copy(focus);

    // Fog: base + cloud sea immersion + phantom fog bank.
    let density = this.baseFogDensity;
    const fogCol = tmpColor.copy(this.baseFogColor);
    const cp = camera.position;
    const dCS = Math.hypot(cp.x - CLOUD_SEA.x, cp.z - CLOUD_SEA.z);
    let inCloud = 0;
    if (dCS < CLOUD_SEA.r * 0.85) {
      const dy = cp.y - (CLOUD_SEA.y + 30);
      inCloud = 1 - smoothstep(25, 70, Math.abs(dy));
      inCloud *= 1 - smoothstep(CLOUD_SEA.r * 0.6, CLOUD_SEA.r * 0.85, dCS);
      // under the clouds the light is softer
      if (dy < 0) density = lerp(density, 0.00022, smoothstep(0, -60, dy) * (1 - smoothstep(CLOUD_SEA.r * 0.5, CLOUD_SEA.r * 0.85, dCS)));
    }
    density = lerp(density, 0.006, inCloud);
    fogCol.lerp(new THREE.Color(this.T.cloud), inCloud * 0.9);

    const dFB = Math.hypot(cp.x - FOG_BANK.x, cp.z - FOG_BANK.z);
    let bank = 0;
    if (dFB < FOG_BANK.outer + 600) {
      bank = smoothstep(FOG_BANK.outer + 600, FOG_BANK.outer - 400, dFB) * (1 - smoothstep(FOG_BANK.inner + 400, FOG_BANK.inner - 300, dFB));
      density = lerp(density, 0.0011, bank * (1 - smoothstep(500, 900, cp.y)));
      fogCol.lerp(new THREE.Color(this.T.cloud).lerp(this.baseFogColor, 0.5), bank * 0.6);
    }
    this.scene.fog.density = density;
    this.scene.fog.color.copy(fogCol);
    // Mirage: phantom island invisible from afar.
    const dP = Math.hypot(cp.x - ISLANDS.phantom.x, cp.z - ISLANDS.phantom.z);
    this.mirage.value = smoothstep(FOG_BANK.inner + 600, FOG_BANK.outer + 300, dP);
    this.props.update(dt, camera, focus);
    return { inCloud, bank };
  }

  groundHeight(x, z) {
    const t = this.terrain.height(x, z);
    return t;
  }
}

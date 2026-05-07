// ═══════════════════════════════════════════════════════════════════════════
// render3d.js — Three.js render layer pro Balloon Belt (Fáze 1)
//
// Izolovaný ESM modul. Vystavuje API přes window.render3d, aby ho game.js
// (klasický script) mohl volat. Aktivace je přes URL param ?renderer=3d.
//
// Fáze 1 scope: pixely jako InstancedMesh BoxGeometry. Bloky/kanón/projektily
// pořád 2D (Canvas2D). Belt + carriers + pending nedotčené.
//
// Souřadnicový systém: OrthographicCamera s Y-flipped frustum (top=0, bottom=H)
// 1:1 mapuje grid souřadnice (x*SCALE, y*SCALE) na world coords. Cube center
// je posunutý o SCALE/2, aby grid[y][x] seděl na canvas pixelu (x*SCALE, y*SCALE).
// ═══════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';

const SCALE = 10;
const PIXEL_DEPTH = 18;       // baseline hloubka pixel-kostky (z-extent)
const PIXEL_LIFT = PIXEL_DEPTH / 2; // střed baseline kostky nad rovinou z=0
const PIXEL_INSET = 0.94;     // 1.0 = full size, <1 vytvoří mezery (6% = jemná separace)
const TILT_DEG = 19.2;        // tilt scény (°) — match Blender Camera.010 X rotation
const BEVEL_TEX_SIZE = 128;   // rozlišení bevel textury (vyšší = ostřejší highlights)
// Per-pixel height variation — některé kostky vyšší, aby povrch nebyl rovnoměrný.
// 3 tiery, deterministicky vybrané přes hash(x,y). Bottom plane všech kostek
// zůstává na z=0 (cube se „natáhne" nahoru). Chceš to vypnout? Nastav VARIANCE_AMPL=0.
const HEIGHT_TIERS = [1.0, 1.3, 1.5]; // násobiče PIXEL_DEPTH
const TIER_PROBS = [0.90, 0.08, 0.02]; // 90 % baseline, 8 % medium, 2 % tall
const VARIANCE_AMPL = 1.0;            // 0 = vše stejně vysoké, 1 = plná varianta

const state = {
  scene: null,
  camera: null,
  renderer: null,
  pixelMesh: null,
  colorCache: {},
  ready: false,
  canvasEl: null,
  GW: 36,
  GH: 31,
  IMG_GH: 27,
};

const _dummy = new THREE.Object3D();

function _getColor(hex) {
  if (!state.colorCache[hex]) state.colorCache[hex] = new THREE.Color(hex);
  return state.colorCache[hex];
}

// Deterministický hash (x, y) → [0,1). Stabilní napříč framy, takže výška
// pixelu se nezmění při každém renderu. Klasická xorshift-like permutace.
function _hash01(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff);
}

// Vrátí výškový tier (násobič PIXEL_DEPTH) pro pixel na pozici (x, y).
function _heightFor(x, y) {
  if (VARIANCE_AMPL <= 0) return 1.0;
  const r = _hash01(x, y);
  let acc = 0;
  for (let i = 0; i < TIER_PROBS.length; i++) {
    acc += TIER_PROBS[i];
    if (r < acc) {
      const tier = HEIGHT_TIERS[i];
      // Lerp mezi 1.0 a tier dle VARIANCE_AMPL (umožní soft tuning v jednom místě).
      return 1.0 + (tier - 1.0) * VARIANCE_AMPL;
    }
  }
  return HEIGHT_TIERS[HEIGHT_TIERS.length - 1];
}

// Procedurální bevel/highlight textura pro top face kostek. Simuluje pohled
// shora na 3D button — symetrický bevel po celém obvodu (highlight top+left,
// shadow bottom+right), jemný overall vertical gradient, malý specular hotspot.
// Aplikuje se přes material.map; per-instance color tintuje texturu.
//
// Designové rozhodnutí: NEMÁME diagonální gradient (sčítal se s vertikálním
// a vytvářel jednosměrný stín). Místo toho rovnoměrné 4 hrany + slabý vertical
// → pixel vypadá jako pravý 3D button viděný shora.
function _makeBevelTexture() {
  const N = BEVEL_TEX_SIZE;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d');

  // Base white — všechen tint dostává material.color × instanceColor.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, N, N);

  // 1) Slabý vertikální gradient — naznačí, že světlo je „shora".
  // Záměrně mírný, aby nepřebil edge bevels.
  const vgrad = ctx.createLinearGradient(0, 0, 0, N);
  vgrad.addColorStop(0, 'rgba(255,255,255,0.18)');
  vgrad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  vgrad.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vgrad;
  ctx.fillRect(0, 0, N, N);

  // 2) Bevel okraj — všechny 4 hrany STEJNĚ silné. Top+Left = highlight,
  // Bottom+Right = shadow. Symetrie po celém obvodu = pixel vypadá jako
  // konzistentní button bez jednosměrné dominance.
  const edge = Math.max(3, N * 0.11);
  const HI_ALPHA = 0.42;
  const SH_ALPHA = 0.42;

  // Top edge — světlý
  const eTop = ctx.createLinearGradient(0, 0, 0, edge);
  eTop.addColorStop(0, 'rgba(255,255,255,' + HI_ALPHA + ')');
  eTop.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = eTop;
  ctx.fillRect(0, 0, N, edge);
  // Left edge — světlý
  const eLeft = ctx.createLinearGradient(0, 0, edge, 0);
  eLeft.addColorStop(0, 'rgba(255,255,255,' + HI_ALPHA + ')');
  eLeft.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = eLeft;
  ctx.fillRect(0, 0, edge, N);
  // Bottom edge — tmavý
  const eBot = ctx.createLinearGradient(0, N - edge, 0, N);
  eBot.addColorStop(0, 'rgba(0,0,0,0)');
  eBot.addColorStop(1, 'rgba(0,0,0,' + SH_ALPHA + ')');
  ctx.fillStyle = eBot;
  ctx.fillRect(0, N - edge, N, edge);
  // Right edge — tmavý
  const eRight = ctx.createLinearGradient(N - edge, 0, N, 0);
  eRight.addColorStop(0, 'rgba(0,0,0,0)');
  eRight.addColorStop(1, 'rgba(0,0,0,' + SH_ALPHA + ')');
  ctx.fillStyle = eRight;
  ctx.fillRect(N - edge, 0, edge, N);

  // 3) AO outer ring — ostré tmavé okraje 2px pro definici hran proti sousedům.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, N, 2);
  ctx.fillRect(0, N - 2, N, 2);
  ctx.fillRect(0, 0, 2, N);
  ctx.fillRect(N - 2, 0, 2, N);

  // 4) Malý specular hotspot v horní části (centrovaný, ne v rohu) — jemný gloss.
  const spec = ctx.createRadialGradient(N * 0.5, N * 0.30, 0, N * 0.5, N * 0.30, N * 0.30);
  spec.addColorStop(0, 'rgba(255,255,255,0.32)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.fillRect(0, 0, N, N);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function init(canvas, opts) {
  if (state.ready) return true;
  if (!canvas) return false;
  opts = opts || {};
  state.canvasEl = canvas;
  state.GW = opts.GW || 36;
  state.GH = opts.GH || 31;
  state.IMG_GH = opts.IMG_GH || 27;

  const W = state.GW * SCALE;   // 360
  const H = state.GH * SCALE;   // 310

  // Scéna — standardní Y-up world (kladné Y = nahoře). Pixel placement flipuje
  // grid Y (grid[0] = top of screen → world Y=H, grid[IMG_GH-1] → world Y=H-IMG_H).
  state.scene = new THREE.Scene();

  // Tilt group — scéna se naklopí kolem X osy s pivotem ve středu image area.
  // OrthographicCamera zůstává top-down. Match Blender Camera.010 X=19.216°.
  // Pivot Y = střed image area v Y-up world: (H + (H-IMG_H))/2 = H - IMG_H/2.
  const imgH = state.IMG_GH * SCALE;
  const imgCenterY = H - imgH / 2;
  state.pivot = new THREE.Group();
  state.pivot.position.set(W / 2, imgCenterY, 0);
  state.scene.add(state.pivot);

  state.tiltGroup = new THREE.Group();
  // Záporné rotation.x = top of scene tilts BACKWARD (away from camera, +Z). To je
  // přesně Blender pohled: řády nahoře jsou v dálce, řády dole v popředí. Při ortho
  // se vidí top face + spodní část boční stěny každé kostky.
  state.tiltGroup.rotation.x = -TILT_DEG * Math.PI / 180;
  state.pivot.add(state.tiltGroup);

  state.contentGroup = new THREE.Group();
  state.contentGroup.position.set(-W / 2, -imgCenterY, 0);
  state.tiltGroup.add(state.contentGroup);

  // OrthographicCamera — frustum standardní Y-up (bottom=0, top=H). Frustum
  // generózní v Z (–500..500), aby tilt nezpůsobil clipping vyšších kostek.
  state.camera = new THREE.OrthographicCamera(0, W, H, 0, -500, 500);
  state.camera.position.set(0, 0, 100);

  // Lighting — HemisphereLight (sky + ground) ambient, DirectionalLight = „slunce"
  // ze shora a zleva (Y-up: kladné Y = nahoře, záporné X = vlevo). Cíl: pixely mají
  // top face highlight + viditelné shading na bočních stěnách (díky tiltu).
  const sky = new THREE.HemisphereLight(0xffffff, 0x6a6680, 1.0);
  state.scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-W * 0.4, H * 0.8, 300);
  state.scene.add(sun);
  // Subtilní fill zezadu/zprava, ať tmavé strany nejsou úplně černé.
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(W * 0.6, -H * 0.2, 200);
  state.scene.add(fill);

  // Renderer — alpha:true aby pixel-canvas pod tím prosvítal (bloky 2D).
  state.renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
  });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.renderer.setSize(W, H, false); // false = neměnit CSS rozměr canvasu
  state.renderer.setClearColor(0x000000, 0);

  // InstancedMesh pro pixely — max GW*IMG_GH (jen image area, ne belt rows)
  const maxInstances = state.GW * state.IMG_GH; // 36*27 = 972
  const geom = new THREE.BoxGeometry(SCALE * PIXEL_INSET, SCALE * PIXEL_INSET, PIXEL_DEPTH);
  const bevelTex = _makeBevelTexture();
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    map: bevelTex,        // bevel textura tintovaná per-instance color
    transparent: false,
  });
  state.pixelMesh = new THREE.InstancedMesh(geom, mat, maxInstances);
  state.pixelMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances * 3),
    3
  );
  state.pixelMesh.count = 0;
  state.pixelMesh.frustumCulled = false; // statická scéna, culling stejně nepomůže
  // Pixely jdou do contentGroup (tilted) místo přímo do scene.
  state.contentGroup.add(state.pixelMesh);

  state.ready = true;
  return true;
}

// Aktualizuje InstancedMesh z aktuálního grid[][] state.
// Volá se z drawGrid() v game.js, kdykoli se grid změní.
//
// Y-flip: grid[0] = top of screen → world Y=H. grid[IMG_GH-1] = bottom image
// area → world Y=H-IMG_H. Standardní Three.js Y-up konvence (kladné Y = nahoře).
function updateGrid(grid, COLORS) {
  if (!state.ready) return;
  const H = state.GH * SCALE;
  let i = 0;
  const max = state.GW * state.IMG_GH;
  for (let y = 0; y < state.IMG_GH; y++) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < state.GW; x++) {
      const c = row[x];
      if (c === -1 || c == null) continue;
      if (i >= max) break;
      // Per-pixel height: scale.z stretches BoxGeometry, position.z lift tak,
      // aby bottom plane zůstala na z=0 (kostka roste nahoru, ne kolem středu).
      const h = _heightFor(x, y);
      _dummy.position.set(
        x * SCALE + SCALE / 2,
        H - (y * SCALE + SCALE / 2),  // Y-flip: grid[0] → top of screen
        PIXEL_LIFT * h                 // střed v polovině scaled výšky
      );
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, h);
      _dummy.updateMatrix();
      state.pixelMesh.setMatrixAt(i, _dummy.matrix);
      const col = _getColor(COLORS[c]);
      state.pixelMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
      i++;
    }
  }
  state.pixelMesh.count = i;
  state.pixelMesh.instanceMatrix.needsUpdate = true;
  state.pixelMesh.instanceColor.needsUpdate = true;
}

function render() {
  if (!state.ready) return;
  state.renderer.render(state.scene, state.camera);
}

function isReady() {
  return state.ready;
}

function setVisible(visible) {
  if (state.canvasEl) state.canvasEl.style.display = visible ? 'block' : 'none';
}

// Cleanup pro level switch nebo dispose. Nepoužíváme zatím (state je per-page),
// ale připravené pro budoucí scene rebuild při webglcontextlost.
function dispose() {
  if (!state.ready) return;
  if (state.pixelMesh) {
    state.pixelMesh.geometry.dispose();
    state.pixelMesh.material.dispose();
    state.scene.remove(state.pixelMesh);
  }
  state.renderer.dispose();
  state.ready = false;
}

// Vystavit API na window pro game.js (klasický script).
if (typeof window !== 'undefined') {
  window.render3d = {
    init,
    updateGrid,
    render,
    isReady,
    setVisible,
    dispose,
  };
  // Signalizace, že modul je připravený. game.js může poslouchat tenhle event,
  // pokud by měl race condition (zatím ne — body onload čeká na všechny scripty
  // včetně modulů, takže initGame() vidí window.render3d).
  window.dispatchEvent(new Event('render3d-loaded'));
}

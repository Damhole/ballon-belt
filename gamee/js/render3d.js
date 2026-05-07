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
const PIXEL_DEPTH = 4;        // hloubka pixel-kostky (z-extent), nízká pro „button" feel
const PIXEL_LIFT = PIXEL_DEPTH / 2; // střed kostky nad rovinou z=0
const PIXEL_INSET = 0.94;     // 1.0 = full size, <1 vytvoří mezery (6% = jemná separace)
const TILT_DEG = 4;           // velmi jemný tilt (4°) — náznak hloubky bez stretchu
const BEVEL_TEX_SIZE = 128;   // rozlišení bevel textury (vyšší = ostřejší highlights)

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

// Procedurální bevel/highlight textura pro top face kostek. Simuluje pohled
// shora na 3D button — silný highlight nahoře/vlevo, AO dole/vpravo, mírně
// zaoblené rohy. Aplikuje se přes material.map; per-instance color tintuje
// texturu (color × texel). Cíl: kostka vypadá 3D i pod čistou top-down kamerou.
function _makeBevelTexture() {
  const N = BEVEL_TEX_SIZE;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d');

  // Base white — všechen tint dostává material.color × instanceColor.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, N, N);

  // 1) Vertikální gradient: highlight v horní části (světlo shora), AO dole.
  const vgrad = ctx.createLinearGradient(0, 0, 0, N);
  vgrad.addColorStop(0, 'rgba(255,255,255,0.45)');
  vgrad.addColorStop(0.35, 'rgba(255,255,255,0.10)');
  vgrad.addColorStop(0.65, 'rgba(0,0,0,0.08)');
  vgrad.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vgrad;
  ctx.fillRect(0, 0, N, N);

  // 2) Diagonální highlight (top-left → bottom-right) pro light direction efekt.
  const dgrad = ctx.createLinearGradient(0, 0, N, N);
  dgrad.addColorStop(0, 'rgba(255,255,255,0.20)');
  dgrad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  dgrad.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = dgrad;
  ctx.fillRect(0, 0, N, N);

  // 3) Bevel okraj — výrazné světlé hrany top+left, tmavé bottom+right.
  const edge = Math.max(3, N * 0.10);
  // Top edge — gradient z highlight do nullu
  const eTop = ctx.createLinearGradient(0, 0, 0, edge);
  eTop.addColorStop(0, 'rgba(255,255,255,0.55)');
  eTop.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = eTop;
  ctx.fillRect(0, 0, N, edge);
  // Left edge
  const eLeft = ctx.createLinearGradient(0, 0, edge, 0);
  eLeft.addColorStop(0, 'rgba(255,255,255,0.40)');
  eLeft.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = eLeft;
  ctx.fillRect(0, 0, edge, N);
  // Bottom edge — tmavý
  const eBot = ctx.createLinearGradient(0, N - edge, 0, N);
  eBot.addColorStop(0, 'rgba(0,0,0,0)');
  eBot.addColorStop(1, 'rgba(0,0,0,0.50)');
  ctx.fillStyle = eBot;
  ctx.fillRect(0, N - edge, N, edge);
  // Right edge — tmavý
  const eRight = ctx.createLinearGradient(N - edge, 0, N, 0);
  eRight.addColorStop(0, 'rgba(0,0,0,0)');
  eRight.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = eRight;
  ctx.fillRect(N - edge, 0, edge, N);

  // 4) AO outer ring — velmi tmavý 1-2px okraj pro definici hran.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, N, 2);
  ctx.fillRect(0, N - 2, N, 2);
  ctx.fillRect(0, 0, 2, N);
  ctx.fillRect(N - 2, 0, 2, N);

  // 5) Specular highlight — malý jasný blob v top-left pro „glossy" pocit.
  const spec = ctx.createRadialGradient(N * 0.28, N * 0.22, 0, N * 0.28, N * 0.22, N * 0.32);
  spec.addColorStop(0, 'rgba(255,255,255,0.45)');
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

  // Scéna — root pivot v středu image area, abychom mohli celou scénu naklopit
  // přes rotaci pivot Group. Kamera zůstává ortografická top-down (jednoduchost).
  state.scene = new THREE.Scene();

  // Pivot pro tilt: posuneme grid tak, aby střed image area (y=IMG_GH*SCALE/2)
  // byl v originu, otočíme kolem X osy o TILT_DEG, vrátíme zpět. Výsledek:
  // kostky lehce naklopené k pozorovateli, nahoře jsou kostky dál, dole blíž.
  const imgCenterY = state.IMG_GH * SCALE / 2;
  state.pivot = new THREE.Group();
  state.pivot.position.set(0, imgCenterY, 0);
  state.scene.add(state.pivot);

  state.tiltGroup = new THREE.Group();
  state.tiltGroup.rotation.x = -TILT_DEG * Math.PI / 180; // záporný X = naklopení směrem k pozorovateli (Y-flipped svět)
  state.pivot.add(state.tiltGroup);

  state.contentGroup = new THREE.Group();
  state.contentGroup.position.set(0, -imgCenterY, 0);
  state.tiltGroup.add(state.contentGroup);

  // Ortografická kamera. Frustum je Y-flipped (top=0, bottom=H), aby world
  // coords seděly s grid coords (y=0 nahoře, y=H dole). near/far velkorysé,
  // aby tilt nezpůsobil clipping kostek vyčuhujících z roviny.
  state.camera = new THREE.OrthographicCamera(0, W, 0, H, -500, 500);
  state.camera.position.set(0, 0, 50);

  // Lighting — bevel textura už nese hlavní baked highlights/shadows; světla
  // jen prosvítí scénu a přidají subtle directional cue na kostky a (později)
  // bloky/kanón. Ambient držíme silný, aby tmavé barvy nebyly mrtvé.
  state.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
  keyLight.position.set(-W * 0.3, -H * 0.4, 250);
  state.scene.add(keyLight);
  // Fill light z opačné strany — jemný, aby kostky neměly kontrastní stíny.
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
  fillLight.position.set(W * 0.5, H * 0.6, 200);
  state.scene.add(fillLight);

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
  state.contentGroup.add(state.pixelMesh);

  state.ready = true;
  return true;
}

// Aktualizuje InstancedMesh z aktuálního grid[][] state.
// Volá se z drawGrid() v game.js, kdykoli se grid změní.
function updateGrid(grid, COLORS) {
  if (!state.ready) return;
  let i = 0;
  const max = state.GW * state.IMG_GH;
  for (let y = 0; y < state.IMG_GH; y++) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < state.GW; x++) {
      const c = row[x];
      if (c === -1 || c == null) continue;
      if (i >= max) break;
      _dummy.position.set(x * SCALE + SCALE / 2, y * SCALE + SCALE / 2, PIXEL_LIFT);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
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

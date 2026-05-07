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
const PIXEL_INSET = 0.98;     // 1.0 = full size, <1 vytvoří mezery (2% = jen vlasový gap)
const BLOCK_DEPTH = 32;       // bloky výrazně vyšší než pixely (puzzle wall feel)
const BLOCK_INSET = 1.0;      // bloky lícují bez mezer — cells stejného bloku splývají v jeden „celistvý" povrch
const MAX_BLOCK_INSTANCES = 600; // většina bloků je velkých (rect 12×17 = 204 cells)
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

// ═══════════════════════════════════════════════════════════════════════════
// STYLE PRESETS — různé bevel/material variants pro porovnání.
// Aktivace přes ?style=X v URL nebo runtime přes window.render3d.setStyle('X').
// Dostupné: 'default' | 'glossy' | 'toon' | 'neon' | 'matte' | 'metal'
// ═══════════════════════════════════════════════════════════════════════════

const STYLES = ['default', 'glossy', 'toon', 'neon', 'matte', 'metal'];

function _resolveStyle() {
  try {
    const s = new URLSearchParams(location.search).get('style');
    if (STYLES.includes(s)) return s;
  } catch (_e) {}
  return 'default';
}

// Helper: nový canvas + ctx pro texturu.
function _newCanvas() {
  const N = BEVEL_TEX_SIZE;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  return { cv, ctx: cv.getContext('2d'), N };
}

// Helper: zabalí canvas do CanvasTexture s konzistentními parametry.
function _wrap(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// DEFAULT — symetrický bevel po obvodu, slabý vertikální gradient,
// malý spec hotspot. Vyvážený „3D button" vzhled.
function _texDefault() {
  const { cv, ctx, N } = _newCanvas();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, N, N);
  const vgrad = ctx.createLinearGradient(0, 0, 0, N);
  vgrad.addColorStop(0, 'rgba(255,255,255,0.18)');
  vgrad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  vgrad.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vgrad; ctx.fillRect(0, 0, N, N);
  const edge = Math.max(3, N * 0.11);
  const HI = 0.42, SH = 0.42;
  let g = ctx.createLinearGradient(0, 0, 0, edge);
  g.addColorStop(0, `rgba(255,255,255,${HI})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, N, edge);
  g = ctx.createLinearGradient(0, 0, edge, 0);
  g.addColorStop(0, `rgba(255,255,255,${HI})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, edge, N);
  g = ctx.createLinearGradient(0, N - edge, 0, N);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${SH})`);
  ctx.fillStyle = g; ctx.fillRect(0, N - edge, N, edge);
  g = ctx.createLinearGradient(N - edge, 0, N, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${SH})`);
  ctx.fillStyle = g; ctx.fillRect(N - edge, 0, edge, N);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, N, 2); ctx.fillRect(0, N - 2, N, 2);
  ctx.fillRect(0, 0, 2, N); ctx.fillRect(N - 2, 0, 2, N);
  const spec = ctx.createRadialGradient(N * 0.5, N * 0.30, 0, N * 0.5, N * 0.30, N * 0.30);
  spec.addColorStop(0, 'rgba(255,255,255,0.32)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec; ctx.fillRect(0, 0, N, N);
  return _wrap(cv);
}

// GLOSSY — silný vertikální gradient + velký specular blob nahoře.
// Plast/wet look, jako lakovaný keramický povrch.
function _texGlossy() {
  const { cv, ctx, N } = _newCanvas();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, N, N);
  // Silný vertical gradient — bright top → dark bottom.
  const v = ctx.createLinearGradient(0, 0, 0, N);
  v.addColorStop(0, 'rgba(255,255,255,0.55)');
  v.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, N, N);
  // Velký specular blob — top half, široký radial gradient.
  const spec = ctx.createRadialGradient(N * 0.5, N * 0.20, 0, N * 0.5, N * 0.20, N * 0.55);
  spec.addColorStop(0, 'rgba(255,255,255,0.65)');
  spec.addColorStop(0.4, 'rgba(255,255,255,0.30)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec; ctx.fillRect(0, 0, N, N);
  // Tenký 1px ring na okraji.
  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.fillRect(0, 0, N, 1); ctx.fillRect(0, N - 1, N, 1);
  ctx.fillRect(0, 0, 1, N); ctx.fillRect(N - 1, 0, 1, N);
  return _wrap(cv);
}

// TOON — silný 5px outline kolem, flat color uvnitř. Komiks/cartoon look.
function _texToon() {
  const { cv, ctx, N } = _newCanvas();
  // Outline base (černá), pak bílý vnitřek
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, N, N);
  const margin = Math.max(4, N * 0.07);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(margin, margin, N - 2 * margin, N - 2 * margin);
  // Slabý 2-tier bevel uvnitř — top jasný, bottom mírně tmavší.
  const inner = ctx.createLinearGradient(0, margin, 0, N - margin);
  inner.addColorStop(0, 'rgba(255,255,255,0.25)');
  inner.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = inner;
  ctx.fillRect(margin, margin, N - 2 * margin, N - 2 * margin);
  return _wrap(cv);
}

// NEON — bright glowing border, tmavý center. Nejlépe vypadá s emissive material.
function _texNeon() {
  const { cv, ctx, N } = _newCanvas();
  // Tmavý střed
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, N, N);
  // Bright outer border (radial gradient od středu — center dark, edges bright).
  const r = ctx.createRadialGradient(N / 2, N / 2, N * 0.15, N / 2, N / 2, N * 0.7);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.20)');
  r.addColorStop(0.85, 'rgba(255,255,255,0.85)');
  r.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, N, N);
  // Highlight blob top center pro extra glow
  const spec = ctx.createRadialGradient(N * 0.5, N * 0.25, 0, N * 0.5, N * 0.25, N * 0.20);
  spec.addColorStop(0, 'rgba(255,255,255,0.7)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec; ctx.fillRect(0, 0, N, N);
  return _wrap(cv);
}

// MATTE — žádný specular, jen jemný AO ring + subtle vertical gradient.
// Křídový/clay povrch, zcela bez lesku.
function _texMatte() {
  const { cv, ctx, N } = _newCanvas();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, N, N);
  // Jemný vertikální gradient — žádný extrém.
  const v = ctx.createLinearGradient(0, 0, 0, N);
  v.addColorStop(0, 'rgba(255,255,255,0.10)');
  v.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, N, N);
  // Soft AO ring — širší než default, ale méně tmavý.
  const ring = Math.max(4, N * 0.08);
  const ag = ctx.createLinearGradient(0, 0, 0, ring);
  ag.addColorStop(0, 'rgba(0,0,0,0.18)'); ag.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ag; ctx.fillRect(0, 0, N, ring);
  const ag2 = ctx.createLinearGradient(0, N - ring, 0, N);
  ag2.addColorStop(0, 'rgba(0,0,0,0)'); ag2.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = ag2; ctx.fillRect(0, N - ring, N, ring);
  const ag3 = ctx.createLinearGradient(0, 0, ring, 0);
  ag3.addColorStop(0, 'rgba(0,0,0,0.18)'); ag3.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ag3; ctx.fillRect(0, 0, ring, N);
  const ag4 = ctx.createLinearGradient(N - ring, 0, N, 0);
  ag4.addColorStop(0, 'rgba(0,0,0,0)'); ag4.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = ag4; ctx.fillRect(N - ring, 0, ring, N);
  return _wrap(cv);
}

// METAL — ostrý vertikální gradient + sharp tiny specular nahoře. Mirror-like
// chrome look. Nejlépe vypadá při per-instance saturated colors.
function _texMetal() {
  const { cv, ctx, N } = _newCanvas();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, N, N);
  // Ostrý 3-step gradient (jako anodizovaný kov)
  const v = ctx.createLinearGradient(0, 0, 0, N);
  v.addColorStop(0, 'rgba(255,255,255,0.55)');
  v.addColorStop(0.20, 'rgba(255,255,255,0.20)');
  v.addColorStop(0.50, 'rgba(0,0,0,0.10)');
  v.addColorStop(0.80, 'rgba(0,0,0,0.40)');
  v.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, N, N);
  // Sharp tiny specular near top (mirror highlight).
  const spec = ctx.createRadialGradient(N * 0.5, N * 0.18, 0, N * 0.5, N * 0.18, N * 0.12);
  spec.addColorStop(0, 'rgba(255,255,255,0.95)');
  spec.addColorStop(0.6, 'rgba(255,255,255,0.40)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec; ctx.fillRect(0, 0, N, N);
  // Tmavý ring outline (pro definici hran)
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, N, 2); ctx.fillRect(0, N - 2, N, 2);
  ctx.fillRect(0, 0, 2, N); ctx.fillRect(N - 2, 0, 2, N);
  return _wrap(cv);
}

// Dispatch — vrátí texturu pro daný styl. Default fallback.
function _makeBevelTexture(style) {
  switch (style) {
    case 'glossy': return _texGlossy();
    case 'toon':   return _texToon();
    case 'neon':   return _texNeon();
    case 'matte':  return _texMatte();
    case 'metal':  return _texMetal();
    default:       return _texDefault();
  }
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
  state.style = _resolveStyle();
  const bevelTex = _makeBevelTexture(state.style);
  // Material setup per style. NEON style má emissive map → kostky září vlastní
  // barvou nezávisle na světle. Ostatní styly = standard MeshLambertMaterial.
  const matOpts = {
    color: 0xffffff,
    map: bevelTex,
    transparent: false,
  };
  if (state.style === 'neon') {
    matOpts.emissive = 0xffffff;
    matOpts.emissiveMap = bevelTex; // glow = stejný pattern jako map
    matOpts.emissiveIntensity = 0.9;
  }
  const mat = new THREE.MeshLambertMaterial(matOpts);
  state.pixelMesh = new THREE.InstancedMesh(geom, mat, maxInstances);
  state.pixelMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances * 3),
    3
  );
  state.pixelMesh.count = 0;
  state.pixelMesh.frustumCulled = false; // statická scéna, culling stejně nepomůže
  // Pixely jdou do contentGroup (tilted) místo přímo do scene.
  state.contentGroup.add(state.pixelMesh);

  // BLOCK MESH — bloky jako InstancedMesh cubes BEZ bevel textury a BEZ insetu.
  // Cells stejného bloku tedy splývají v jeden „celistvý" wall povrch (bez seams,
  // bez gap). Pouze top faces se viditelně liší díky lighting na boční stěny.
  // Bottom plane všech cells na z=0, výška BLOCK_DEPTH = 32 (výrazně nad pixely).
  const blockGeom = new THREE.BoxGeometry(
    SCALE * BLOCK_INSET,  // 1.0 = full size, kostky lícují
    SCALE * BLOCK_INSET,
    BLOCK_DEPTH
  );
  const blockMatOpts = {
    color: 0xffffff,
    transparent: false,
    // Zámerně bez map — chceme čistý color fill, žádné per-cell hrany.
  };
  if (state.style === 'neon') {
    blockMatOpts.emissive = 0xffffff;
    blockMatOpts.emissiveIntensity = 0.5;
  }
  const blockMat = new THREE.MeshLambertMaterial(blockMatOpts);
  state.blockMesh = new THREE.InstancedMesh(blockGeom, blockMat, MAX_BLOCK_INSTANCES);
  state.blockMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_BLOCK_INSTANCES * 3),
    3
  );
  state.blockMesh.count = 0;
  state.blockMesh.frustumCulled = false;
  state.contentGroup.add(state.blockMesh);

  state.ready = true;
  return true;
}

// Aktualizuje block InstancedMesh z aktuálního currentBlocks state.
// Volá se z drawBlocks() v game.js v 3D módu, kdykoli se blocks změní.
//
// Každý cell mask bloku → jedna cube instance. Solid blok dostane COLORS[block.color],
// mystery blok #555a62. Bottom plane všech bloků na z=0 (rostou nahoru jako stěny).
function updateBlocks(blocks, COLORS) {
  if (!state.ready || !state.blockMesh) return;
  const H = state.GH * SCALE;
  const mesh = state.blockMesh;
  const max = MAX_BLOCK_INSTANCES;
  let i = 0;
  for (const b of blocks) {
    if (!b || b.hp <= 0) continue;
    const isMystery = b.kind === 'mystery';
    const baseHex = isMystery ? '#555a62' : (COLORS[b.color] || '#888');
    const baseCol = _getColor(baseHex);
    if (!b._mask) continue;
    for (let ly = 0; ly < b.h; ly++) {
      const row = b._mask[ly];
      if (!row) continue;
      for (let lx = 0; lx < b.w; lx++) {
        if (!row[lx]) continue;
        if (i >= max) break;
        const x = b.x + lx;
        const y = b.y + ly;
        _dummy.position.set(
          x * SCALE + SCALE / 2,
          H - (y * SCALE + SCALE / 2),
          BLOCK_DEPTH / 2 // bottom plane na z=0
        );
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
        mesh.instanceColor.setXYZ(i, baseCol.r, baseCol.g, baseCol.b);
        i++;
      }
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
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

// Hot-swap stylu za běhu — pro rychlé porovnání bez reloadu page.
// Volání: window.render3d.setStyle('metal') v DevTools console.
function setStyle(newStyle) {
  if (!state.ready) return false;
  if (!STYLES.includes(newStyle)) {
    console.warn('[render3d] Neznámý style:', newStyle, '— dostupné:', STYLES);
    return false;
  }
  if (newStyle === state.style) return true; // no-op
  // Vyhoď starou texturu (free GPU), vyrobí novou.
  if (state.pixelMesh.material.map) state.pixelMesh.material.map.dispose();
  if (state.pixelMesh.material.emissiveMap) state.pixelMesh.material.emissiveMap.dispose();
  const tex = _makeBevelTexture(newStyle);
  state.pixelMesh.material.map = tex;
  // Neon má emissive map navíc; jinak vypneme.
  if (newStyle === 'neon') {
    state.pixelMesh.material.emissive = new THREE.Color(0xffffff);
    state.pixelMesh.material.emissiveMap = tex;
    state.pixelMesh.material.emissiveIntensity = 0.9;
  } else {
    state.pixelMesh.material.emissive = new THREE.Color(0x000000);
    state.pixelMesh.material.emissiveMap = null;
    state.pixelMesh.material.emissiveIntensity = 1.0;
  }
  state.pixelMesh.material.needsUpdate = true;
  state.style = newStyle;
  return true;
}

// Vystavit API na window pro game.js (klasický script).
if (typeof window !== 'undefined') {
  window.render3d = {
    init,
    updateGrid,
    updateBlocks,
    render,
    isReady,
    setVisible,
    dispose,
    setStyle,
    getStyle: () => state.style,
    listStyles: () => STYLES.slice(),
  };
  // Signalizace, že modul je připravený. game.js může poslouchat tenhle event,
  // pokud by měl race condition (zatím ne — body onload čeká na všechny scripty
  // včetně modulů, takže initGame() vidí window.render3d).
  window.dispatchEvent(new Event('render3d-loaded'));
}

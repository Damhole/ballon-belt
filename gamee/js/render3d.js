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
const PIXEL_DEPTH = 28;       // v73.15: baseline hloubka pixel-kostky (18 → 28)
const PIXEL_LIFT = PIXEL_DEPTH / 2; // střed baseline kostky nad rovinou z=0
const PIXEL_INSET = 0.70;     // v73.42: 0.65 → 0.70
const BLOCK_DEPTH = 32;       // bloky výrazně vyšší než pixely (puzzle wall feel)
const BLOCK_INSET = 1.0;      // bloky lícují bez mezer — cells stejného bloku splývají v jeden „celistvý" povrch
const MAX_BLOCK_INSTANCES = 600; // většina bloků je velkých (rect 12×17 = 204 cells)
const PROJECTILE_RADIUS = 4.8; // poloměr 3D balónku — match s 2D arc(p.x, p.y, 4.8)
const PROJECTILE_Z = 12;       // Z pozice projektilu — mírně nad pixely, vidět 3D feel
const MAX_PROJECTILES = 80;    // max projektilů ve vzduchu (real-game ~40)

// ─── DESTRUCTION ANIMATIONS ────────────────────────────────────────────────
// Když pixel zničen, spawne animaci. Dva módy:
//   'collapse' — pixel se zmenší k 0 (shrink-fade in place)
//   'shatter'  — pixel exploduje na 6 menších cubes s gravitací
//   'none'     — žádná animace, instant disappear (legacy 2D look)
// Aktivace: ?destroy=X v URL. Default = shatter (zábavnější).
const DESTROY_SHARDS_PER_PIXEL = 9;   // v73.253: 6 → 9 (bohatší výbuch)
const MAX_SHARDS = 320;               // pool pro flash + víc shardů
// v73.228: per-pixel chromatic aberration ghosts — spawned on pixel destroy.
// 2 flat planes per pixel: red offset right, cyan offset left, AdditiveBlending, fade ~180ms.
const MAX_GHOSTS   = 120;   // 2 per pixel, ~60 simultaneous pixels
const CA_OFFSET_X  = 4.5;   // horizontal offset in world units
const CA_OFFSET_Y  = 1.5;   // vertical lift in world units (ghosts float above pixel center)
const CA_LIFE      = 0.18;  // fade duration (s)
// v73.238: dust motes — spawn při zničení pixelu, dožijí ~3s a zmizí.
// Pool pro mass destrukci, dropování nejstarších při přetečení.
const MAX_DUST       = 60;
const DUST_SIZE      = 1.6;   // world units (~1.6 px)
const DUST_SPEED     = 9;     // base drift speed
const DUST_Z         = 28.6;  // mírně nad PIXEL_DEPTH (28)
const DUST_LIFE_MIN  = 2.2;   // sekund minimum
const DUST_LIFE_MAX  = 3.6;   // sekund maximum
// v73.251: o třetinu méně — 1 částice, s 33% šancí 2 (průměr ~1.33 místo 2)
const TILT_DEG = 19.2;        // tilt scény (°) — match Blender Camera.010 X rotation
const BEVEL_TEX_SIZE = 128;   // rozlišení bevel textury (vyšší = ostřejší highlights)
// Per-pixel height variation — některé kostky vyšší, aby povrch nebyl rovnoměrný.
// 3 tiery, deterministicky vybrané přes hash(x,y). Bottom plane všech kostek
// zůstává na z=0 (cube se „natáhne" nahoru). Chceš to vypnout? Nastav VARIANCE_AMPL=0.
const HEIGHT_TIERS = [1.0, 1.3, 1.5]; // (legacy) — nahrazeno v73.43 jednoduchou random variance
const TIER_PROBS = [0.90, 0.08, 0.02]; // (legacy)
const VARIANCE_AMPL = 1.0;            // 1 = full random variance
const HEIGHT_VAR_RANGE = 0.025;       // v73.45: per-pixel výška ±2.5 % (0.975..1.025 × PIXEL_DEPTH)
// v73.45: height pattern — určuje SHAPE varianty pixelové výšky. Per-level feel.
// 'random' (default) | 'wave-h' | 'wave-v' | 'wave-diag' | 'radial' | 'flat'
// URL param: ?height=wave-h
const HEIGHT_PATTERN = (function(){
  try {
    const p = new URLSearchParams(location.search).get('height');
    if (['random','wave-h','wave-v','wave-diag','radial','flat'].includes(p)) return p;
  } catch(_e) {}
  return 'random';
})();

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
  pixelBounce: new Map(), // key = y*GW+x → {t, delay, life, amp}
  _lastGrid: null,
  _lastColors: null,
  qualityTier: 0,           // v73.255: 0=HIGH, 1=MED, 2=LOW
  ghosts: [],       // v73.228: CA ghost instances
  ghostMesh: null,  // v73.228: InstancedMesh pro CA efekt
  dust: [],         // v73.237: ambient dust motes
  dustMesh: null,   // v73.237: InstancedMesh pro dust
};

const _dummy = new THREE.Object3D();

// v73.1: image-area frame — outer rounded rect s vnitřním otvorem (hole) přes ExtrudeGeometry.
// Vytvoří dojem "ražby" / cavity v case panelu, pixel art je vidět skrz hole.
function _buildImageFrameGeom(W, H, opts) {
  const outerR = opts.outerR || 14;
  const innerR = opts.innerR || 10;
  const pad    = opts.pad    || 10;     // padding od outer hrany k hole
  const depth  = opts.depth  || 25;
  const bevel  = opts.bevel  || 2;
  const bevelSegs = opts.bevelSegs || 3;
  // v73.4: extendBottom hide bottom side wall (tilt = bottom blízko kameře, side wall by jinak
  // čouhal). Hole inset uniformly pad od outer → top face stejně silný v lokálních coords.
  // v73.20: extendTop pro extend top edge — frame top by jinak nedosáhl canvas top hrany.
  const extendBottom = opts.extendBottom !== undefined ? opts.extendBottom : 13;
  const extendTop    = opts.extendTop    !== undefined ? opts.extendTop    : 5;
  const x0 = 0, x1 = W;
  const y0 = -extendBottom, y1 = H + extendTop;
  const shape = new THREE.Shape();
  shape.moveTo(x0 + outerR, y0);
  shape.lineTo(x1 - outerR, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + outerR);
  shape.lineTo(x1, y1 - outerR);
  shape.quadraticCurveTo(x1, y1, x1 - outerR, y1);
  shape.lineTo(x0 + outerR, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - outerR);
  shape.lineTo(x0, y0 + outerR);
  shape.quadraticCurveTo(x0, y0, x0 + outerR, y0);
  // Hole — inset uniformly by pad from outer (vč. extended bottom). Top face thickness = pad.
  const ix0 = pad, iy0 = y0 + pad, ix1 = W - pad, iy1 = y1 - pad;
  const hole = new THREE.Path();
  hole.moveTo(ix0 + innerR, iy0);
  hole.lineTo(ix1 - innerR, iy0);
  hole.quadraticCurveTo(ix1, iy0, ix1, iy0 + innerR);
  hole.lineTo(ix1, iy1 - innerR);
  hole.quadraticCurveTo(ix1, iy1, ix1 - innerR, iy1);
  hole.lineTo(ix0 + innerR, iy1);
  hole.quadraticCurveTo(ix0, iy1, ix0, iy1 - innerR);
  hole.lineTo(ix0, iy0 + innerR);
  hole.quadraticCurveTo(ix0, iy0, ix0 + innerR, iy0);
  shape.holes.push(hole);
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevelSegs,
    curveSegments: 4,
  });
  return geom;
}

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
  // v73.45: per-pixel multiplier dle HEIGHT_PATTERN.
  // 'random' = hash noise. Wave/radial = deterministické shapy pro per-level feel.
  if (HEIGHT_PATTERN === 'flat' || VARIANCE_AMPL <= 0) return 1.0;
  let n;  // normalized -1..+1
  switch (HEIGHT_PATTERN) {
    case 'wave-h':    n = Math.sin(x * 0.40); break;
    case 'wave-v':    n = Math.sin(y * 0.40); break;
    case 'wave-diag': n = Math.sin((x + y) * 0.28); break;
    case 'radial': {
      const cx = (state.GW || 36) / 2, cy = (state.IMG_GH || 27) / 2;
      n = Math.sin(Math.hypot(x - cx, y - cy) * 0.45);
      break;
    }
    case 'random':
    default:          n = (_hash01(x, y) - 0.5) * 2; break;
  }
  return 1.0 + n * HEIGHT_VAR_RANGE * VARIANCE_AMPL;
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

const DESTROY_MODES = ['shatter', 'collapse', 'combo', 'none'];
function _resolveDestroyMode() {
  try {
    const m = new URLSearchParams(location.search).get('destroy');
    if (DESTROY_MODES.includes(m)) return m;
  } catch (_e) {}
  return 'shatter';
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
  // v73.25: black 2px border removed — BackSide outline mesh (v73.24) už dělá silhouette
  // outline kolem každého pixel cube, internal cell border v textuře byl redundant.
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

  // Lighting — HemisphereLight (sky + ground) ambient, DirectionalLight = „slunce".
  // User feedback iterace: vyšší ambient + sun pro více svítivosti pixelů, ale
  // zachovat černou jako černou (žádná emissive na material).
  const sky = new THREE.HemisphereLight(0xffe8f0, 0xa090a8, 1.85);
  state.scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffffff, 1.55);
  sun.position.set(-W * 0.4, H * 0.8, 300);
  sun.target.position.set(W / 2, imgCenterY, 0);
  state.scene.add(sun.target);
  // ── SHADOWS — directional light cast shadows na ground plane.
  // normalBias VÝRAZNĚ snížený (z 0.5 na 0.05) — eliminuje viditelný gap mezi
  // základnou kostky a začátkem stínu. Trade-off: může vzniknout subtle shadow
  // acne, kompenzujeme přes bias.
  sun.castShadow = true;
  sun.shadow.mapSize.width = 512;
  sun.shadow.mapSize.height = 512;
  state.sun = sun; // v73.259: ref pro shadow quality downgrade přes setQualityTier
  sun.shadow.camera.left = -W * 0.8;
  sun.shadow.camera.right = W * 0.8;
  sun.shadow.camera.top = H * 0.8;
  sun.shadow.camera.bottom = -H * 0.8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1200;
  sun.shadow.bias = -0.001;        // mírně silnější bias kvůli sníženému normalBias
  sun.shadow.normalBias = 0.05;    // FIX: stíny teď navazují přímo na základnu objektu
  sun.shadow.radius = 2;           // soft edge rozmazání
  state.scene.add(sun);
  // Subtilní fill zezadu/zprava, ať tmavé strany nejsou úplně černé. Bez stínu.
  // Pinkový tint, ať fill barví neutrálně k BG.
  const fill = new THREE.DirectionalLight(0xfff0f5, 0.55);
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
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // InstancedMesh pro pixely — max GW*IMG_GH (jen image area, ne belt rows)
  const maxInstances = state.GW * state.IMG_GH; // 36*27 = 972
  // v73.38: zpět fixed bevel hodnoty (3.5/4/6 — vrch capsule look user měl rád), jen
  // mírně menší aby seděly s INSET=0.55 (pSize=5.5, bevelSize must be < pSize/2 = 2.75).
  const pSize = SCALE * PIXEL_INSET;
  const geom = (function _pixelRoundedGeom() {
    const half = pSize / 2;
    const radius = 1.5;
    const shape = new THREE.Shape();
    shape.moveTo(-half + radius, -half);
    shape.lineTo(half - radius, -half);
    shape.quadraticCurveTo(half, -half, half, -half + radius);
    shape.lineTo(half, half - radius);
    shape.quadraticCurveTo(half, half, half - radius, half);
    shape.lineTo(-half + radius, half);
    shape.quadraticCurveTo(-half, half, -half, half - radius);
    shape.lineTo(-half, -half + radius);
    shape.quadraticCurveTo(-half, -half, -half + radius, -half);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: PIXEL_DEPTH,
      bevelEnabled: true,
      bevelSize: 2.4,
      bevelThickness: 3.2,
      bevelSegments: 6,
      curveSegments: 6,
    });
    g.translate(0, 0, -PIXEL_DEPTH / 2);
    return g;
  })();
  state.style = _resolveStyle();
  const bevelTex = _makeBevelTexture(state.style);
  // v73.23: MeshToonMaterial s gradientMap (stejný shader jako carriery) +
  // bevel texture jako color map. 3-band cel-shading na pixelech.
  const toonGradData = new Uint8Array([120, 200, 255]);
  const toonGrad = new THREE.DataTexture(toonGradData, toonGradData.length, 1, THREE.RedFormat);
  toonGrad.minFilter = THREE.NearestFilter;
  toonGrad.magFilter = THREE.NearestFilter;
  toonGrad.generateMipmaps = false;
  toonGrad.needsUpdate = true;
  // v73.29: MeshLambertMaterial pro smooth shading (žádný toon banding) — match reference
  // s rounded 3D pixely. Žádná map texture (3D bevel z geometry sám dělá highlight/shadow).
  const matOpts = {
    color: 0xffffff,
    transparent: false,
  };
  if (state.style === 'neon') {
    matOpts.emissive = 0xffffff;
    matOpts.emissiveIntensity = 0.6;
  }
  const mat = new THREE.MeshLambertMaterial(matOpts);
  // v73.24: inverted-hull outline pro pixely (stejný princip jako carriery — BackSide
  // black mesh, scaled up). Silhouette outline kolem každého pixel cube.
  const pixelOutlineMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide,
    fog: false,
  });
  state.pixelOutlineMesh = new THREE.InstancedMesh(geom, pixelOutlineMat, state.GW * state.IMG_GH);
  state.pixelOutlineMesh.count = 0;
  state.pixelOutlineMesh.frustumCulled = false;
  state.pixelOutlineMesh.renderOrder = -1;  // před pixelMesh
  state.pixelMesh = new THREE.InstancedMesh(geom, mat, maxInstances);
  state.pixelMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(maxInstances * 3),
    3
  );
  state.pixelMesh.count = 0;
  state.pixelMesh.frustumCulled = false; // statická scéna, culling stejně nepomůže
  state.pixelMesh.castShadow = true;
  state.pixelMesh.receiveShadow = true;
  // Pixely jdou do contentGroup (tilted) místo přímo do scene.
  // v73.8: pixelsGroup uvnitř contentGroup — scale 0.92 toward center, takže
  // pixely a bloky se nezasahují s 3D frame. Frame zůstává v contentGroup přímo.
  // v73.16: shift down by SHIFT_DOWN_Y (snižuje cavity floor visible pod pixely).
  const PIXELS_SCALE = 0.97;
  const SHIFT_DOWN_Y = -14;  // negative Y = down v contentGroup local (Y-up)
  state.pixelsGroup = new THREE.Group();
  state.pixelsGroup.position.set((1 - PIXELS_SCALE) * W / 2, (1 - PIXELS_SCALE) * H / 2 + SHIFT_DOWN_Y, 0);
  state.pixelsGroup.scale.set(PIXELS_SCALE, PIXELS_SCALE, 1);
  state.contentGroup.add(state.pixelsGroup);
  state.pixelsGroup.add(state.pixelMesh);
  state.pixelsGroup.add(state.pixelOutlineMesh);  // v73.24

  // v73.1: image-area frame — outer rounded rect s vnitřním otvorem. ExtrudeGeometry
  // s bevel + rounded corners. Pixel art je vidět skrz hole, frame okolo = "ražba"
  // do case panelu. Frame v contentGroup → tiltuje s pixely (case je součást devicu).
  const frameGeom = _buildImageFrameGeom(W, H, {
    outerR: 14, innerR: 8, pad: 4, depth: 50, bevel: 2, bevelSegs: 3,
  });
  // v73.11: MeshLambertMaterial (stejný shader jako pixel blocks) ale BEZ mapy —
  // bevel texture je per-pixel-cell pattern (černé okraje pro cell outline), na velké
  // ploše frame by se tilovala a frame by vypadal černý. Smooth shading bez mapy.
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xf4b8c8 });
  state.imageFrame = new THREE.Mesh(frameGeom, frameMat);
  // Frame top face at z=30, bottom at z=0 — pixel art (z=0..18) je INSIDE cavity.
  // v73.16: shift down v Y sync s pixelsGroup
  state.imageFrame.position.set(0, -14, 0);
  state.imageFrame.castShadow = false;
  state.imageFrame.receiveShadow = true;
  state.contentGroup.add(state.imageFrame);

  // GROUND PLANE — neviditelný plane na z=0 přijímá stíny od kostek.
  // ShadowMaterial = renderuje JEN stíny, plane sám je transparentní.
  // Opacity SNÍŽENA z 0.42 na 0.28 — lehčí stíny po přechodu na light BG,
  // pixely zůstanou saturované.
  const groundGeom = new THREE.PlaneGeometry(W * 3, H * 3);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.28 });
  state.shadowGround = new THREE.Mesh(groundGeom, groundMat);
  state.shadowGround.position.set(W / 2, imgCenterY, 0);
  state.shadowGround.receiveShadow = true;
  state.pixelsGroup.add(state.shadowGround);   // v73.8: do pixelsGroup pro scale

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
  state.blockMesh.castShadow = true;
  state.blockMesh.receiveShadow = true;
  state.pixelsGroup.add(state.blockMesh);   // v73.8

  // PROJECTILE MESH (Fáze 4) — 3D sphere instances pro létající balónky.
  // Low-poly (12×8 segments) pro mobile, MeshLambertMaterial dává sphere shading
  // od DirectionalLight (highlight + shadow side). Per-instance color.
  // Z = PROJECTILE_Z (12) — mírně nad baseline pixely, ale pod block tops.
  const projGeom = new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 8);
  const projMatOpts = {
    color: 0xffffff,
    transparent: false,
  };
  if (state.style === 'neon') {
    projMatOpts.emissive = 0xffffff;
    projMatOpts.emissiveIntensity = 0.7;
  }
  const projMat = new THREE.MeshLambertMaterial(projMatOpts);
  state.projectileMesh = new THREE.InstancedMesh(projGeom, projMat, MAX_PROJECTILES);
  state.projectileMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_PROJECTILES * 3),
    3
  );
  state.projectileMesh.count = 0;
  state.projectileMesh.frustumCulled = false;
  state.projectileMesh.castShadow = true; // projektily vrhají stín na ground
  // Záměrně ne receiveShadow (sphere by self-shadowoval kvůli Lambert + low-poly)
  state.pixelsGroup.add(state.projectileMesh);   // v73.8
  // v73.47: inverted-hull outline pro projektily — match pixely/carriery vizuál.
  const projOutlineMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide,
    fog: false,
  });
  state.projectileOutlineMesh = new THREE.InstancedMesh(projGeom, projOutlineMat, MAX_PROJECTILES);
  state.projectileOutlineMesh.count = 0;
  state.projectileOutlineMesh.frustumCulled = false;
  state.projectileOutlineMesh.renderOrder = -1;
  state.pixelsGroup.add(state.projectileOutlineMesh);

  // SHARD MESH — pro pixel destruction animace (collapse + shatter).
  // Sdílí bevel texturu s pixely, takže shards vypadají jako mini verze pixelů.
  // Per-instance scale (animovaný), per-instance position+rotation, per-instance color.
  state.destroyMode = _resolveDestroyMode();
  state.shards = [];
  // v73.254: shards zpět na sphere geometry — BoxGeometry s hloubkou PIXEL_DEPTH
  // se při scale variaci jevila jako protáhlé hranoly. Sphere drží proporce.
  const shardGeom = new THREE.SphereGeometry(SCALE * PIXEL_INSET * 0.5, 8, 6);
  const shardMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    map: bevelTex, // shared with pixels
    transparent: false,
  });
  if (state.style === 'neon') {
    shardMat.emissive = new THREE.Color(0xffffff);
    shardMat.emissiveMap = bevelTex;
    shardMat.emissiveIntensity = 0.9;
  }
  state.shardMesh = new THREE.InstancedMesh(shardGeom, shardMat, MAX_SHARDS);
  state.shardMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_SHARDS * 3),
    3
  );
  state.shardMesh.count = 0;
  state.shardMesh.frustumCulled = false;
  state.shardMesh.castShadow = true;
  state.pixelsGroup.add(state.shardMesh);   // v73.8

  // v73.228: CA ghost mesh — flat planes with AdditiveBlending, no depth write.
  // Spawned in pairs (red+cyan) at destroyed pixel position.
  const ghostGeom = new THREE.PlaneGeometry(SCALE * PIXEL_INSET, SCALE * PIXEL_INSET);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  state.ghostMesh = new THREE.InstancedMesh(ghostGeom, ghostMat, MAX_GHOSTS);
  state.ghostMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_GHOSTS * 3), 3
  );
  state.ghostMesh.count = 0;
  state.ghostMesh.frustumCulled = false;
  state.ghostMesh.renderOrder = 40; // above pixels, below shards
  state.pixelsGroup.add(state.ghostMesh);

  // v73.237: dust motes — drobné částice klouzající po povrchu image area.
  const dustGeom = new THREE.PlaneGeometry(DUST_SIZE, DUST_SIZE);
  const dustMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  state.dustMesh = new THREE.InstancedMesh(dustGeom, dustMat, MAX_DUST);
  state.dustMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_DUST * 3), 3
  );
  state.dustMesh.count = 0; // prázdné, plní se přes triggerDustBurst
  state.dustMesh.frustumCulled = false;
  state.dustMesh.renderOrder = 38; // pod ghosts, nad pixely
  state.pixelsGroup.add(state.dustMesh);

  state.ready = true;
  return true;
}

// v73.49: lehký cartoon spark effect při wall bounce — 4 mini shardy explodujou ven
// z impact pointu, perpendicular k incoming velocity. Krátký life.
function triggerBounceSpark(gridX, gridY, vx, vy, hexColor) {
  if (!state.ready || !state.shardMesh) return;
  const color = _getColor(hexColor).clone();
  const wx = gridX, wy = gridY;
  const count = 4;
  // Perpendicular direction (impact normal approx)
  const speed = 35;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    state.shards.push({
      x: wx, y: wy, z: PIXEL_LIFT * 0.9,
      vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.6),
      vy: Math.sin(angle) * speed * 0.3,
      vz: 25 + Math.random() * 30,
      rot: Math.random() * Math.PI,
      vRot: (Math.random() - 0.5) * 8,
      scaleStart: 0.35,
      scaleEnd: 0,
      t: 0, life: 0.22,
      color: color.clone(),
      gravity: true,
    });
  }
}

// ── Pixel destruction trigger ─────────────────────────────────────────────
// Volá se z game.js při destrukci pixelu. Spawne shards podle DESTROY_MODE.
// gridX, gridY = grid coords (0..GW-1, 0..IMG_GH-1). hexColor = pixel color.
function triggerPixelDestroy(gridX, gridY, hexColor) {
  if (!state.ready || !state.shardMesh) return;
  if (state.destroyMode === 'none') return;
  // v73.259: shadow map refresh při destrukci (on-demand mode na MED tieru)
  if (state.sun && !state.sun.shadow.autoUpdate) state.sun.shadow.needsUpdate = true;
  const color = _getColor(hexColor).clone();
  const wx = gridX * SCALE + SCALE / 2;
  const wy = gridY * SCALE + SCALE / 2;

  // Helper: spawn collapse shard (full-size shrinks to nothing in place)
  const spawnCollapse = () => {
    state.shards.push({
      x: wx, y: wy, z: PIXEL_LIFT,
      vx: 0, vy: 0, vz: -12,
      rot: 0, vRot: 0,
      scaleStart: 1.0,
      scaleEnd: 0.0,
      t: 0, life: 0.12,           // rychlejší zhroucení (220 → 120ms)
      color: color.clone(), gravity: false,
    });
  };
  // Helper: spawn shatter shards (small cubes flying out with gravity).
  // v73.253: silnější výbuch — bohatší variace velikostí, počátečních pozic,
  // rotací a rychlostí. 3 vrstvy: malé rychlé, středně velké, pomalé velké.
  const spawnShatter = (count, speedMul = 1.0, scaleMul = 1.0) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.55;
      const sizeRoll = Math.random(); // 0..1 dělí shards do velikostních kategorií
      const isBig    = sizeRoll < 0.18;            // 18% velkých
      const isSmall  = sizeRoll > 0.65;            // 35% drobných
      const speed = (isBig ? 35 : (isSmall ? 75 : 55)) * (0.7 + Math.random() * 0.7) * speedMul;
      const vz0   = (isBig ? 55 : (isSmall ? 110 : 85)) * (0.7 + Math.random() * 0.7) * speedMul;
      const sSt   = (isBig ? 0.65 : (isSmall ? 0.30 : 0.48)) * scaleMul;
      const sEn   = sSt * (0.30 + Math.random() * 0.30);
      state.shards.push({
        x: wx + (Math.random() - 0.5) * 2.5,
        y: wy + (Math.random() - 0.5) * 2.5,
        z: PIXEL_LIFT * (0.95 + Math.random() * 0.25),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * (0.30 + Math.random() * 0.25),
        vz: vz0,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 22,
        scaleStart: sSt,
        scaleEnd: sEn,
        t: 0, life: 0.24 + Math.random() * 0.18,   // 240–420 ms
        color: color.clone(), gravity: true,
      });
    }
  };
  // v73.253: krátký bílý "flash" shard v centru — měkký puls bezprostředně po
  // destrukci. AdditiveBlending nemá BoxGeometry shard, ale použít bílou
  // barvu + rychlý fade dává podobný dojem hot spotu.
  const spawnFlash = () => {
    state.shards.push({
      x: wx, y: wy, z: PIXEL_LIFT * 1.2,
      vx: 0, vy: 0, vz: 30,
      rot: Math.random() * Math.PI, vRot: 6,
      scaleStart: 1.05, scaleEnd: 0.20,
      t: 0, life: 0.10,
      color: new THREE.Color(0xffffff),
      gravity: false,
    });
  };

  // v73.255: quality tier — méně shardů + bez flash při downgrade
  const tier = state.qualityTier || 0;
  const shardCount = tier === 0 ? DESTROY_SHARDS_PER_PIXEL
                   : tier === 1 ? 6
                                : 4;
  if (state.destroyMode === 'collapse') {
    spawnCollapse();
  } else if (state.destroyMode === 'shatter') {
    if (tier < 2) spawnFlash(); // HIGH + MED mají flash, LOW ne
    spawnShatter(shardCount);
  } else if (state.destroyMode === 'combo') {
    spawnCollapse();
    if (tier < 2) spawnFlash(); // HIGH + MED mají flash, LOW ne
    spawnShatter(Math.max(3, shardCount - 4), 0.85, 0.8);
  }
  // Limit shard pool — když přeteče, dropni nejstarší (FIFO)
  while (state.shards.length > MAX_SHARDS) state.shards.shift();
  // Wave bounce na sousedních pixelech
  triggerPixelWave(gridX, gridY);
}

// v73.228: Per-pixel chromatic aberration — spawne 2 ghost planes na destroyed pixel.
// Red ghost posunutý +CA_OFFSET_X, cyan ghost posunutý -CA_OFFSET_X. AdditiveBlending fade.
function triggerPixelCA(gx, gy, hexColor) {
  if (!state.ready || !state.ghostMesh) return;
  if ((state.qualityTier || 0) >= 2) return;          // v73.255: LOW tier → bez CA
  const col = _getColor(hexColor);
  const wx = gx * SCALE + SCALE / 2;
  const wy = gy * SCALE + SCALE / 2;
  // Red channel emphasis — offset right + slight upward lift
  state.ghosts.push({
    x: wx + CA_OFFSET_X, y: wy - CA_OFFSET_Y,
    color: new THREE.Color(col.r * 0.85 + 0.15, col.g * 0.05, col.b * 0.05),
    t: 0, life: CA_LIFE,
  });
  // Cyan channel emphasis — offset left + slight upward lift
  state.ghosts.push({
    x: wx - CA_OFFSET_X, y: wy - CA_OFFSET_Y,
    color: new THREE.Color(col.r * 0.05, col.g * 0.3 + 0.1, col.b * 0.85 + 0.15),
    t: 0, life: CA_LIFE,
  });
  while (state.ghosts.length > MAX_GHOSTS) state.ghosts.shift();
}

// v73.238: spawne pár dust motes na zničeném pixelu. Dožijí DUST_LIFE_MIN..MAX
// sekund, drifují jemně, alpha oscilace přes sin(phase) = šum/kmitání.
// v73.239: každá částice má ~35% šanci dostat barvu zničeného pixelu (jinak bílá).
const DUST_TINT_CHANCE = 0.35;
function triggerDustBurst(gx, gy, hexColor) {
  if (!state.ready || !state.dustMesh) return;
  if ((state.qualityTier || 0) >= 2) return;          // v73.255: LOW tier → bez dust
  const wx = gx * SCALE + SCALE / 2;
  const wy = (state.GH - gy) * SCALE - SCALE / 2;
  const tintColor = hexColor ? _getColor(hexColor) : null;
  const count = 1 + (Math.random() < 0.18 ? 1 : 0); // v73.252: avg ~1.18 (jeste o trochu min)
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const useTint = tintColor && Math.random() < DUST_TINT_CHANCE;
    state.dust.push({
      x: wx + (Math.random() - 0.5) * 4,
      y: wy + (Math.random() - 0.5) * 4,
      vx: Math.cos(a) * DUST_SPEED * (0.5 + Math.random() * 0.6),
      vy: Math.sin(a) * DUST_SPEED * (0.3 + Math.random() * 0.5),
      phase: Math.random() * Math.PI * 2,
      freq: 1.4 + Math.random() * 2.2,
      brightness: 0.45 + Math.random() * 0.45,
      t: 0,
      life: DUST_LIFE_MIN + Math.random() * (DUST_LIFE_MAX - DUST_LIFE_MIN),
      // Barva: buď tint pixelu (boostnutý pro additive viditelnost) nebo bílá
      cr: useTint ? Math.min(1, tintColor.r * 1.3 + 0.1) : 1,
      cg: useTint ? Math.min(1, tintColor.g * 1.3 + 0.1) : 1,
      cb: useTint ? Math.min(1, tintColor.b * 1.3 + 0.1) : 1,
    });
  }
  while (state.dust.length > MAX_DUST) state.dust.shift();
}

// Hit bounce při odrazu projektilu od špatné barvy — jen hit pixel + bezprostřední sousedi.
// Menší a rychlejší než destroy wave: centrum dostane plný amp, okolí útlumem.
function triggerPixelHit(gx, gy) {
  if (!state.ready) return;
  const RADIUS = 1;
  const BASE_AMP  = 4;   // střed dostane plný amp
  const LIFE      = 0.18;
  const WAVE_SPEED = 0.015;
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) continue;
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= state.GW || ny < 0 || ny >= state.IMG_GH) continue;
      const amp = BASE_AMP * (1 - dist / (RADIUS + 1));
      const delay = dist * WAVE_SPEED;
      const key = ny * state.GW + nx;
      const existing = state.pixelBounce.get(key);
      if (!existing || existing.amp < amp) {
        state.pixelBounce.set(key, { t: 0, delay, life: LIFE, amp });
      }
    }
  }
}

// Vlna bounce po destrukci pixelu — rozjede se z (gx, gy) do okolí.
// Sousední pixely poskočí nahoru se zpožděním úměrným vzdálenosti.
function triggerPixelWave(gx, gy) {
  if (!state.ready) return;
  const RADIUS = 4;
  const WAVE_SPEED = 0.042; // s per grid cell vzdálenosti
  const BASE_AMP  = 8;      // Three.js units Z-boost v centru vlny
  const LIFE      = 0.36;   // s trvání jednoho bounce
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      if (dx === 0 && dy === 0) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) continue;
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= state.GW || ny < 0 || ny >= state.IMG_GH) continue;
      const amp = BASE_AMP * (1 - dist / (RADIUS + 1));
      const delay = dist * WAVE_SPEED;
      const key = ny * state.GW + nx;
      const existing = state.pixelBounce.get(key);
      if (!existing || existing.amp < amp) {
        state.pixelBounce.set(key, { t: 0, delay, life: LIFE, amp });
      }
    }
  }
}

// Update animací. Volá se z beltLoop každý frame s dt v sekundách.
function updateAnimations(dt) {
  if (!state.ready || !state.shardMesh) return;
  const H = state.GH * SCALE;
  const G = -280; // gravity (px/s²) — v Y-up scéně, ale pro Z osu (kostky padají dolů v Z)
  for (let i = state.shards.length - 1; i >= 0; i--) {
    const s = state.shards[i];
    s.t += dt;
    if (s.t >= s.life) { state.shards.splice(i, 1); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    if (s.gravity) s.vz += G * dt;
    s.rot += s.vRot * dt;
    if (s.z < 0) { s.z = 0; s.vz *= -0.4; s.vx *= 0.7; s.vy *= 0.7; } // bounce off ground
  }
  // Render shards do InstancedMesh
  let i = 0;
  for (const s of state.shards) {
    if (i >= MAX_SHARDS) break;
    const tn = s.t / s.life; // 0..1
    const sc = s.scaleStart + (s.scaleEnd - s.scaleStart) * tn;
    const fade = Math.max(0.05, 1 - tn * 0.85); // fade barvy k 15% na konci
    _dummy.position.set(s.x, H - s.y, s.z);
    _dummy.rotation.set(0, 0, s.rot);
    _dummy.scale.set(sc, sc, sc);
    _dummy.updateMatrix();
    state.shardMesh.setMatrixAt(i, _dummy.matrix);
    state.shardMesh.instanceColor.setXYZ(i, s.color.r * fade, s.color.g * fade, s.color.b * fade);
    i++;
  }
  state.shardMesh.count = i;
  if (i > 0 || state.shardMesh.instanceMatrix.needsUpdate === false) {
    state.shardMesh.instanceMatrix.needsUpdate = true;
    state.shardMesh.instanceColor.needsUpdate = true;
  }

  // v73.228: CA ghost update + render
  if (state.ghostMesh) {
    for (let i = state.ghosts.length - 1; i >= 0; i--) {
      state.ghosts[i].t += dt;
      if (state.ghosts[i].t >= state.ghosts[i].life) state.ghosts.splice(i, 1);
    }
    let gi = 0;
    for (const g of state.ghosts) {
      if (gi >= MAX_GHOSTS) break;
      const fade = Math.max(0, 1 - g.t / g.life);
      _dummy.position.set(g.x, H - g.y, PIXEL_DEPTH + 2);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      state.ghostMesh.setMatrixAt(gi, _dummy.matrix);
      state.ghostMesh.instanceColor.setXYZ(gi, g.color.r * fade, g.color.g * fade, g.color.b * fade);
      gi++;
    }
    state.ghostMesh.count = gi;
    state.ghostMesh.instanceMatrix.needsUpdate = true;
    state.ghostMesh.instanceColor.needsUpdate = true;
  }

  // v73.238: dust motes — spawned on destroy, drift + shimmer + lifetime fade, pak die
  if (state.dustMesh) {
    // 1) update + cull mrtvých (zezadu, aby splice nezbořilo index)
    for (let di = state.dust.length - 1; di >= 0; di--) {
      const d = state.dust[di];
      d.t += dt;
      if (d.t >= d.life) { state.dust.splice(di, 1); continue; }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.phase += d.freq * dt;
      d.vx *= 0.985; // jemné tlumení driftu
      d.vy *= 0.985;
    }
    // 2) render instancí
    let di = 0;
    for (const d of state.dust) {
      if (di >= MAX_DUST) break;
      const tn = d.t / d.life;
      // envelope: fade in 0..0.15, full 0.15..0.6, fade out 0.6..1
      let env;
      if (tn < 0.15) env = tn / 0.15;
      else if (tn < 0.6) env = 1;
      else env = 1 - (tn - 0.6) / 0.4;
      const shimmer = 0.55 + 0.45 * Math.sin(d.phase); // 0.1..1
      const alpha = d.brightness * env * shimmer;
      _dummy.position.set(d.x, d.y, DUST_Z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      state.dustMesh.setMatrixAt(di, _dummy.matrix);
      state.dustMesh.instanceColor.setXYZ(di, d.cr * alpha, d.cg * alpha, d.cb * alpha);
      di++;
    }
    state.dustMesh.count = di;
    state.dustMesh.instanceMatrix.needsUpdate = true;
    if (di > 0) state.dustMesh.instanceColor.needsUpdate = true;
  }

  // Advance pixel wave timers; refresh grid každý frame dokud vlna běží
  if (state.pixelBounce.size > 0) {
    let anyActive = false;
    for (const [key, b] of state.pixelBounce) {
      b.t += dt;
      if (b.t >= b.delay + b.life) { state.pixelBounce.delete(key); continue; }
      anyActive = true;
    }
    if (anyActive && state._lastGrid && state._lastColors) {
      updateGrid(state._lastGrid, state._lastColors);
    }
  }
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
  state._lastGrid = grid;
  state._lastColors = COLORS;
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
      // Wave bounce → STRETCH up (pixel zůstává na zemi, jen roste nahoru)
      let zStretch = 0;
      const bounce = state.pixelBounce.get(y * state.GW + x);
      if (bounce) {
        const bt = bounce.t - bounce.delay;
        if (bt > 0) {
          const bp = bt / bounce.life; // 0..1
          // Pouze pozitivní (stretching), clamp na 0 pro negativní fázi
          zStretch = Math.max(0, Math.sin(bp * Math.PI * 2) * bounce.amp * (1 - bp));
        }
      }
      const stretchH = h + zStretch / PIXEL_DEPTH;
      _dummy.position.set(
        x * SCALE + SCALE / 2,
        H - (y * SCALE + SCALE / 2),  // Y-flip: grid[0] → top of screen
        PIXEL_LIFT * stretchH          // střed = polovina nové výšky → bottom na z=0
      );
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, stretchH);
      _dummy.updateMatrix();
      state.pixelMesh.setMatrixAt(i, _dummy.matrix);
      const col = _getColor(COLORS[c]);
      state.pixelMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
      // v73.24: outline mesh — same position, scaled up po XYZ (BackSide inverted hull)
      _dummy.scale.set(1.08, 1.08, stretchH * 1.04);
      _dummy.updateMatrix();
      state.pixelOutlineMesh.setMatrixAt(i, _dummy.matrix);
      i++;
    }
  }
  state.pixelMesh.count = i;
  state.pixelMesh.instanceMatrix.needsUpdate = true;
  state.pixelMesh.instanceColor.needsUpdate = true;
  state.pixelOutlineMesh.count = i;
  state.pixelOutlineMesh.instanceMatrix.needsUpdate = true;
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

// Aktualizuje projektilní InstancedMesh z aktuálního particles array.
// Iteruje pouze 'fly' fáze (létající balónky); rocket/pop/confetti/shards
// zůstávají 2D na particle-canvas (krátkodobé efekty, není potřeba 3D).
function updateProjectiles(particles) {
  if (!state.ready || !state.projectileMesh) return;
  const H = state.GH * SCALE;
  const mesh = state.projectileMesh;
  let i = 0;
  const now = performance.now();
  // v73.259: pokud autoUpdate=false (MED tier), refreshni shadow map když lítají projektily
  if (state.sun && !state.sun.shadow.autoUpdate) {
    for (const p of particles) { if (p.phase === 'fly') { state.sun.shadow.needsUpdate = true; break; } }
  }
  for (const p of particles) {
    if (p.phase !== 'fly') continue;
    if (i >= MAX_PROJECTILES) break;
    // v73.50: motion trail — každých ~40 ms spawn drobný shard za projektilem.
    if (state.shardMesh && (!p._lastTrail || now - p._lastTrail > 40)) {
      p._lastTrail = now;
      state.shards.push({
        x: p.x, y: p.y, z: PROJECTILE_Z,
        vx: 0, vy: 0, vz: 0,
        rot: 0, vRot: 0,
        scaleStart: 0.28,
        scaleEnd: 0,
        t: 0, life: 0.18,
        color: _getColor(p.color).clone(),
        gravity: false,
      });
    }
    // v73.46: squash & stretch po bounce — XY squash (smáčknuté), Z stretch (vytažené dolů).
    // Curve: 0..0.18 s. Peak squash hned po bouncu, oscillation back to normal.
    let sx = 1, sy = 1, sz = 1;
    if (p.bounceT0 !== undefined) {
      const t = (now - p.bounceT0) / 1000;
      const DUR = 0.18;
      if (t < DUR) {
        // dampened sin amplitude: silnější na začátku, klesá k 0
        const tt = t / DUR;
        const decay = 1 - tt;
        const wave = Math.sin(tt * Math.PI);
        const k = 0.55 * decay * wave;  // v73.48: squash strength 0.35 → 0.55 (výraznější)
        sx = 1 + k;          // wide
        sy = 1 + k;          // wide (XY)
        sz = 1 - k * 0.9;    // short (Z)
      }
    }
    _dummy.position.set(p.x, H - p.y, PROJECTILE_Z); // Y-flip: canvas Y → world Y
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(sx, sy, sz);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    const col = _getColor(p.color);
    mesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
    // v73.47: outline mesh — same matrix but scaled up by OUTLINE_SCALE.
    if (state.projectileOutlineMesh) {
      const oS = 1.12;
      _dummy.scale.set(sx * oS, sy * oS, sz * oS);
      _dummy.updateMatrix();
      state.projectileOutlineMesh.setMatrixAt(i, _dummy.matrix);
    }
    i++;
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  if (i > 0) mesh.instanceColor.needsUpdate = true;
  if (state.projectileOutlineMesh) {
    state.projectileOutlineMesh.count = i;
    state.projectileOutlineMesh.instanceMatrix.needsUpdate = true;
  }
}

// Vystavit API na window pro game.js (klasický script).
if (typeof window !== 'undefined') {
  window.render3d = {
    init,
    updateGrid,
    updateBlocks,
    updateProjectiles,
    triggerPixelDestroy,
    triggerPixelCA,       // v73.228
    triggerDustBurst,     // v73.238
    setQualityTier: (tier) => {
      // v73.262: zjednodušeno — shadows mají jen ON/OFF (HIGH ON, MED+LOW OFF).
      // MED drží plnou retina pixel ratio jako HIGH, jen vypne stíny + bg-canvas + flash redukce.
      // Sticky: jakmile shadows jednou OFF (kterýkoli tier ≥ 1), nikdy už ne ON.
      const prev = state.qualityTier || 0;
      state.qualityTier = Math.max(0, Math.min(2, tier|0));
      const t = state.qualityTier;
      if (prev >= 1 || state._shadowsStuckOff) state._shadowsStuckOff = true;
      const shadowsOn = (t === 0) && !state._shadowsStuckOff;
      const shadowsChanged = (state.renderer && state.renderer.shadowMap.enabled !== shadowsOn);

      // Pixel ratio: HIGH a MED drží plnou retinu (min(dpr,2)), jen LOW snižuje na 1.5.
      if (state.renderer) {
        const dpr = window.devicePixelRatio || 1;
        const target = t < 2 ? Math.min(dpr, 2) : Math.min(dpr, 1.5);
        state.renderer.setPixelRatio(target);
      }
      if (state.renderer) state.renderer.shadowMap.enabled = shadowsOn;
      if (state.pixelMesh) state.pixelMesh.castShadow = shadowsOn;
      if (state.blockMesh) state.blockMesh.castShadow = shadowsOn;
      if (state.projectileMesh) state.projectileMesh.castShadow = shadowsOn;
      if (state.shardMesh) state.shardMesh.castShadow = shadowsOn;

      // HIGH = plné stíny (512 PCFSoft, autoUpdate). MED+ = stíny off, žádná downgrade fáze.
      if (shadowsOn && state.sun && state.renderer) {
        state.sun.shadow.mapSize.set(512, 512);
        state.sun.shadow.autoUpdate = true;
        state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }

      // Force material recompile při toggle nebo type/size change ať shader vidí nový stav
      if ((shadowsChanged || prev !== t) && state.scene) {
        state.scene.traverse((obj) => {
          const m = obj.material;
          if (!m) return;
          if (Array.isArray(m)) m.forEach(mm => mm.needsUpdate = true);
          else m.needsUpdate = true;
        });
        if (state.renderer) state.renderer.shadowMap.needsUpdate = true;
      }
      // Cleanup particles při downgrade na LOW
      if (t >= 2) {
        if (state.dust) state.dust.length = 0;
        if (state.ghosts) state.ghosts.length = 0;
        if (state.dustMesh) state.dustMesh.count = 0;
        if (state.ghostMesh) state.ghostMesh.count = 0;
      }
    },
    // v73.259: API pro manuální shadow refresh při on-demand update režimu (MED tier)
    requestShadowUpdate: () => {
      if (state.sun && !state.sun.shadow.autoUpdate) state.sun.shadow.needsUpdate = true;
    },
    getQualityTier: () => state.qualityTier || 0,
    triggerPixelWave,
    triggerPixelHit,
    triggerBounceSpark,   // v73.49
    updateAnimations,
    render,
    isReady,
    setVisible,
    dispose,
    setStyle,
    getStyle: () => state.style,
    listStyles: () => STYLES.slice(),
    getDestroyMode: () => state.destroyMode,
    setDestroyMode: (m) => { if (DESTROY_MODES.includes(m)) state.destroyMode = m; },
    listDestroyModes: () => DESTROY_MODES.slice(),
    // v73.205: color tuning hooks pro dev color picker
    setImageFrameColor: (hex) => {
      if (state.imageFrame && state.imageFrame.material) {
        state.imageFrame.material.color.set(hex);
      }
    },
    getImageFrameColor: () => state.imageFrame?.material?.color?.getHexString() || 'f4b8c8',
  };
  // Signalizace, že modul je připravený. game.js může poslouchat tenhle event,
  // pokud by měl race condition (zatím ne — body onload čeká na všechny scripty
  // včetně modulů, takže initGame() vidí window.render3d).
  window.dispatchEvent(new Event('render3d-loaded'));
}

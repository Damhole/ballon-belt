// render3d_bottom.js — Three.js render layer pro bottom area (belt + pending + carriers)
// Jeden WebGL canvas pokrývá celou oblast pod image-area: belt-wrap + pending-wrap + carriers-wrap.
// Canvas je absolutně pozicovaný nad DOM (z-index:2, pointer-events:none) takže DOM carrier divy
// zůstávají jako transparentní click targets.
// API vystaveno přes window.render3dBottom = { init, updateCarriers, updatePending, updateBelt, render, isReady, dispose }

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─── Konstanty (musí odpovídat game.js) ──────────────────────────────────────
const BELT_SVG_H      = 64;    // výška #belt-svg viewBox
const PENDING_CANVAS_H = 50;   // výška #pending-canvas (v71.6: půlka)
const BELT_CAP        = 14;    // max balls na pásu
const BELT_STARTX     = 50;    // BELT_LX + BELT_BALL_R + 8
const BELT_ENDX       = 310;   // BELT_RX - BELT_BALL_R - 8
const BELT_SPACING    = (BELT_ENDX - BELT_STARTX) / (BELT_CAP - 1); // ~20
const BELT_TOTAL      = BELT_CAP * BELT_SPACING;                     // ~280
const BELT_CENTER_CSS_Y = 32;  // (trackY1+trackY2)/2 = (18+46)/2

// Poloměry koulí (3D) — sjednoceno, aby koule v carriers/trychtýři/belt měly stejnou velikost
// Sphere radii — separate geometries pro každý kontext:
// - R_CARRIER: balls uvnitř nosiče (2×2 grid). Geometry × slotScale → škáluje
//   proporčně s velikostí nosiče. v71.23: 12 → 11 (mírně menší v poměru
//   k nosiči — user intent).
// - R_PENDING: balls ve funnelu. Scale 1, fixní velikost.
// - R_BELT: balls na pásu. Scale 1, fixní velikost (= pending → consistent
//   pohled při přechodu funnel → belt).
const R_CARRIER = 11;
const R_PENDING = 12;
const R_BELT    = 12;

// Carrier slot rounded-box geometry parametry
const SLOT_SIZE       = 50;   // CSS px — vnitřní velikost krabičky
const SLOT_RADIUS     = 9;    // zaoblení rohů
const SLOT_DEPTH      = 14;   // hloubka krabičky (Z)
const SLOT_BEVEL      = 1.6;  // bevel pro hladké hrany

// Outline (inverted-hull technique) — scale faktor pro outline mesh
const OUTLINE_SCALE_BALL = 1.13;  // koule outline 13 %
const OUTLINE_SCALE_SLOT = 1.05;  // v73.51: slot outline 7 % → 5 % (jemnější)
const WALL_OUTLINE_PX    = 1.6;   // wall outline — pevná tloušťka v CSS px (uniform, ne scale)
const OUTLINE_COLOR      = 0x000000;  // čistá černá (cartoon look)

// Tilt — stejný úhel jako render3d.js image area pro vizuální konzistenci
const TILT_DEG = 19.2;
const TILT_RAD = TILT_DEG * Math.PI / 180;

const MAX_CARRIER_BALLS = 300;
const MAX_CARRIER_SLOTS = 80;
const MAX_PENDING       = 30;

// Walls — v72.16. Per-cell 3D box, color matched s --carriers-3d-bg.
// Depth mírně vyšší než SLOT_DEPTH → walls vyčnívají jako obstacle.
const WALL_DEPTH         = 18;
const WALL_BEVEL         = 1.2;   // 3D top→side soft edge (malý, jen pro Toon)
const WALL_BEVEL_SEGS    = 2;     // segmenty bevelu
const WALL_CORNER_RADIUS = 4.5;   // poloměr zaoblení rohů polygonu (silhouette)
const MAX_WALL_INSTANCES = 50;

// ─── Stav scény ──────────────────────────────────────────────────────────────
const st = {
  scene:        null,
  camera:       null,
  renderer:     null,
  canvas:       null,
  W:            360,
  H:            240,
  ready:        false,
  // Y-offset (v CSS px od vrchu canvasu) kde začíná pending a carriers oblast
  beltCenterY:    40,                   // přepočítá se v init() dynamickým měřením
  pendingTopCSS:  BELT_SVG_H,          // přepočítá se v init() dynamickým měřením
  carriersTopCSS: BELT_SVG_H + PENDING_CANVAS_H,  // carriers pod pending
  beltOffsetX:    0,                    // offset belt-wrap od levé hrany canvasu (canvas může být širší)
  // Carrier-fire animace — Map<id, {t0, x, y, w, h, hex, n}>
  carrierAnim:    new Map(),
  _carrierAnimId: 0,
  // Inactive→active pop anim: Map<carrierKey "c,r", t0>
  carrierPopAnim: new Map(),
  // Cache active state per carrier pro detekci přechodu inactive→active
  carrierActiveCache: new Map(),
  // Mystery → active reveal anim: Map<carrierKey, t0>, v72.58
  mysteryRevealAnim: new Map(),
  // Cache hidden visual state per carrier pro detekci mystery → reveal přechodu
  carrierHiddenCache: new Map(),
  // Per-reveal one-off Mesh + ShaderMaterial s circular discard, v72.62
  // Map<carrierKey, { mesh, mat, t0, uniforms }>
  mysteryRevealMeshes: new Map(),
  // v72.78: denial shake anim (klik na inactive / mystery) — Map<carrierKey, t0>
  carrierDenialAnim: new Map(),
  // Tilt struktura: pivot (centerO) → tiltGroup (rotace -TILT_RAD okolo X) → contentGroup (posun zpět)
  pivot:        null,
  tiltGroup:    null,
  contentGroup: null,
  // InstancedMesh — main pass
  carrierSlotMesh: null,  // 3D rounded-box krabičky (slot containers)
  carrierMesh: null,
  pendingMesh: null,
  beltMesh:    null,
  // InstancedMesh — outline pass (inverted hull, BackSide black)
  carrierSlotOutlineMesh: null,
  carrierOutlineMesh:     null,
  pendingOutlineMesh:     null,
  beltOutlineMesh:        null,
  // Belt track meshes (regular Mesh + outline)
  beltPlane:        null,
  beltPlaneOutline: null,
  beltRollerL:      null,
  beltRollerLOutline: null,
  beltRollerR:      null,
  beltRollerROutline: null,
  // Dummy objekt pro matrix výpočty (reuse)
  _dummy: new THREE.Object3D(),
  _col3:  new THREE.Color(),
  _colorCache: {},
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _hex(hex) {
  if (!st._colorCache[hex]) st._colorCache[hex] = new THREE.Color(hex);
  return st._colorCache[hex];
}

// Vytvoří rounded-box geometrii (extruzi z rounded shape).
// w/h = vnější rozměr, r = poloměr rohů, depth = hloubka v Z.
function _roundedBoxGeom(w, h, r, depth, bevel) {
  const shape = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: depth,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  // Vystředit Z (extruze jde od 0 do depth → posun o -depth/2)
  geom.translate(0, 0, -depth / 2);
  return geom;
}

// CSS pixel coords (Y=0 nahoře) → Three.js world coords (Y=0 dole, Y=H nahoře)
function _worldY(cssY) { return st.H - cssY; }

// Toon shader gradient: 3-band cel-shaded look — větší kontrast u shadow bandu
// (47 %), takže spodek koule je viditelně tmavší než středový mid-tone.
// 120 = shadow (47 %), 200 = mid (78 %), 255 = bright cap (100 %).
function _makeToonGradient() {
  const data = new Uint8Array([120, 200, 255]);
  const tex  = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Pro velmi tmavé barvy (např. černý nosič #141414) zvedni minimální jas, aby
// shading bandy byly vidět. Pure black × cokoliv = black → bez liftu nic neuvidíš.
function _liftDark(col) {
  const lum = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;
  if (lum < 0.18) {
    const t = (0.18 - lum) / 0.18;
    col.r += (0.30 - col.r) * t;
    col.g += (0.30 - col.g) * t;
    col.b += (0.34 - col.b) * t;
  }
}

// Outline material — black, BackSide → renderuje pouze zadní stěny zvětšeného mesh,
// které prosvítají na siluetě → vytvoří outline.
function _outlineMat() {
  return new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    side: THREE.BackSide,
    fog: false,
  });
}

// Mystery texture — 4×4 grid malých `?` glyphů, každý natočený 45°.
// Wrap S i T s repeat=(1.5, 1.5) → 1:1 aspect, glyphy klouzají diagonálně přes
// offset.x i offset.y v render(). Tmavá desaturovaná modrá base.
function _buildMysteryTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  // Velmi tmavá desaturovaná modrá base
  ctx.fillStyle = '#010206';
  ctx.fillRect(0, 0, S, S);
  // 3×3 grid středně velkých tilted ?s + jemný tmavý outline (stroke před fill).
  ctx.font = 'bold 40px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  const N = 3;
  const cell = S / N;
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const cx = col * cell + cell / 2;
      const cy = row * cell + cell / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);
      // Outline (stroke first, then fill overlays)
      ctx.strokeText('?', 0, 0);
      ctx.fillStyle = 'rgba(220, 225, 240, 0.55)';
      ctx.fillText('?', 0, 0);
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.repeat.set(0.7, 0.7);   // ~2×2 glyphů visible per slot, větší rozestupy
  return tex;
}

// Reveal shader material — kruhový "wipe" od středu UV (0.5, 0.5). uRevealT 0→1.
// Sdílí texturu + offset s rowMysteryMeshes (st._mysteryTex), aby ? glyphy
// pokračovaly v animaci i během reveal. mapRepeat sync s st._mysteryTex.repeat.
function _buildRevealMaterial(mysteryTex) {
  const uniforms = {
    map:       { value: mysteryTex },
    mapOffset: { value: new THREE.Vector2(0, 0) },
    mapRepeat: { value: new THREE.Vector2(mysteryTex.repeat.x, mysteryTex.repeat.y) },
    uRevealT:  { value: 0 },
  };
  const MAX_DIST = SLOT_SIZE * 0.72;  // ~36 pro SLOT_SIZE=50 — dist od středu k rohu boxu
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec2 mapOffset;
      uniform vec2 mapRepeat;
      uniform float uRevealT;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        // Radial discard v object-space XY — uniformní přes top i side faces
        // (UV based wipe by tvořil two-phase bug: top má 0-1 UV, sides perimetr).
        float dist = length(vLocalPos.xy);
        float cutR = uRevealT * ${MAX_DIST.toFixed(2)};
        if (dist < cutR) discard;
        // Soft edge pro plynulý přechod (1 unit = 1 px world)
        float edge = smoothstep(cutR - 1.5, cutR, dist);
        vec2 sampleUV = vUv * mapRepeat + mapOffset;
        vec4 tex = texture2D(map, sampleUV);
        gl_FragColor = vec4(tex.rgb, tex.a * edge);
      }
    `,
    // v72.66: opaque místo transparent — pending balls (renderOrder 150) jinak
    // renderují AŽ po transparent pass = reveal mesh by je překryl. S transparent:false
    // jsme v opaque pass kde renderOrder 144 < 150 → pending balls draw po reveal mesh.
    // Smooth edge alpha už nebude (discard je hard), což je acceptable trade-off.
    transparent: false,
    depthTest: false,   // carrier balls z=9.75 by jinak failed test → balls by prosvítaly
                        // od t=0. Bez depth testu reveal vždy překryje carriers (renderOrder
                        // mezi nimi a pending balls), ale pending balls se přes ně dál vykreslí.
    depthWrite: false,
    fog: false,
  });
  return { mat, uniforms };
}

// ExtrudeGeometry mapuje top-face UV na world coords (-25..25). Pro mystery slot
// chceme 0-1 UV → naklonujeme slotGeom a přepíšeme UV bufferAttribute.
function _buildMysterySlotGeom(slotGeom) {
  const geom = slotGeom.clone();
  const uvAttr = geom.attributes.uv;
  const posAttr = geom.attributes.position;
  const half = SLOT_SIZE / 2;
  for (let i = 0; i < uvAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    // Normalize -half..half → 0..1
    uvAttr.setXY(i, (x + half) / SLOT_SIZE, (y + half) / SLOT_SIZE);
  }
  uvAttr.needsUpdate = true;
  return geom;
}

// ─── Inicializace ────────────────────────────────────────────────────────────

function init() {
  if (st.ready) return true;
  if (!THREE) return false;

  const gameEl   = document.getElementById('game');
  const beltWrap = document.getElementById('belt-wrap');
  if (!gameEl || !beltWrap) return false;

  // Změříme layout TEĎ (browser musí mít layout vypočítaný)
  const gameRect = gameEl.getBoundingClientRect();
  const beltRect = beltWrap.getBoundingClientRect();

  // Spodní hranice: bottom-deck (pending+carriers v 3D) nebo carriers-wrap (2D)
  const bottomEl = document.getElementById('bottom-deck') ||
                   document.getElementById('carriers-wrap');
  const bottomRect = bottomEl ? bottomEl.getBoundingClientRect() : beltRect;

  // Canvas musí pokrýt nejširší area (carriers/pending = 420 px, belt = 360 px)
  const carrEl     = document.getElementById('carriers-wrap');
  const pendWrapEl = document.getElementById('pending-wrap');
  let widestRect = beltRect;
  if (carrEl && carrEl.getBoundingClientRect().width > widestRect.width) widestRect = carrEl.getBoundingClientRect();
  if (pendWrapEl && pendWrapEl.getBoundingClientRect().width > widestRect.width) widestRect = pendWrapEl.getBoundingClientRect();

  const W = Math.ceil(widestRect.width);
  // v72.75: +400 px buffer (was +90) — canvas musí pojmout MAX_ROWS=7 i když init
  // bežel s menším levelem. Level switch by jinak vyžadoval canvas resize, který
  // by rozbil staticky pozicovaný belt track. Extra prostor = neviditelný (pod deckem).
  const H = Math.max(180, Math.ceil(bottomRect.bottom - beltRect.top) + 400);

  st.W = W;
  st.H = H;

  // Canvas pozice relativně k #game divu.
  // POZOR: canvasTop měřený teď zahrnuje aktuální --game-top-extra padding.
  // Abychom auto-followovali jeho budoucí změny (level change s jiným numRows
  // může změnit topExtra), uložíme baseline (= top při topExtra=0) a CSS calc()
  // dopočítá aktuální pozici za běhu. v71.21 fix bug 'belt zůstává stejně
  // pozicovaný' při změně top paddingu.
  const _currentTopExtra = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-top-extra')) || 0;
  const canvasTop  = Math.round(beltRect.top  - gameRect.top);
  const canvasTopBaseline = canvasTop - _currentTopExtra;
  const canvasLeft = Math.round(widestRect.left - gameRect.left);

  // X-offset belt-wrap od levé hrany canvasu (belt-svg + pending-canvas jsou užší a vystředěné)
  st.beltOffsetX = Math.round(beltRect.left - widestRect.left);

  // Dynamicky změřit pozice belt-svg a pending-canvas v rámci bottom3d-canvas
  const beltSvgEl   = document.getElementById('belt-svg');
  const pendEl      = document.getElementById('pending-canvas');
  const beltSvgRect = beltSvgEl ? beltSvgEl.getBoundingClientRect() : null;
  const pendRect    = pendEl    ? pendEl.getBoundingClientRect()    : null;
  if (beltSvgRect) {
    const beltSvgOffY = Math.round(beltSvgRect.top - gameRect.top) - canvasTop;
    st.beltCenterY   = beltSvgOffY + Math.round(beltSvgRect.height / 2);
  }
  if (pendRect) {
    st.pendingTopCSS = Math.round(pendRect.top - gameRect.top) - canvasTop;
  }
  if (carrEl) {
    const cR = carrEl.getBoundingClientRect();
    st.carriersTopCSS    = Math.round(cR.top    - gameRect.top) - canvasTop;
    st.carriersBottomCSS = Math.round(cR.bottom - gameRect.top) - canvasTop;
  }

  // Vytvořit canvas a přidat do #game
  const canvas = document.createElement('canvas');
  canvas.id = 'bottom3d-canvas';
  canvas.width  = W;
  canvas.height = H;
  canvas.style.cssText = [
    'position:absolute',
    `left:${canvasLeft}px`,
    `top:calc(${canvasTopBaseline}px + var(--game-top-extra, 0px))`,
    `width:${W}px`,
    `height:${H}px`,
    'pointer-events:none',
    'z-index:2',
    'display:block',
  ].join(';');

  if (getComputedStyle(gameEl).position === 'static') gameEl.style.position = 'relative';
  gameEl.appendChild(canvas);
  st.canvas = canvas;

  // Three.js renderer — toon look nepotřebuje shadow mapy (cel-shading je flat)
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = false;

  // OrthographicCamera: (left, right, top, bottom)
  // top=H → y=H je horní kraj; bottom=0 → y=0 je dolní kraj (Y-up konvence)
  // Mapování CSS→world: x_world = x_css, y_world = H - y_css
  const camera = new THREE.OrthographicCamera(0, W, H, 0, -300, 300);
  camera.position.set(0, 0, 100);

  const scene = new THREE.Scene();

  // Tilt struktura — všechny meshes půjdou do contentGroup, který je naklopený
  // o -TILT_RAD okolo X osy s pivotem ve středu canvas, podobně jako render3d.js.
  const pivot = new THREE.Group();
  pivot.position.set(W / 2, H / 2, 0);
  scene.add(pivot);

  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.x = -TILT_RAD;
  pivot.add(tiltGroup);

  const contentGroup = new THREE.Group();
  contentGroup.position.set(-W / 2, -H / 2, 0);  // posun zpět do původního souřadnic. systému
  tiltGroup.add(contentGroup);

  st.pivot = pivot;
  st.tiltGroup = tiltGroup;
  st.contentGroup = contentGroup;

  // Osvětlení: ŽÁDNÝ ambient (rozmazává toon bands).
  // Light z 3/4 úhlu (top-front-left) → přirozený 3D shading, ne flat-front.
  // Highlight na top-left, shadow na bottom-right. Klasické art-school 3/4 lighting.
  // Intensity = π kompenzuje BRDF_Diffuse_Lambert dělení / π → full saturation.
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  sun.position.set(-300, 800, 600);
  scene.add(sun);

  st.scene    = scene;
  st.camera   = camera;
  st.renderer = renderer;

  // Sdílená geometrie pro koule (víc segmentů → hladší shading)
  const carrierGeom = new THREE.SphereGeometry(R_CARRIER, 24, 16);
  const pendingGeom = new THREE.SphereGeometry(R_PENDING, 18, 12);
  const beltGeom    = new THREE.SphereGeometry(R_BELT,    24, 16);

  // Toon shader gradient — sdílený mezi všemi materiály
  const toonGrad = _makeToonGradient();

  const ballMat = () => new THREE.MeshToonMaterial({ gradientMap: toonGrad });

  // Carrier slot rounded boxes (3D containery pro koule).
  // v72.12: split-mesh approach — outer + inner separate InstancedMesh.
  //   - slotMatOuter: výchozí color (white) → instance color × 1.0 = full
  //   - slotMatInner: HSL darken (v72.14) — reduce lightness only, preserve
  //     hue + saturation. Tmavomodrá zůstane modrá, ne načernalá.
  //     Tunable: SLOT_INNER_LIGHTNESS_FACTOR konstanta (0.55 = 45% darker).
  const slotGeom     = _roundedBoxGeom(SLOT_SIZE, SLOT_SIZE, SLOT_RADIUS, SLOT_DEPTH, SLOT_BEVEL);
  const slotMatOuter = new THREE.MeshToonMaterial({ gradientMap: toonGrad });
  const slotMatInner = new THREE.MeshToonMaterial({ gradientMap: toonGrad });
  const slotMat      = slotMatOuter;  // pro initial InstancedMesh creation (placeholder = single group)

  // v72.14: HSL darken pro slotMatInner — preserve hue + saturation, reduce
  // lightness. Standard color-preserving shadow přístup z designerské praxe.
  // Tunable: změň 0.55 ve fragment shaderu (níž = tmavší).
  slotMatInner.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         // HSL conversion (standard Wikipedia formulas)
         vec3 _rgb2hsl(vec3 c) {
           float maxC = max(max(c.r, c.g), c.b);
           float minC = min(min(c.r, c.g), c.b);
           float l = (maxC + minC) * 0.5;
           vec3 hsl = vec3(0.0, 0.0, l);
           if (maxC != minC) {
             float d = maxC - minC;
             hsl.y = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
             if (maxC == c.r)      hsl.x = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
             else if (maxC == c.g) hsl.x = (c.b - c.r) / d + 2.0;
             else                  hsl.x = (c.r - c.g) / d + 4.0;
             hsl.x /= 6.0;
           }
           return hsl;
         }
         float _h2r(float p, float q, float t) {
           if (t < 0.0) t += 1.0;
           if (t > 1.0) t -= 1.0;
           if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
           if (t < 0.5)     return q;
           if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
           return p;
         }
         vec3 _hsl2rgb(vec3 hsl) {
           if (hsl.y == 0.0) return vec3(hsl.z);
           float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
           float p = 2.0 * hsl.z - q;
           return vec3(_h2r(p, q, hsl.x + 1.0/3.0), _h2r(p, q, hsl.x), _h2r(p, q, hsl.x - 1.0/3.0));
         }
        `)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         // v72.14: HSL darken — preserve hue & saturation, reduce lightness only.
         // Tunable: 0.55 = 45 % darker lightness. Nižší = tmavší (0.4 = strong),
         // vyšší = jemnější (0.7 = subtle).
         vec3 _hsl = _rgb2hsl(diffuseColor.rgb);
         _hsl.z *= 0.55;
         diffuseColor.rgb = _hsl2rgb(_hsl);
        `);
  };

  // Helper: vytvoří outline InstancedMesh pro danou geometrii a max počet instancí
  const mkOutline = (geom, max) => {
    const m = new THREE.InstancedMesh(geom, _outlineMat(), max);
    m.count = 0;
    m.renderOrder = -1;  // outline se kreslí PŘED main mesh (BackSide+depth = silueta)
    m.frustumCulled = false;  // InstancedMesh per-instance positions přesahují geometry boundingSphere
    return m;
  };

  // ─── Carrier slots + balls — PER-ROW InstancedMesh ───
  // Důvod: Lower rows musí ALWAYS překrýt upper rows. Explicit renderOrder per row
  // řeší problém že depth test sám nesedí když se mesh boundary překrývají (rounded
  // corners, scene tilt). Drawing order: row 0 první → row 3 poslední (= na vrcholu).
  const ROW_COUNT_MAX = 7;
  const PER_ROW_SLOTS = 20;
  const PER_ROW_BALLS = PER_ROW_SLOTS * 4;
  st.rowSlotMeshes = [];        // outer parts (rim/sides) — slotMatOuter
  st.rowSlotInnerMeshes = [];   // inner parts (top face) — slotMatInner, v72.12
  st.rowSlotOutlineMeshes = [];
  st.rowBallMeshes = [];
  st.rowBallOutlineMeshes = [];
  st.rowMysteryMeshes = [];     // mystery slots (hidden=true) — animated ? texture, v72.46
  st.rowMysteryOutlineMeshes = []; // outline pro mystery — black BackSide, v72.53

  // Mystery texture + material — single texture sdílená všemi rows. Animace v render().
  // MeshToonMaterial s texturou jako map: toon gradient ztlumí side faces jako u
  // běžných carrierů (depth/shading konzistentní), texture color × toon lighting band.
  st._mysteryTex = _buildMysteryTexture();
  st._mysteryMat = new THREE.MeshToonMaterial({
    gradientMap: toonGrad,
    map: st._mysteryTex,
    fog: false,
  });
  // Mystery geometry — clone slotGeom s přepsaným UV mappingem 0-1 na top face
  // (default ExtrudeGeometry UVs jsou world coords -25..25 → texture wraps 100×).
  st._mysterySlotGeom = _buildMysterySlotGeom(slotGeom);
  for (let row = 0; row < ROW_COUNT_MAX; row++) {
    // Slot mesh — OUTER
    const sm = new THREE.InstancedMesh(slotGeom, slotMatOuter, PER_ROW_SLOTS);
    sm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PER_ROW_SLOTS * 3), 3);
    sm.count = 0;
    sm.frustumCulled = false;
    sm.renderOrder = 100 + row * 4;          // higher row = drawn later = on top
    contentGroup.add(sm);
    st.rowSlotMeshes.push(sm);
    // Slot mesh — INNER (top face, separate geometry from GLB primitive 1, darker)
    // v72.12: separate InstancedMesh místo multi-material array (InstancedMesh
    // multi-material support v Three.js je nereliabilní). Same matrix + same
    // color jako outer, materiál × 0.4 modulator = 60 % darker render.
    const smInner = new THREE.InstancedMesh(slotGeom, slotMatInner, PER_ROW_SLOTS);
    smInner.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PER_ROW_SLOTS * 3), 3);
    smInner.count = 0;
    smInner.frustumCulled = false;
    smInner.renderOrder = 100 + row * 4 + 0.5;  // mezi outer (100+r*4) a balls (100+r*4+2)
    contentGroup.add(smInner);
    st.rowSlotInnerMeshes.push(smInner);
    // Slot outline (covers full silhouette — outer + inner share)
    const so = mkOutline(slotGeom, PER_ROW_SLOTS);
    so.renderOrder = 100 + row * 4 - 1;      // before main slot, but in row order
    contentGroup.add(so);
    st.rowSlotOutlineMeshes.push(so);
    // Ball mesh
    const bm = new THREE.InstancedMesh(carrierGeom, ballMat(), PER_ROW_BALLS);
    bm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PER_ROW_BALLS * 3), 3);
    bm.count = 0;
    bm.frustumCulled = false;
    bm.renderOrder = 100 + row * 4 + 2;      // after slot main + outline, within row
    contentGroup.add(bm);
    st.rowBallMeshes.push(bm);
    // Ball outline
    const bo = mkOutline(carrierGeom, PER_ROW_BALLS);
    bo.renderOrder = 100 + row * 4 + 1;      // between slot main and ball
    contentGroup.add(bo);
    st.rowBallOutlineMeshes.push(bo);
    // Mystery slot mesh — uses _mysterySlotGeom (cloned slotGeom + remapped UVs 0-1).
    const mm = new THREE.InstancedMesh(st._mysterySlotGeom, st._mysteryMat, PER_ROW_SLOTS);
    mm.count = 0;
    mm.frustumCulled = false;
    mm.renderOrder = 100 + row * 4;
    contentGroup.add(mm);
    st.rowMysteryMeshes.push(mm);
    // Mystery outline — black BackSide, scaled up. Darker than mystery slot color
    // (slot je #03060d, outline je 0x000000) → vizuálně odděluje slot od bg.
    const mo = mkOutline(slotGeom, PER_ROW_SLOTS);
    mo.renderOrder = 100 + row * 4 - 1;
    contentGroup.add(mo);
    st.rowMysteryOutlineMeshes.push(mo);
  }

  // Legacy single meshes pro carrier-fire ghost anim (zatím)
  st.carrierSlotMesh = new THREE.InstancedMesh(slotGeom, slotMat, MAX_CARRIER_SLOTS);
  st.carrierSlotMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIER_SLOTS * 3), 3);
  st.carrierSlotMesh.count = 0;
  st.carrierSlotMesh.frustumCulled = false;
  st.carrierSlotMesh.renderOrder = 147;   // v72.76: ghost (tilting) nad mystery reveal (144), pod pending (150)
  contentGroup.add(st.carrierSlotMesh);
  // v72.15: parallel inner ghost mesh — během fire animace lift drží i top
  // face (jinak inner mizí ze row mesh, top face vypadá černá).
  st.carrierSlotInnerMesh = new THREE.InstancedMesh(slotGeom, slotMatInner, MAX_CARRIER_SLOTS);
  st.carrierSlotInnerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIER_SLOTS * 3), 3);
  st.carrierSlotInnerMesh.count = 0;
  st.carrierSlotInnerMesh.frustumCulled = false;
  st.carrierSlotInnerMesh.renderOrder = 147.5;  // v72.76: mezi outer ghost (147) a ghost balls (148)
  contentGroup.add(st.carrierSlotInnerMesh);
  st.carrierSlotOutlineMesh = mkOutline(slotGeom, MAX_CARRIER_SLOTS);
  st.carrierSlotOutlineMesh.renderOrder = 146;   // v72.76: pod ghost slot (147), nad mystery reveal (144)
  contentGroup.add(st.carrierSlotOutlineMesh);

  // v72.18: Walls — technique 3 (per-rect Mesh s custom RoundedBoxGeometry).
  // Předchozí InstancedMesh + scale (v72.17) měl pravoúhlé hrany a oválné
  // rounded corners by scaled. Teď generujeme samostatný Mesh per merged rect
  // s exact dimensions → uniform corner radius napříč všemi velikostmi walls.
  // Material shared (theme color), meshes recreated v každém updateWalls call.
  const wallMat = new THREE.MeshToonMaterial({ gradientMap: toonGrad });
  st._wallMat = wallMat;
  // Wall outline material — sdílí barvu wallu (darkened) místo pure black. Vypadá to
  // jako stínovaná část bloku, ne kontrastní okraj.
  st._wallOutlineMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false });
  st._wallContentGroup = contentGroup;  // ref pro dynamic mesh add/remove
  st.wallMeshes = [];         // dynamically created Mesh (per rect)
  st.wallOutlineMeshes = [];  // dynamically created outline Mesh (per rect)

  // Hot-swap slot geometry s GLB assetem (async — placeholder rendered do té doby).
  // Asset z Blenderu má 1m × 1m × 0.28m → scale 50× sjednotí na náš SLOT_SIZE.
  new GLTFLoader().load('./assets/3d/carrier.glb', (gltf) => {
    const geoms = [];
    gltf.scene.traverse(obj => { if (obj.isMesh) geoms.push(obj.geometry.clone()); });
    if (geoms.length === 0) { console.warn('[render3d_bottom] GLB nemá mesh'); return; }
    console.log('[render3d_bottom] GLB má', geoms.length, 'primitives — outer + inner separately rendered');
    // v72.12: pro consistent transform na obou geoms použijeme PRVNÍ geom jako
    // reference (jeho bbox). Stejné scale + center pro všechny → primitives
    // si zachovají svou relativní pozici v rámci slotu.
    // Asset je exportován s +Z up. Apply scale × 50 + common center na VŠECHNY
    // geoms aby si zachovaly relativní pozice (oba primitives z téhož Blender
    // meshe sdílí coord space).
    for (const g of geoms) g.scale(50, 50, 50);
    // Compute combined bbox aby translate byl consistent pro všechny primitives
    const combinedBB = new THREE.Box3();
    for (const g of geoms) {
      g.computeBoundingBox();
      combinedBB.union(g.boundingBox);
    }
    const cx = (combinedBB.min.x + combinedBB.max.x) / 2;
    const cy = (combinedBB.min.y + combinedBB.max.y) / 2;
    const cz = (combinedBB.min.z + combinedBB.max.z) / 2;
    for (const g of geoms) {
      g.translate(-cx, -cy, -cz);
      g.computeBoundingSphere();
    }
    // v72.13: user's Blender konvence — Material.001 (primitive 0) = top face
    // (inner, darker), Material.002 (primitive 1) = outer shell (full color).
    // Swap přiřazení: inner mesh dostane geoms[0], outer mesh dostane geoms[1].
    const geomInner = geoms[0];                                   // primitive 0 = top face (Material.001)
    const geomOuter = geoms.length >= 2 ? geoms[1] : geoms[0];    // primitive 1 = shell    (Material.002)

    // v72.12: separate InstancedMesh per part (outer + inner). Each gets jeho
    // vlastní geometry + material. Per-instance color identický u outer/inner;
    // material.color modulator dělá depth illusion (inner × 0.4 = 60% darker).
    const oldOuterGeom = st.carrierSlotMesh.geometry;
    st.carrierSlotMesh.geometry = geomOuter;               // ghost mesh: jen outer
    st.carrierSlotOutlineMesh.geometry = geomOuter;        // outline: jen outer (full silhouette)
    for (const m of st.rowSlotMeshes) m.geometry = geomOuter;
    for (const m of st.rowSlotOutlineMeshes) m.geometry = geomOuter;
    if (geomInner) {
      for (const m of st.rowSlotInnerMeshes) m.geometry = geomInner;
      // v72.15: inner ghost mesh dostane stejnou geometrii (ghost anim při fire)
      if (st.carrierSlotInnerMesh) st.carrierSlotInnerMesh.geometry = geomInner;
      console.log('[render3d_bottom] GLB primitive 1 → inner mesh assigned (depth illusion ON)');
    } else {
      // Single-primitive GLB: skip inner rendering (no depth illusion)
      for (const m of st.rowSlotInnerMeshes) m.count = 0;
      if (st.carrierSlotInnerMesh) st.carrierSlotInnerMesh.count = 0;
      console.log('[render3d_bottom] GLB single primitive — depth illusion vypnutá');
    }
    if (oldOuterGeom) oldOuterGeom.dispose();
    console.log('[render3d_bottom] carrier.glb loaded, combined bbox:', combinedBB);
  }, undefined, (err) => {
    console.warn('[render3d_bottom] carrier.glb load failed, keep placeholder:', err);
  });

  // ─── Carrier balls — legacy single mesh pouze pro ghost anim ───
  st.carrierMesh = new THREE.InstancedMesh(carrierGeom, ballMat(), MAX_CARRIER_BALLS);
  st.carrierMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIER_BALLS * 3), 3);
  st.carrierMesh.count = 0;
  st.carrierMesh.frustumCulled = false;
  st.carrierMesh.renderOrder = 148;  // v72.76: ghost balls nad ghost slot (147), pod pending (150)
  contentGroup.add(st.carrierMesh);
  st.carrierOutlineMesh = mkOutline(carrierGeom, MAX_CARRIER_BALLS);
  st.carrierOutlineMesh.renderOrder = 147.8;  // v72.76: mezi ghost slot (147) a ghost balls (148)
  contentGroup.add(st.carrierOutlineMesh);

  // ─── Pending balls ───
  st.pendingMesh = new THREE.InstancedMesh(pendingGeom, ballMat(), MAX_PENDING);
  st.pendingMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PENDING * 3), 3);
  st.pendingMesh.count = 0;
  st.pendingMesh.frustumCulled = false;
  st.pendingMesh.renderOrder = 150;  // nad všema row carriery (100–114), pod ghost tilt (200)
  st.pendingMesh.material = st.pendingMesh.material.clone();
  st.pendingMesh.material.depthTest = false;  // renderOrder fully authoritative
  st.pendingMesh.material.depthWrite = false;
  contentGroup.add(st.pendingMesh);
  st.pendingOutlineMesh = mkOutline(pendingGeom, MAX_PENDING);
  st.pendingOutlineMesh.renderOrder = 149;  // pod pendingMesh (150) ale nad carriery
  st.pendingOutlineMesh.material.depthTest = false;
  contentGroup.add(st.pendingOutlineMesh);

  // ─── Pending shadows DISABLED — způsobovaly viditelnost issues ───
  const shadowGeom = new THREE.CircleGeometry(R_PENDING * 1.35, 18);
  const shadowMat  = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
  st.pendingShadowMesh = new THREE.InstancedMesh(shadowGeom, shadowMat, MAX_PENDING);
  st.pendingShadowMesh.count = 0;
  st.pendingShadowMesh.frustumCulled = false;
  st.pendingShadowMesh.visible = false;  // disabled
  contentGroup.add(st.pendingShadowMesh);

  // ─── Belt balls ───
  st.beltMesh = new THREE.InstancedMesh(beltGeom, ballMat(), BELT_CAP);
  st.beltMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BELT_CAP * 3), 3);
  st.beltMesh.count = 0;
  st.beltMesh.frustumCulled = false;
  contentGroup.add(st.beltMesh);
  st.beltOutlineMesh = mkOutline(beltGeom, BELT_CAP);
  contentGroup.add(st.beltOutlineMesh);

  _buildBeltTrack(contentGroup, W, toonGrad, st.beltCenterY);
  _initUnifiedFrame();  // v73.54: belt + skulina + arena jako jeden 3D povrch

  st.ready = true;
  return true;
}

// ─── Belt track geometry ─────────────────────────────────────────────────────

function _buildBeltTrack(parent, W, toonGrad, beltCenterY) {
  const trackCssY = beltCenterY;
  const trackWY   = _worldY(trackCssY);  // world Y středu pásu
  const trackH    = 28;                  // pás výška v 3D (odpovídá trackY2-trackY1=28px)
  const ox        = st.beltOffsetX;      // offset belt-wrap od levé hrany canvasu (belt je 360px wide, vystředěn)
  const beltMid   = ox + 180;            // střed belt-svg (360/2)

  // Belt track plane (toon shader)
  const planeW  = 304;
  const planeGeom = new THREE.BoxGeometry(planeW, trackH, 4);
  const planeMat = new THREE.MeshToonMaterial({ color: 0x4a4a5a, gradientMap: toonGrad });
  const planeMesh = new THREE.Mesh(planeGeom, planeMat);
  planeMesh.position.set(beltMid, trackWY, -2);
  parent.add(planeMesh);
  st.beltPlane = planeMesh;

  // Outline pro plane
  const planeOutline = new THREE.Mesh(planeGeom, _outlineMat());
  planeOutline.position.copy(planeMesh.position);
  planeOutline.scale.setScalar(1.025);
  planeOutline.renderOrder = -1;
  parent.add(planeOutline);
  st.beltPlaneOutline = planeOutline;

  // Válce (rollers) — toon shader
  const rollerGeom = new THREE.CylinderGeometry(trackH / 2, trackH / 2, 20, 20);
  rollerGeom.rotateZ(Math.PI / 2);
  const rollerMat = new THREE.MeshToonMaterial({ color: 0x6b6b7a, gradientMap: toonGrad });

  const rollerL = new THREE.Mesh(rollerGeom, rollerMat);
  rollerL.position.set(ox + 28, trackWY, 2);
  parent.add(rollerL);
  st.beltRollerL = rollerL;

  const rollerLOut = new THREE.Mesh(rollerGeom, _outlineMat());
  rollerLOut.position.copy(rollerL.position);
  rollerLOut.scale.setScalar(1.06);
  rollerLOut.renderOrder = -1;
  parent.add(rollerLOut);
  st.beltRollerLOutline = rollerLOut;

  const rollerR = new THREE.Mesh(rollerGeom, rollerMat);
  rollerR.position.set(ox + 332, trackWY, 2);
  parent.add(rollerR);
  st.beltRollerR = rollerR;

  const rollerROut = new THREE.Mesh(rollerGeom, _outlineMat());
  rollerROut.position.copy(rollerR.position);
  rollerROut.scale.setScalar(1.06);
  rollerROut.renderOrder = -1;
  parent.add(rollerROut);
  st.beltRollerROutline = rollerROut;
}

// ─── Unified surface frame ───────────────────────────────────────────────────
// v73.54: Belt slot + skulina + arena = jeden 3D povrch s proraženými otvory.
// Pattern stejný jako _buildImageFrameGeom v render3d.js — ExtrudeGeometry s
// bevel dává rámu 3D hloubku a depth.
//
// Geometrie: outer rect (full canvas width × visible area height) s jedním
// spojeným hole (belt slot → bridge sides → skulina → arena). Bridge materiál
// na bocích skuliny vizuálně spojuje belt a arenu jako jeden kus.
//
// Souřadnice: world Y (Y-up) — viz _worldY(cssY) = st.H - cssY.

const FRAME_SKULINA_HALF = 40;  // ½ šířky skuliny (80px ≈ 3 balónky × 24px diameter)
const FRAME_ARENA_PAD    = 6;   // tloušťka rámu na bocích arény (px)
const FRAME_DEPTH        = 50;  // ExtrudeGeometry depth — match image frame v73.63
const FRAME_BEVEL        = 2;   // bevel size + thickness — match image frame v73.63
const FRAME_BEVEL_SEGS   = 3;   // bevel segments — match image frame
const FRAME_OUTLINE_PX   = 2;   // tloušťka outline rimu (odpovídá CSS box-shadow 1.5px image)
const FRAME_COLOR        = 0xf4b8c8;  // match image frame color (render3d.js line ~537)
const FRAME_EMISSIVE     = 0x4a2f3d;  // mauve fill — lifts dark inner walls bez ambient light
const FRAME_OUTLINE_COLOR= 0x8a5066;  // mauve-pink rim — match image area box-shadow
const CORNER_R_BOT       = 20;  // radius zaoblení dolních rohů arény (~5% šířky)

function _buildUnifiedFrameGeom(W, p) {
  // Outer shape: velký obdélník přes celou viditelnou oblast (CCW v Y-up)
  const shape = new THREE.Shape();
  shape.moveTo(0,  p.frameBotW);
  shape.lineTo(W,  p.frameBotW);
  shape.lineTo(W,  p.frameTopW);
  shape.lineTo(0,  p.frameTopW);
  shape.lineTo(0,  p.frameBotW);

  // Jeden spojený hole: belt → bridge → skulina → arch → arena (CW v Y-up)
  //
  // Klíčový tvar: skulina (úzká, nahoře) se quadratic Bezier obloukem rozevírá
  // do plné šířky arény (dole). Oblouk = ta "hezká část" — control point je
  // na straně arény ve výšce skuliny, což vytvoří plynulý sweep outward+down.
  //
  //   skulinaRight ──╮            ╭── skulinaLeft
  //                   \          /
  //    (quadratic)     \        /   (quadratic)
  //                     ╰──────╯
  //   arenaRight ────────────────── arenaLeft   ← arenaTopW (níže)

  const hole = new THREE.Path();

  // 1. Start: belt top-left (belt hole dosahuje canvas top)
  hole.moveTo(p.beltLeft,     p.beltTopW);
  // 2. Belt top edge → doprava
  hole.lineTo(p.beltRight,    p.beltTopW);
  // 3. Belt pravá strana → dolů na belt-bottom
  hole.lineTo(p.beltRight,    p.beltBotW);
  // 4. Bridge pravá: krok dovnitř na skulinu pravou (stejná Y)
  hole.lineTo(p.skulinaRight, p.skulinaTopW);
  // 5. Skulina pravá → dolů na skulina-bottom (vrchol pravého oblouku)
  hole.lineTo(p.skulinaRight, p.skulinaBotW);
  // 6. ARCH vpravo: DVA cubic Bezier segmenty (matches curve_2.svg reference).
  //    Segment 1: horizontální sweep s degenerate tangent na hrdle, sweeps 79% width / 41% height
  //    Segment 2: prudký vertikální drop na arena edge s degenerate tangent
  //    Konkavita ven, plynulý smooth tvar jako v SVG referenci.
  const arcW_r = p.arenaRight - p.skulinaRight;
  const arcH_r = p.skulinaBotW - p.arenaTopW;
  // 6a. Segment 1: smooth horizontal sweep z hrdla (CP1 = start = degenerate tangent)
  hole.bezierCurveTo(
    p.skulinaRight,                    p.skulinaBotW,                  // CP1 = start (degenerate)
    p.skulinaRight + arcW_r * 0.505,  p.skulinaBotW - arcH_r * 0.130, // CP2: ~50% across, ~13% down
    p.skulinaRight + arcW_r * 0.785,  p.skulinaBotW - arcH_r * 0.411  // End: ~79% across, ~41% down
  );
  // 6b. Segment 2: vertical drop na arena edge (CP2 = end = degenerate tangent)
  hole.bezierCurveTo(
    p.skulinaRight + arcW_r * 0.959,  p.skulinaBotW - arcH_r * 0.637, // CP1: 96% across, 64% down
    p.arenaRight,                       p.arenaTopW,                    // CP2 = end (degenerate)
    p.arenaRight,                       p.arenaTopW                     // End: arena top-right corner
  );
  // 7. Arena pravá strana → dolů (k zaoblenému spodnímu rohu)
  hole.lineTo(p.arenaRight, p.arenaBotW + CORNER_R_BOT);
  // 7b. Zaoblený pravý spodní roh (quarter-circle Bezier, SVG-style)
  hole.bezierCurveTo(
    p.arenaRight,                          p.arenaBotW + CORNER_R_BOT * 0.448,
    p.arenaRight - CORNER_R_BOT * 0.448,  p.arenaBotW,
    p.arenaRight - CORNER_R_BOT,           p.arenaBotW
  );
  // 8. Arena spodek → doleva (k zaoblenému spodnímu rohu vlevo)
  hole.lineTo(p.arenaLeft + CORNER_R_BOT, p.arenaBotW);
  // 8b. Zaoblený levý spodní roh
  hole.bezierCurveTo(
    p.arenaLeft + CORNER_R_BOT * 0.448,   p.arenaBotW,
    p.arenaLeft,                            p.arenaBotW + CORNER_R_BOT * 0.448,
    p.arenaLeft,                            p.arenaBotW + CORNER_R_BOT
  );
  // 9. Arena levá strana → nahoru na arenaTop
  hole.lineTo(p.arenaLeft, p.arenaTopW);
  // 10. ARCH vlevo: DVA cubic Bezier segmenty (symetricky k pravému)
  const arcW_l = p.skulinaLeft - p.arenaLeft;
  const arcH_l = p.skulinaBotW - p.arenaTopW;
  // 10a. Segment 1: rounded corner z arena bottom (CP1 = start = degenerate)
  hole.bezierCurveTo(
    p.arenaLeft,                       p.arenaTopW,                    // CP1 = start (degenerate)
    p.arenaLeft + arcW_l * 0.041,     p.arenaTopW + arcH_l * 0.363,   // CP2: 4% across, 36% up
    p.arenaLeft + arcW_l * 0.215,     p.arenaTopW + arcH_l * 0.589    // End: 21% across, 59% up
  );
  // 10b. Segment 2: horizontální sweep do hrdla (CP2 = end = degenerate)
  hole.bezierCurveTo(
    p.arenaLeft + arcW_l * 0.495,     p.arenaTopW + arcH_l * 0.870,   // CP1: 50% across, 87% up
    p.skulinaLeft,                     p.skulinaBotW,                   // CP2 = end (degenerate)
    p.skulinaLeft,                     p.skulinaBotW                    // End: skulina edge
  );
  // 11. Skulina levá → nahoru
  hole.lineTo(p.skulinaLeft,  p.skulinaTopW);
  // 12. Bridge levá: krok ven na belt levou
  hole.lineTo(p.beltLeft,     p.beltBotW);
  // 13. Belt levá strana → nahoru
  hole.lineTo(p.beltLeft,     p.beltTopW);
  hole.closePath();

  shape.holes.push(hole);

  return new THREE.ExtrudeGeometry(shape, {
    depth:          FRAME_DEPTH,
    bevelEnabled:   true,
    bevelThickness: FRAME_BEVEL,
    bevelSize:      FRAME_BEVEL,
    bevelSegments:  FRAME_BEVEL_SEGS,
    curveSegments:  8,
  });
}

// v73.77: extract hole path building do samostatné funkce (reuse mezi
// _initUnifiedFrame a _renderMiterOffsetTest). Vrací THREE.Path (CW v Y-up).
function _buildHolePath(p) {
  const hole = new THREE.Path();
  hole.moveTo(p.beltLeft,     p.beltTopW);
  hole.lineTo(p.beltRight,    p.beltTopW);
  hole.lineTo(p.beltRight,    p.beltBotW);
  hole.lineTo(p.skulinaRight, p.skulinaTopW);
  hole.lineTo(p.skulinaRight, p.skulinaBotW);
  const arcW_r = p.arenaRight - p.skulinaRight;
  const arcH_r = p.skulinaBotW - p.arenaTopW;
  hole.bezierCurveTo(
    p.skulinaRight,                    p.skulinaBotW,
    p.skulinaRight + arcW_r * 0.505,  p.skulinaBotW - arcH_r * 0.130,
    p.skulinaRight + arcW_r * 0.785,  p.skulinaBotW - arcH_r * 0.411
  );
  hole.bezierCurveTo(
    p.skulinaRight + arcW_r * 0.959,  p.skulinaBotW - arcH_r * 0.637,
    p.arenaRight,                       p.arenaTopW,
    p.arenaRight,                       p.arenaTopW
  );
  hole.lineTo(p.arenaRight, p.arenaBotW + CORNER_R_BOT);
  hole.bezierCurveTo(
    p.arenaRight,                          p.arenaBotW + CORNER_R_BOT * 0.448,
    p.arenaRight - CORNER_R_BOT * 0.448,  p.arenaBotW,
    p.arenaRight - CORNER_R_BOT,           p.arenaBotW
  );
  hole.lineTo(p.arenaLeft + CORNER_R_BOT, p.arenaBotW);
  hole.bezierCurveTo(
    p.arenaLeft + CORNER_R_BOT * 0.448,   p.arenaBotW,
    p.arenaLeft,                            p.arenaBotW + CORNER_R_BOT * 0.448,
    p.arenaLeft,                            p.arenaBotW + CORNER_R_BOT
  );
  hole.lineTo(p.arenaLeft, p.arenaTopW);
  const arcW_l = p.skulinaLeft - p.arenaLeft;
  const arcH_l = p.skulinaBotW - p.arenaTopW;
  hole.bezierCurveTo(
    p.arenaLeft,                       p.arenaTopW,
    p.arenaLeft + arcW_l * 0.041,     p.arenaTopW + arcH_l * 0.363,
    p.arenaLeft + arcW_l * 0.215,     p.arenaTopW + arcH_l * 0.589
  );
  hole.bezierCurveTo(
    p.arenaLeft + arcW_l * 0.495,     p.arenaTopW + arcH_l * 0.870,
    p.skulinaLeft,                     p.skulinaBotW,
    p.skulinaLeft,                     p.skulinaBotW
  );
  hole.lineTo(p.skulinaLeft,  p.skulinaTopW);
  hole.lineTo(p.beltLeft,     p.beltBotW);
  hole.lineTo(p.beltLeft,     p.beltTopW);
  return hole;
}

function _initUnifiedFrame() {
  const W = st.W;
  const H = st.H;
  const wy = (cssY) => H - cssY;

  // Belt rozměry — match _buildBeltTrack (trackH=28, beltOffsetX)
  const TRACK_H   = 28;
  const beltCY    = st.beltCenterY || 32;
  const beltLeft  = st.beltOffsetX || 30;
  const beltRight = W - beltLeft;

  // CSS Y souřadnice (Y-down od vrcholu canvasu)
  const beltBotCSS  = beltCY + TRACK_H / 2 + 6;   // těsně pod belt
  const skulinaLeft  = W / 2 - FRAME_SKULINA_HALF;
  const skulinaRight = W / 2 + FRAME_SKULINA_HALF;

  // Skulina = úzké hrdlo TĚSNĚ pod belt (kde se balls přelévají).
  // skulinaBotCSS = kde oblouk ZAČÍNÁ (vrchol oblouku — úzká část).
  // Posunuto blízko belt aby výška oblouku byla velká → výrazný spád od skuliny.
  const skulinaBotCSS = beltBotCSS + 4;

  // Arena = carriers oblast; arenaTopCSS je kde oblouk KONČÍ (plná šířka)
  // Vertikální rozdíl skulinaBotCSS→arenaTopCSS = výška oblouku (čím větší, tím výraznější)
  const arenaLeft   = FRAME_ARENA_PAD;
  const arenaRight  = W - FRAME_ARENA_PAD;
  const arenaTopCSS = st.carriersTopCSS != null ? st.carriersTopCSS - 4 : skulinaBotCSS + 50;
  const arenaBotCSS = (st.carriersBottomCSS || H - 30) + 20;
  const frameBotCSS = arenaBotCSS + 6;

  const params = {
    frameTopW:   wy(0),
    frameBotW:   wy(frameBotCSS),
    beltTopW:    wy(0),           // belt hole dosahuje canvas top
    beltBotW:    wy(beltBotCSS),
    beltLeft,
    beltRight,
    skulinaTopW: wy(beltBotCSS),  // skulina začíná hned pod belt
    skulinaBotW: wy(skulinaBotCSS),  // vrchol oblouku (úzká část)
    skulinaLeft,
    skulinaRight,
    arenaTopW:   wy(arenaTopCSS),    // spodek oblouku (plná šířka arény)
    arenaBotW:   wy(arenaBotCSS),
    arenaLeft,
    arenaRight,
  };

  // v73.77: REAL MASK + OUTLINE via miter offset + self-intersection clipping.
  //
  // Mask = pás konstantní šířky kolem hole (= body BG color, splývá s pozadím).
  // Outline = tenký dark rim na vnější hraně masky.
  //
  // Algoritmus:
  //   1. Build hole path (CW v Y-up)
  //   2. Sample (Bezier tessellation 30 subdivs)
  //   3. _miterOffsetPolygon(samples, BAND_WIDTH) → outer offset
  //      _clipSelfIntersections → splajzne self-intersections (bridge × arch crosses)
  //   4. Stejně pro outline (BAND_WIDTH + OUTLINE_W)
  //   5. Band Shape: outer = bandOuter reversed (CCW), hole = samples (CW)
  //      Outline Shape: outer = outlineOuter reversed, hole = bandOuter (CW)
  //   6. ShapeGeometry (flat 2D) — žádné depth artefakty
  const BAND_WIDTH  = 6;   // šířka masky
  const OUTLINE_W   = 2;   // tenkost rim

  const holePath = _buildHolePath(params);
  const innerPts = holePath.getPoints(30);

  let bandOuterPts = _miterOffsetPolygon(innerPts, BAND_WIDTH);
  bandOuterPts = _clipSelfIntersections(bandOuterPts);

  // Shape builder helper
  const _buildShape = (outerPts, holePts) => {
    const sh = new THREE.Shape();
    sh.moveTo(outerPts[0].x, outerPts[0].y);
    for (let i = 1; i < outerPts.length; i++) sh.lineTo(outerPts[i].x, outerPts[i].y);
    const h = new THREE.Path();
    h.moveTo(holePts[0].x, holePts[0].y);
    for (let i = 1; i < holePts.length; i++) h.lineTo(holePts[i].x, holePts[i].y);
    sh.holes.push(h);
    return sh;
  };

  const bandShape = _buildShape(bandOuterPts.slice().reverse(), innerPts);

  // Layered architecture (v73.85 — outline OFF):
  //   1. Band 3D (ExtrudeGeometry depth 50, BG color) — cavity walls visible přes hole
  //   2. Cover: full canvas rect s hole na bandOuter, BG color → tvoří "stůl"
  //      kolem díry. Pink stůl pak splývá s body BG mimo canvas.

  // Cover shape: full canvas rect (s mírným přesahem aby splynul s body BG),
  // hole = bandOuter. Bude pokrývat celou plochu canvasu kromě středu.
  const COVER_PAD = 30;  // overhang za canvas (přechod nezůstane vidět)
  const coverShape = new THREE.Shape();
  coverShape.moveTo(-COVER_PAD,          -COVER_PAD);
  coverShape.lineTo(W + COVER_PAD,        -COVER_PAD);
  coverShape.lineTo(W + COVER_PAD, H + COVER_PAD);
  coverShape.lineTo(-COVER_PAD,    H + COVER_PAD);
  coverShape.lineTo(-COVER_PAD,          -COVER_PAD);
  // Hole = bandOuter (CW already, perfect)
  const coverHole = new THREE.Path();
  coverHole.moveTo(bandOuterPts[0].x, bandOuterPts[0].y);
  for (let i = 1; i < bandOuterPts.length; i++) coverHole.lineTo(bandOuterPts[i].x, bandOuterPts[i].y);
  coverShape.holes.push(coverHole);

  // Band 3D s depth (drží cavity)
  const bandGeom  = new THREE.ExtrudeGeometry(bandShape, { depth: FRAME_DEPTH, bevelEnabled: false });
  // Cover FLAT
  const coverGeom = new THREE.ShapeGeometry(coverShape, 4);

  // Materials — všechno BasicMaterial, žádné shading artefakty
  const cs    = getComputedStyle(document.documentElement);
  const bgTop = (cs.getPropertyValue('--bg-3d-top') || '').trim() || '#ee9bb1';
  const bandMat  = new THREE.MeshBasicMaterial({ color: new THREE.Color(bgTop) });
  const coverMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(bgTop) });

  const bandZ  = -(FRAME_DEPTH + 2);  // Band hluboko vzadu
  const coverZ = -1;                  // Cover vepředu (zakrývá band side walls + bottom-deck bg)

  // Band: 3D extruded, hluboko vzadu, BG color → cavity walls visible přes hole
  const bandMesh = new THREE.Mesh(bandGeom, bandMat);
  bandMesh.position.set(0, 0, bandZ);
  bandMesh.renderOrder   = 1;
  bandMesh.frustumCulled = false;
  st.contentGroup.add(bandMesh);
  st.unifiedFrameMesh = bandMesh;

  // Cover: flat BG-color ring před bandem, zakrývá band's outer side walls
  const coverMesh = new THREE.Mesh(coverGeom, coverMat);
  coverMesh.position.set(0, 0, coverZ);
  coverMesh.renderOrder   = 3;
  coverMesh.frustumCulled = false;
  st.contentGroup.add(coverMesh);
  st.unifiedFrameCover = coverMesh;

  // Outline mesh úmyslně VYPNUTÉ — řešíme krok po kroku
  console.log('[render3d_bottom] layered mask (no outline) — band:', BAND_WIDTH,
    '| cover: full canvas | inner:', innerPts.length, '| band outer:', bandOuterPts.length);
}

// v73.68: minimal safe test rendering — paralelní offset jako tenká bright ring.
function _renderMiterOffsetTest(params, distance, colorHex) {
  // Build hole path z params (stejně jako v _buildUnifiedFrameGeom)
  const W = st.W;
  const hole = new THREE.Path();
  const p = params;
  hole.moveTo(p.beltLeft,     p.beltTopW);
  hole.lineTo(p.beltRight,    p.beltTopW);
  hole.lineTo(p.beltRight,    p.beltBotW);
  hole.lineTo(p.skulinaRight, p.skulinaTopW);
  hole.lineTo(p.skulinaRight, p.skulinaBotW);
  const arcW_r = p.arenaRight - p.skulinaRight;
  const arcH_r = p.skulinaBotW - p.arenaTopW;
  hole.bezierCurveTo(
    p.skulinaRight,                    p.skulinaBotW,
    p.skulinaRight + arcW_r * 0.505,  p.skulinaBotW - arcH_r * 0.130,
    p.skulinaRight + arcW_r * 0.785,  p.skulinaBotW - arcH_r * 0.411
  );
  hole.bezierCurveTo(
    p.skulinaRight + arcW_r * 0.959,  p.skulinaBotW - arcH_r * 0.637,
    p.arenaRight,                       p.arenaTopW,
    p.arenaRight,                       p.arenaTopW
  );
  hole.lineTo(p.arenaRight, p.arenaBotW + CORNER_R_BOT);
  hole.bezierCurveTo(
    p.arenaRight,                          p.arenaBotW + CORNER_R_BOT * 0.448,
    p.arenaRight - CORNER_R_BOT * 0.448,  p.arenaBotW,
    p.arenaRight - CORNER_R_BOT,           p.arenaBotW
  );
  hole.lineTo(p.arenaLeft + CORNER_R_BOT, p.arenaBotW);
  hole.bezierCurveTo(
    p.arenaLeft + CORNER_R_BOT * 0.448,   p.arenaBotW,
    p.arenaLeft,                            p.arenaBotW + CORNER_R_BOT * 0.448,
    p.arenaLeft,                            p.arenaBotW + CORNER_R_BOT
  );
  hole.lineTo(p.arenaLeft, p.arenaTopW);
  const arcW_l = p.skulinaLeft - p.arenaLeft;
  const arcH_l = p.skulinaBotW - p.arenaTopW;
  hole.bezierCurveTo(
    p.arenaLeft,                       p.arenaTopW,
    p.arenaLeft + arcW_l * 0.041,     p.arenaTopW + arcH_l * 0.363,
    p.arenaLeft + arcW_l * 0.215,     p.arenaTopW + arcH_l * 0.589
  );
  hole.bezierCurveTo(
    p.arenaLeft + arcW_l * 0.495,     p.arenaTopW + arcH_l * 0.870,
    p.skulinaLeft,                     p.skulinaBotW,
    p.skulinaLeft,                     p.skulinaBotW
  );
  hole.lineTo(p.skulinaLeft,  p.skulinaTopW);
  hole.lineTo(p.beltLeft,     p.beltBotW);
  hole.lineTo(p.beltLeft,     p.beltTopW);

  // Sample hole, offset, build thin ring shape
  const innerPts = hole.getPoints(30);
  let outerPts = _miterOffsetPolygon(innerPts, distance);
  // v73.76: clip self-intersections (cross-overs mezi non-adjacent edges)
  outerPts = _clipSelfIntersections(outerPts);

  // Shape: outer = outerPts reversed (CCW), hole = innerPts (CW)
  const ringShape = new THREE.Shape();
  const outerReversed = outerPts.slice().reverse();
  ringShape.moveTo(outerReversed[0].x, outerReversed[0].y);
  for (let i = 1; i < outerReversed.length; i++) ringShape.lineTo(outerReversed[i].x, outerReversed[i].y);
  const ringHole = new THREE.Path();
  ringHole.moveTo(innerPts[0].x, innerPts[0].y);
  for (let i = 1; i < innerPts.length; i++) ringHole.lineTo(innerPts[i].x, innerPts[i].y);
  ringShape.holes.push(ringHole);

  // Flat 2D geometry (ShapeGeometry → žádná hloubka, žádná triangulace složitosti)
  const ringGeom = new THREE.ShapeGeometry(ringShape, 4);
  const ringMat  = new THREE.MeshBasicMaterial({ color: colorHex });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  // Position v front of main frame ale za carriery
  ringMesh.position.set(0, 0, -1);
  ringMesh.renderOrder   = 50;
  ringMesh.frustumCulled = false;
  st.contentGroup.add(ringMesh);
  st.miterTestMesh = ringMesh;

  // v73.75: BLACK OUTLINE tracing přesně outer offset path — uvidíme kde se
  // linie zlomí / přeskakuje (každý bod offset polygonu = vertex v line).
  const outlineCoords = [];
  for (const pt of outerPts) outlineCoords.push(pt.x, pt.y, 0);
  outlineCoords.push(outerPts[0].x, outerPts[0].y, 0);  // close loop
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(outlineCoords, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });
  const lineMesh = new THREE.Line(lineGeom, lineMat);
  lineMesh.position.set(0, 0, -0.5);  // nad ring mesh (ke kameře)
  lineMesh.renderOrder   = 51;
  lineMesh.frustumCulled = false;
  st.contentGroup.add(lineMesh);
  st.miterTestOutline = lineMesh;
}

// v73.68: helper — proper polygon offset s miter joins (Blender Inset-style).
// v73.69: Proper polygon offset s miter joins + SELF-INTERSECTION CLIPPING.
// Algoritmus:
//   1. Pro každý segment spočítej offset přímku
//   2. Compute naivní miter v každém rohu (= intersection sousedních offset přímek)
//   3. Detect flipped runs — kde offset segment jde proti směru původního (= miters se překryly)
//   4. Pro každý flipped run najdi intersection valid prev × valid next offset line
//      → replace flipped miters jedním bodem
//
// Pojmenováno _miterOffsetPolygon aby nekolidovalo s existujícím _offsetPolygonOutward
// (wall outline, řádek ~1781, jiný algoritmus, používá se pro 3D walls).
function _miterOffsetPolygon(points, distance) {
  // 1. Build segments
  const segs = [];
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len;
    const ny =  dx / len;
    segs.push({
      offsetP1:  new THREE.Vector2(p1.x + nx * distance, p1.y + ny * distance),
      offsetP2:  new THREE.Vector2(p2.x + nx * distance, p2.y + ny * distance),
      tangentX:  dx / len,
      tangentY:  dy / len,
      corner:    new THREE.Vector2(p1.x, p1.y),  // original start corner pro miter distance check
    });
  }
  const ns = segs.length;
  if (ns === 0) return [];

  // 2. Compute corner points:
  //    - SMOOTH corners (small angle change, jako Bezier samples): use midpoint of
  //      adjacent offset endpoints → no far-miter artifact
  //    - SHARP corners (angle > ~18°): use miter intersection (line-line intersect)
  //    cos(18°) ≈ 0.95
  const SMOOTH_COS_THRESHOLD = 0.95;
  const miters = new Array(ns);
  for (let i = 0; i < ns; i++) {
    const prev = segs[(i - 1 + ns) % ns];
    const cur  = segs[i];
    const cosA = prev.tangentX * cur.tangentX + prev.tangentY * cur.tangentY;
    if (cosA > SMOOTH_COS_THRESHOLD) {
      // Smooth — offset přímky téměř paralelní, midpoint adjacent endpoints
      miters[i] = new THREE.Vector2(
        (prev.offsetP2.x + cur.offsetP1.x) / 2,
        (prev.offsetP2.y + cur.offsetP1.y) / 2
      );
    } else {
      // Sharp — line-line intersection
      miters[i] = _lineLineIntersect(prev.offsetP1, prev.offsetP2, cur.offsetP1, cur.offsetP2)
                  || cur.offsetP1.clone();
    }
  }

  // 3. Detect problematic segments:
  //    a) FLIPPED — offset segment goes proti směru original (miters překryly)
  //    b) FAR MITER — miter je dál než 3*distance od původního rohu (nearly parallel
  //       offset lines u smooth Bezier curves → intersection v "nekonečnu")
  const MITER_LIMIT_DIST = distance * 3;
  const flipped = new Array(ns).fill(false);
  for (let i = 0; i < ns; i++) {
    // 3a) Flip check
    const m1 = miters[i];
    const m2 = miters[(i + 1) % ns];
    const dot = (m2.x - m1.x) * segs[i].tangentX + (m2.y - m1.y) * segs[i].tangentY;
    if (dot < 0) { flipped[i] = true; continue; }
    // 3b) Far miter check — miters[i] vůči segs[i].corner (původní roh = start segs[i])
    const corner = segs[i].corner;
    const dCorner = Math.hypot(miters[i].x - corner.x, miters[i].y - corner.y);
    if (dCorner > MITER_LIMIT_DIST) flipped[i] = true;
  }

  // 4. Walk přes ns segments. Valid runs jdou normal, flipped runs nahradíme
  //    jedním intersection bodem mezi valid sousedy.
  // Najdi start non-flipped segmentu (aby cyklus nezačal uprostřed runu)
  let startIdx = 0;
  while (startIdx < ns && flipped[startIdx]) startIdx++;
  if (startIdx === ns) return miters;  // všechny flipped → degenerate, fallback na naive

  const result = [];
  let i = startIdx;
  do {
    if (!flipped[i]) {
      result.push(miters[i]);
      i = (i + 1) % ns;
    } else {
      // Start of flipped run. Find end.
      const runStart = i;
      let runLen = 0;
      while (flipped[i] && runLen < ns) {
        i = (i + 1) % ns;
        runLen++;
      }
      // Segs[runStart..i-1] jsou flipped (s wraparound). Najdi intersection
      // offset line předchozího valid segmentu s offset line následujícího.
      const prevValid = segs[(runStart - 1 + ns) % ns];
      const nextValid = segs[i];
      const isect = _lineLineIntersect(
        prevValid.offsetP1, prevValid.offsetP2,
        nextValid.offsetP1, nextValid.offsetP2
      );
      // Distance check — pokud intersection je MOC DALEKO (offset přímky skoro paralelní
      // jako u bridge+arch s opačnými směry), fallback na BEVEL = připoj prev endpoint na next start.
      // Tím zabráníme "ouškům" které vznikaly extrapolací na vzdálené průsečíky.
      const CLIP_LIMIT = distance * 3;
      if (isect) {
        const dEnd = Math.hypot(isect.x - prevValid.offsetP2.x, isect.y - prevValid.offsetP2.y);
        const dStart = Math.hypot(isect.x - nextValid.offsetP1.x, isect.y - nextValid.offsetP1.y);
        if (dEnd > CLIP_LIMIT || dStart > CLIP_LIMIT) {
          // Bevel — 2 body, přímá spojnice
          result.push(prevValid.offsetP2);
          result.push(nextValid.offsetP1);
        } else {
          result.push(isect);
        }
      } else {
        // Paralelní (denom = 0) — bevel
        result.push(prevValid.offsetP2);
        result.push(nextValid.offsetP1);
      }
      // Skip miters[i] — intersection/bevel becomes new corner at start of segs[i]
      i = (i + 1) % ns;
    }
  } while (i !== startIdx);

  return result;
}

function _lineLineIntersect(p1, p2, p3, p4) {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return new THREE.Vector2(p1.x + t * (p2.x - p1.x), p1.y + t * (p2.y - p1.y));
}

// v73.76: FINITE segment intersection — vrátí intersection POUZE pokud leží
// uvnitř obou segmentů (t ∈ [0,1] pro oba). Null pokud segments nekříží.
function _segSegIntersect(p1, p2, p3, p4) {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / denom;
  // Tolerance EPS na okrajích aby adjacent segments které sdílí endpoint nevyhodily false positive
  const EPS = 1e-6;
  if (t < EPS || t > 1 - EPS || u < EPS || u > 1 - EPS) return null;
  return new THREE.Vector2(p1.x + t * (p2.x - p1.x), p1.y + t * (p2.y - p1.y));
}

// v73.76: Self-intersection clipping. Pro polygon points najdi všechny dvojice
// non-adjacent edges (i, j) které se křižují uvnitř, a splice polygon — nahraď
// vnitřní loop jediným bodem v průsečíku.
function _clipSelfIntersections(points) {
  if (points.length < 4) return points;
  const n = points.length;
  const result = [];
  let i = 0;
  let iter = 0;
  while (i < n && iter < n * 2) {
    iter++;
    result.push(points[i]);
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    // Hledej intersection s nejdřív vzdálenějším future edge (greedy skip)
    let bestJ = -1;
    let bestIsect = null;
    for (let j = i + 2; j < n; j++) {
      if ((j + 1) % n === i) continue;  // last edge wraps back to start
      const p3 = points[j];
      const p4 = points[(j + 1) % n];
      const isect = _segSegIntersect(p1, p2, p3, p4);
      if (isect) {
        bestJ = j;
        bestIsect = isect;
        break;  // greedy — vezmi PRVNÍ intersection
      }
    }
    if (bestIsect) {
      result.push(bestIsect);
      i = bestJ + 1;
    } else {
      i++;
    }
  }
  return result;
}

// ─── updateCarriers ──────────────────────────────────────────────────────────
// Volá se po drawCarriers() v game.js — DOM je čerstvý, můžeme měřit pozice.
// columns: pole sloupců (game.js global)
// colorsArr: COLORS array z game.js (hex stringy)

function updateCarriers(columns, colorsArr) {
  if (!st.ready || !columns) return;

  const canvasRect = st.canvas.getBoundingClientRect();
  const gridEl = document.getElementById('carriers-grid');
  if (!gridEl) return;

  const dummy   = st._dummy;
  const c3      = st._col3;
  const cSlot   = new THREE.Color();
  let ballIdx  = 0;   // ghost mesh ball index (only ghost anim now)
  let slotIdx  = 0;   // ghost mesh slot index
  const rowSlotIdx = [0, 0, 0, 0, 0, 0, 0];  // per-row slot indices (max 7)
  const rowBallIdx = [0, 0, 0, 0, 0, 0, 0];  // per-row ball indices  (max 7)
  const rowMysteryIdx = [0, 0, 0, 0, 0, 0, 0]; // per-row mystery slot indices, v72.46

  const colDivs = gridEl.querySelectorAll('.carrier-col');

  for (let c = 0; c < colDivs.length && c < columns.length; c++) {
    const col       = columns[c];
    const slotDivs  = colDivs[c].querySelectorAll('.carrier');

    for (let r = 0; r < slotDivs.length && r < col.length; r++) {
      const slot = col[r];
      // Přeskočíme prázdné, wall, garages a rockets (renderuje CSS)
      if (!slot || slot.wall || slot.type === 'garage' || slot.type === 'rocket') continue;

      // v72.46/57: mystery (hidden) carrier — separate branch, renderuje na rowMysteryMeshes
      // s animovanou ? texturou. Skip regular slot/ball rendering.
      // Pozor: slot.hidden zůstává true napořád (data flag) — "odhalení" je pouze
      // visual když má null souseda (= active). DOM má class 'hiddenq' jen pokud
      // je NEodhalená (= !active && slot.hidden). Proto kontrolujeme DOM class.
      const isHiddenVisual = slotDivs[r].classList.contains('hiddenq');
      const mysteryKey = c + ',' + r;
      const wasHidden = st.carrierHiddenCache.get(mysteryKey) === true;
      // Detekce transition: mystery → reveal — spustíme circular-wipe shader anim
      // přes one-off Mesh (ne shrink na rowMysteryMeshes).
      if (wasHidden && !isHiddenVisual) {
        // Spočítej pozici z .cbox (nyní revealed slot)
        const cboxR = slotDivs[r].querySelector('.cbox');
        if (cboxR) {
          const crR = cboxR.getBoundingClientRect();
          const xWR = crR.left + crR.width / 2 - canvasRect.left;
          const yWR = _worldY(crR.top + crR.height / 2 - canvasRect.top);
          const dynR = crR.width / SLOT_SIZE;
          const { mat, uniforms } = _buildRevealMaterial(st._mysteryTex);
          const mesh = new THREE.Mesh(st._mysterySlotGeom, mat);
          mesh.position.set(xWR, yWR, 0);
          mesh.scale.set(dynR, dynR, dynR);
          mesh.renderOrder = 144;
          mesh.frustumCulled = false;
          st.contentGroup.add(mesh);
          st.mysteryRevealMeshes.set(mysteryKey, { mesh, mat, uniforms, t0: performance.now() });
        }
        st.mysteryRevealAnim.set(mysteryKey, performance.now());
      }
      st.carrierHiddenCache.set(mysteryKey, isHiddenVisual);
      if (isHiddenVisual) {
        const cboxHid = slotDivs[r].querySelector('.cbox-hid');
        if (!cboxHid) continue;
        const crH = cboxHid.getBoundingClientRect();
        const xCSSh = crH.left + crH.width  / 2 - canvasRect.left;
        const yCSSh = crH.top  + crH.height / 2 - canvasRect.top;
        const xWh   = xCSSh;
        const yWh   = _worldY(yCSSh);
        const dynScaleH = crH.width / SLOT_SIZE;
        const denialRotY = _computeDenialRotation(mysteryKey);  // v72.78
        const rowIdxH = Math.min(r, st.rowMysteryMeshes.length - 1);
        const myMesh = st.rowMysteryMeshes[rowIdxH];
        const myOutMesh = st.rowMysteryOutlineMeshes[rowIdxH];
        const myIdx = rowMysteryIdx[rowIdxH];
        if (myMesh && myIdx < myMesh.instanceMatrix.count) {
          dummy.position.set(xWh, yWh, 0);
          dummy.rotation.set(0, denialRotY, 0);
          dummy.scale.set(dynScaleH, dynScaleH, dynScaleH);
          dummy.updateMatrix();
          myMesh.setMatrixAt(myIdx, dummy.matrix);
          // Outline — scaled up by OUTLINE_SCALE_SLOT
          if (myOutMesh) {
            const oS = dynScaleH * OUTLINE_SCALE_SLOT;
            dummy.scale.set(oS, oS, oS);
            dummy.updateMatrix();
            myOutMesh.setMatrixAt(myIdx, dummy.matrix);
          }
          rowMysteryIdx[rowIdxH]++;
        }
        continue;
      }

      const cbox = slotDivs[r].querySelector('.cbox');
      if (!cbox) continue;

      // v72.62: reveal anim se renderuje přes one-off ShaderMaterial Mesh
      // (circular wipe) — vytvořený v transition detection (viz výše).
      // Animace uniforms + dispose probíhá v render().

      // Active vs inactive — inactive carrier je menší (scale 0.78) bez koulí.
      // Při přechodu inactive→active spustíme pop anim (overshoot scale).
      const isActive = slotDivs[r].classList.contains('active');
      const carrierKey = c + ',' + r;
      const prevActive = st.carrierActiveCache.get(carrierKey);
      // v72.63: nepouštět pop anim když transition vznikla z mystery reveal —
      // circular wipe sám stačí jako vizuální efekt, double-anim by byl rušivý.
      if (prevActive === false && isActive && !st.mysteryRevealMeshes.has(carrierKey)) {
        st.carrierPopAnim.set(carrierKey, performance.now());
      }
      st.carrierActiveCache.set(carrierKey, isActive);

      // Compute scale: inactive=0.78, active=1.0, pop anim přidává overshoot křivku
      let slotScale = isActive ? 1.0 : 0.78;
      // v72.67: pop entry žije po celou cascade duration (0.55s) — slot anim jen
      // v prvních 0.30s, zbytek je ball cascade. popT shared pro ball-loop níže.
      const POP_TOTAL = 0.55;
      const popT0 = st.carrierPopAnim.get(carrierKey);
      let popT = -1;
      if (popT0 !== undefined) {
        popT = (performance.now() - popT0) / 1000;
        if (popT >= POP_TOTAL) {
          st.carrierPopAnim.delete(carrierKey);
          popT = -1;
        } else if (popT < 0.15) {
          // Fáze 1: 0.78 → 1.15 (ease-out)
          const t = popT / 0.15;
          slotScale = 0.78 + (1.15 - 0.78) * (1 - Math.pow(1 - t, 2));
        } else if (popT < 0.30) {
          // Fáze 2: 1.15 → 1.0 (settle)
          const t = (popT - 0.15) / 0.15;
          slotScale = 1.15 - (1.15 - 1.0) * (1 - Math.pow(1 - t, 2));
        }
        // popT 0.30..0.55: slot settled at 1.0, ball cascade runs
      }

      const cr = cbox.getBoundingClientRect();
      // Střed cboxu v souřadnicích canvasu
      const xCSS = cr.left + cr.width  / 2 - canvasRect.left;
      const yCSS = cr.top  + cr.height / 2 - canvasRect.top;
      const xW   = xCSS;
      const yW   = _worldY(yCSS);

      // Responsive sizing — 3D mesh velikost = poměr DOM cbox vs SLOT_SIZE (world units).
      // Když DOM carrier zmenší (small phone, 7 rows), mesh se zmenší taky.
      // Multiplikuje slotScale (active/inactive/pop anim) zachová animační křivky.
      const dynScale = cr.width / SLOT_SIZE;
      slotScale *= dynScale;

      // Barva slotu — inactive je desaturovaný (× 0.55).
      const hexColor = colorsArr ? colorsArr[slot.color] : '#888888';
      c3.set(_hex(hexColor));
      if (!isActive) c3.multiplyScalar(0.55);
      // Slot box: lehce ztlumený (× 0.85) → koule vystupují přes outline.
      cSlot.copy(c3).multiplyScalar(0.85);

      // Z bias podle row indexu: spodní řády push forward, aby překrývaly horní řády
      // při tilt rendering (na hraně sousedních carriers depth test jinak losuje).
      // Per-row mesh: lower rows mají vyšší renderOrder → drawn last → na vrcholu.
      // Žádný Z bias potřeba — explicit layering řeší overlap.
      const rowIdx = Math.min(r, st.rowSlotMeshes.length - 1);
      const slotMesh = st.rowSlotMeshes[rowIdx];
      const slotOutMesh = st.rowSlotOutlineMeshes[rowIdx];
      const ballMesh = st.rowBallMeshes[rowIdx];
      const ballOutMesh = st.rowBallOutlineMeshes[rowIdx];

      // 3D slot container (per-row mesh)
      const slotInstIdx = rowSlotIdx[rowIdx];
      const denialRotYReg = _computeDenialRotation(carrierKey);  // v72.78
      if (slotInstIdx < slotMesh.count + slotMesh.instanceMatrix.count) {
        dummy.position.set(xW, yW, 0);
        dummy.rotation.set(0, denialRotYReg, 0);
        dummy.scale.set(slotScale, slotScale, slotScale);
        dummy.updateMatrix();
        slotMesh.setMatrixAt(slotInstIdx, dummy.matrix);
        slotMesh.setColorAt(slotInstIdx, cSlot);
        // v72.12: paralelní inner mesh — same matrix + same color, material × 0.4
        const innerMesh = st.rowSlotInnerMeshes[rowIdx];
        if (innerMesh) {
          innerMesh.setMatrixAt(slotInstIdx, dummy.matrix);
          innerMesh.setColorAt(slotInstIdx, cSlot);
        }
        const oS = slotScale * OUTLINE_SCALE_SLOT;
        dummy.scale.set(oS, oS, oS);
        dummy.updateMatrix();
        slotOutMesh.setMatrixAt(slotInstIdx, dummy.matrix);
        rowSlotIdx[rowIdx]++;
      }

      // Inactive carrier nemá koule — jen menší shell.
      if (!isActive) continue;

      // Rozložení koulí: max 4 v 2×2 mřížce uvnitř slotu (per-row mesh).
      // v71.26 fix: ofset počítaný z SLOT_SIZE (base units), ne z cr.width —
      // jinak by se násobil 2× slotScale (cr.width sám koreluje s slotScale)
      // a balls by se při shrink sbíhaly do středu kvadraticky místo lineárně.
      // Final offset = SLOT_SIZE × 0.18 × slotScale = consistent ratio k radius
      // přes všechny carrier velikosti.
      const offX = [-SLOT_SIZE * 0.195, SLOT_SIZE * 0.195];
      const offY = [-SLOT_SIZE * 0.195, SLOT_SIZE * 0.195];
      const ballZ = SLOT_DEPTH / 2 + R_CARRIER * 0.25;
      const filled = _countFilled(slot.projectiles);

      // v72.67: cascade pop — pokud popT je active, každá koule popne s offsetem.
      // Slot popne v 0..0.30s, balls follow s staggerem: ball 0 začne v 0.15s (slot peak),
      // ball 1 v 0.20s, ball 2 v 0.25s, ball 3 v 0.30s. Každá ball anim 0.20s (0 → 1.15 → 1.0).
      const BALL_FIRST_START = 0.15;
      const BALL_STAGGER = 0.05;
      const BALL_DUR = 0.20;
      let bi = 0;
      outer: for (let bRow = 0; bRow < 2; bRow++) {
        for (let col2 = 0; col2 < 2; col2++) {
          if (bi >= filled) break outer;
          const ballIdx0 = bi;  // 0-based pro cascade
          bi++;
          // Per-ball pop scale (vůči slotScale)
          let ballPopScale = 1.0;
          if (popT >= 0) {
            const ballT = popT - (BALL_FIRST_START + ballIdx0 * BALL_STAGGER);
            if (ballT < 0) {
              ballPopScale = 0;  // not yet started → invisible
            } else if (ballT < BALL_DUR / 2) {
              // Fáze 1: 0 → 1.15 (ease-out)
              const t = ballT / (BALL_DUR / 2);
              ballPopScale = 1.15 * (1 - Math.pow(1 - t, 2));
            } else if (ballT < BALL_DUR) {
              // Fáze 2: 1.15 → 1.0 (settle)
              const t = (ballT - BALL_DUR / 2) / (BALL_DUR / 2);
              ballPopScale = 1.15 - (1.15 - 1.0) * (1 - Math.pow(1 - t, 2));
            }
            // ballT >= BALL_DUR → ballPopScale = 1.0 (settled, default)
          }
          const effBallScale = slotScale * ballPopScale;
          const bIdx = rowBallIdx[rowIdx];
          dummy.position.set(xW + offX[col2] * slotScale, yW + offY[1 - bRow] * slotScale, ballZ);
          dummy.scale.set(effBallScale, effBallScale, effBallScale);
          dummy.updateMatrix();
          ballMesh.setMatrixAt(bIdx, dummy.matrix);
          ballMesh.setColorAt(bIdx, c3);
          const oB = effBallScale * OUTLINE_SCALE_BALL;
          dummy.scale.set(oB, oB, oB);
          dummy.updateMatrix();
          ballOutMesh.setMatrixAt(bIdx, dummy.matrix);
          rowBallIdx[rowIdx]++;
        }
      }
    }
  }

  // Ghost render aktivních carrier-fire animací (lift + tilt + fade)
  // Vykreslujeme PŘÍDAVNÉ instance sloty + koule pro animace, kdy slot je už null
  // (po onCarrierClick → drawCarriers vyčistilo data, ale animace ještě běží).
  if (st.carrierAnim.size > 0) {
    const now = performance.now();
    const _vec = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _slotM = new THREE.Matrix4();
    const _axisX = new THREE.Vector3(1, 0, 0);

    for (const [key, anim] of st.carrierAnim) {
      const t = (now - anim.t0) / 1000;
      if (t >= 0.65) { st.carrierAnim.delete(key); continue; }
      if (slotIdx >= MAX_CARRIER_SLOTS && ballIdx >= MAX_CARRIER_BALLS) break;

      // Lift: 0 → 1 (peak at t=0.25) → klesá zpět; ease-out
      const liftT = t < 0.25 ? (t / 0.25) : Math.max(0, 1 - (t - 0.25) / 0.40);
      const lift  = liftT * 25;   // canvas Y up px (méně Y, ghost spíš jde dopředu v Z)
      const liftZ = liftT * 45;   // Z push toward camera (ghost vystupuje dopředu místo nahoru)

      // Tilt: top of slot rotates AWAY from viewer (negative X rotation = top → -Z)
      const tiltT = t < 0.30 ? (t / 0.30) : Math.max(0, 1 - (t - 0.30) / 0.35);
      const tilt  = -tiltT * 0.55;

      // Fade: scale 1→0 v posledních 30 % animace
      const fadeT = Math.max(0, (t - 0.45) / 0.20);
      const scale = Math.max(0, 1 - fadeT);
      if (scale < 0.04) continue;

      c3.set(_hex(anim.hex));
      cSlot.copy(c3).multiplyScalar(0.85);

      const xW = anim.x;
      const yW = _worldY(anim.y - lift);

      // Z=5 = mezi slot (Z=0) a ball (Z=10) — ghost je nad ostatními slot, ale balls
      // okolo zůstávají viditelné nad ním.
      _vec.set(xW, yW, 5 + liftZ);   // Z roste s liftT → ghost vystupuje směrem ke kameře
      _quat.setFromAxisAngle(_axisX, tilt);

      // Slot
      if (slotIdx < MAX_CARRIER_SLOTS) {
        _slotM.compose(_vec, _quat, dummy.scale.set(scale, scale, scale));
        st.carrierSlotMesh.setMatrixAt(slotIdx, _slotM);
        st.carrierSlotMesh.setColorAt(slotIdx, cSlot);
        // v72.15: parallel inner ghost — same matrix + same color jako outer.
        // Bez tohoto by inner part zmizela po kliku → top face by vypadala
        // černá během fire anim lift.
        if (st.carrierSlotInnerMesh) {
          st.carrierSlotInnerMesh.setMatrixAt(slotIdx, _slotM);
          st.carrierSlotInnerMesh.setColorAt(slotIdx, cSlot);
        }
        const oS = scale * OUTLINE_SCALE_SLOT;
        const _outM = new THREE.Matrix4().compose(_vec, _quat, dummy.scale.set(oS, oS, oS));
        st.carrierSlotOutlineMesh.setMatrixAt(slotIdx, _outM);
        slotIdx++;
      }

      // Balls — naparentované ke slotu (ride se slotem během lift+tilt).
      // Fade out: scale 1 → 0 přes prvních 0.075s, pak invisible (= "vysypaly se" rychle).
      const ballFadeT = Math.max(0, Math.min(1, t / 0.075));
      const ballScale = scale * (1 - ballFadeT);
      if (ballScale > 0.04) {
        _slotM.compose(_vec, _quat, dummy.scale.set(1, 1, 1));   // matrix bez scale pro pozici
        // v71.26: SLOT_SIZE base units (sync s main path, žádné double scaling)
        const offX = [-SLOT_SIZE * 0.195, SLOT_SIZE * 0.195];
        const offY = [-SLOT_SIZE * 0.195, SLOT_SIZE * 0.195];
        const ballZ = SLOT_DEPTH / 2 + R_CARRIER * 0.25;
        let bi = 0;
        outer: for (let row = 0; row < 2; row++) {
          for (let col2 = 0; col2 < 2; col2++) {
            if (ballIdx >= MAX_CARRIER_BALLS) break outer;
            if (bi >= anim.fill) break outer;
            bi++;
            const local = new THREE.Vector3(offX[col2], offY[1 - row], ballZ);
            local.applyMatrix4(_slotM);
            dummy.position.copy(local);
            dummy.quaternion.copy(_quat);
            dummy.scale.set(ballScale, ballScale, ballScale);
            dummy.updateMatrix();
            st.carrierMesh.setMatrixAt(ballIdx, dummy.matrix);
            st.carrierMesh.setColorAt(ballIdx, c3);
            const oB = ballScale * OUTLINE_SCALE_BALL;
            dummy.scale.set(oB, oB, oB);
            dummy.updateMatrix();
            st.carrierOutlineMesh.setMatrixAt(ballIdx, dummy.matrix);
            ballIdx++;
          }
        }
      }
    }
    // Reset dummy.quaternion na identitu pro budoucí volání
    dummy.quaternion.identity();
  }

  // Per-row mesh counts
  for (let row = 0; row < st.rowSlotMeshes.length; row++) {
    const sCount = rowSlotIdx[row] || 0;
    const bCount = rowBallIdx[row] || 0;
    st.rowSlotMeshes[row].count = sCount;
    st.rowSlotMeshes[row].instanceMatrix.needsUpdate = true;
    if (st.rowSlotMeshes[row].instanceColor) st.rowSlotMeshes[row].instanceColor.needsUpdate = true;
    // v72.12: inner mesh sync s outer (paralelní rendering pro depth illusion)
    if (st.rowSlotInnerMeshes && st.rowSlotInnerMeshes[row]) {
      st.rowSlotInnerMeshes[row].count = sCount;
      st.rowSlotInnerMeshes[row].instanceMatrix.needsUpdate = true;
      if (st.rowSlotInnerMeshes[row].instanceColor) st.rowSlotInnerMeshes[row].instanceColor.needsUpdate = true;
    }
    st.rowSlotOutlineMeshes[row].count = sCount;
    st.rowSlotOutlineMeshes[row].instanceMatrix.needsUpdate = true;
    st.rowBallMeshes[row].count = bCount;
    st.rowBallMeshes[row].instanceMatrix.needsUpdate = true;
    if (st.rowBallMeshes[row].instanceColor) st.rowBallMeshes[row].instanceColor.needsUpdate = true;
    st.rowBallOutlineMeshes[row].count = bCount;
    st.rowBallOutlineMeshes[row].instanceMatrix.needsUpdate = true;
    // Mystery mesh count, v72.46 + outline v72.53
    if (st.rowMysteryMeshes && st.rowMysteryMeshes[row]) {
      const myCount = rowMysteryIdx[row] || 0;
      st.rowMysteryMeshes[row].count = myCount;
      st.rowMysteryMeshes[row].instanceMatrix.needsUpdate = true;
      if (st.rowMysteryOutlineMeshes && st.rowMysteryOutlineMeshes[row]) {
        st.rowMysteryOutlineMeshes[row].count = myCount;
        st.rowMysteryOutlineMeshes[row].instanceMatrix.needsUpdate = true;
      }
    }
  }

  // Ghost mesh counts (only for tilt anim — single legacy mesh)
  st.carrierSlotMesh.count = slotIdx;
  st.carrierSlotMesh.instanceMatrix.needsUpdate = true;
  if (st.carrierSlotMesh.instanceColor) st.carrierSlotMesh.instanceColor.needsUpdate = true;
  // v72.15: inner ghost sync (parallel s outer ghost při fire anim)
  if (st.carrierSlotInnerMesh) {
    st.carrierSlotInnerMesh.count = slotIdx;
    st.carrierSlotInnerMesh.instanceMatrix.needsUpdate = true;
    if (st.carrierSlotInnerMesh.instanceColor) st.carrierSlotInnerMesh.instanceColor.needsUpdate = true;
  }
  st.carrierSlotOutlineMesh.count = slotIdx;
  st.carrierSlotOutlineMesh.instanceMatrix.needsUpdate = true;
  st.carrierMesh.count = ballIdx;
  st.carrierMesh.instanceMatrix.needsUpdate = true;
  if (st.carrierMesh.instanceColor) st.carrierMesh.instanceColor.needsUpdate = true;
  st.carrierOutlineMesh.count = ballIdx;
  st.carrierOutlineMesh.instanceMatrix.needsUpdate = true;
}

function triggerCarrierFire(col, row, hexColor, fillCount, canvasX, canvasY, cboxW, cboxH) {
  if (!st.ready) return;
  st.carrierAnim.set(col + ',' + row, {
    t0:   performance.now(),
    hex:  hexColor,
    fill: fillCount,
    x:    canvasX,
    y:    canvasY,
    w:    cboxW,
    h:    cboxH,
  });
}

// v72.78: trigger denial shake anim (klik na inactive / mystery carrier).
function triggerCarrierDenial(col, row) {
  if (!st.ready) return;
  st.carrierDenialAnim.set(col + ',' + row, performance.now());
}

function _hasActiveCarrierAnim() {
  return (st.carrierAnim && st.carrierAnim.size > 0)
      || (st.carrierPopAnim && st.carrierPopAnim.size > 0)
      || (st.mysteryRevealMeshes && st.mysteryRevealMeshes.size > 0)
      || (st.carrierDenialAnim && st.carrierDenialAnim.size > 0);
}

// v72.78: compute Y rotation pro denial shake. Vrací { rotY, active } nebo null.
// Curve: dampened sin oscillation, amplitude 0.14 rad (~8°), 3.5 cykly přes 0.32s.
function _computeDenialRotation(carrierKey) {
  const t0 = st.carrierDenialAnim.get(carrierKey);
  if (t0 === undefined) return 0;
  const t = (performance.now() - t0) / 1000;
  const DUR = 0.32;
  if (t >= DUR) { st.carrierDenialAnim.delete(carrierKey); return 0; }
  const tt = t / DUR;
  const decay = 1 - tt;            // amplituda klesá
  const wave  = Math.sin(tt * Math.PI * 7);  // 3.5 cykly
  return 0.22 * decay * wave;
}

// Helper: převede canvasY v souřadnicích bottom3d-canvas → FUN.y
// (inverze mapování v updatePending: yCSS = TOP_CSS + (b.y - narrowY))
function canvasYtoFunY(canvasY) {
  const TOP_CSS = st.beltCenterY + R_BELT + 2;
  const NARROW_Y = (window.FUN && window.FUN.narrowY) || 14;
  return canvasY - TOP_CSS + NARROW_Y;
}

// Kolik koulí je plných (naplněno ze 40 max)
function _countFilled(projectiles) {
  const p = projectiles === undefined ? 40 : projectiles;
  // Odpovídá distributeProjectiles v game.js: 4 sloty, každý ≥ 0
  if (p <= 0)  return 0;
  if (p >= 40) return 4;
  return Math.ceil(p / 10);  // 1 koule = 10 projektilů (PPU=10)
}

// ─── updatePending ───────────────────────────────────────────────────────────
// pendingArr: game.js `pending` array, každý prvek má {x, y, r, ci}
// colorsArr:  COLORS z game.js

function updatePending(pendingArr, colorsArr) {
  if (!st.ready) return;

  const dummy = st._dummy;
  const c3    = st._col3;
  let idx = 0;

  // V 3D fyzika je rozšířená (FUN.h=360, FUN.wideY=346), aby Y rozestupy mezi
  // koulemi v rendering odpovídaly X rozestupům (1:1 scale, žádné pohyblivé mezery).
  // Mapujeme b.y → canvas Y posunem o TOP_CSS (offset, žádný násobitel).
  const FUN_NARROW_Y = (window.FUN && window.FUN.narrowY) || 14;
  const TOP_CSS      = st.beltCenterY + R_BELT + 2;     // těsně pod beltem

  for (const b of (pendingArr || [])) {
    if (idx >= MAX_PENDING) break;
    if (b.x === undefined || b.y === undefined) continue;

    const yCSS = TOP_CSS + (b.y - FUN_NARROW_Y);   // 1:1 mapping (Y v canvas = Y v fyzice)
    // V 3D mode (FUN.w=420) je b.x už v canvas coords → žádný offset.
    // V 2D fallback (FUN.w=360) je b.x v pending-canvas coords → přičti beltOffsetX.
    const xW   = (window.FUN && window.FUN.w === 420) ? b.x : (st.beltOffsetX + b.x);
    const yW   = _worldY(yCSS);

    const hexColor = colorsArr ? colorsArr[b.ci] : '#888888';
    c3.set(_hex(hexColor));

    dummy.position.set(xW, yW, R_PENDING);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    st.pendingMesh.setMatrixAt(idx, dummy.matrix);
    st.pendingMesh.setColorAt(idx, c3);
    // Outline
    dummy.scale.set(OUTLINE_SCALE_BALL, OUTLINE_SCALE_BALL, OUTLINE_SCALE_BALL);
    dummy.updateMatrix();
    st.pendingOutlineMesh.setMatrixAt(idx, dummy.matrix);
    // Shadow — disk pod koulí na "podlaze" trychtýře (canvas y těsně pod ball)
    // Velikost roste s "výškou" ball nad beltem: ball u carrieru → větší stín, u beltu → menší
    const FUN_WIDE = (window.FUN && window.FUN.wideY) || 346;
    const tHeight = Math.max(0, Math.min(1, (b.y - FUN_NARROW_Y) / (FUN_WIDE - FUN_NARROW_Y)));
    const sScale  = 0.55 + tHeight * 0.55;          // 0.55×–1.10×
    const shadowY = _worldY(yCSS + R_PENDING + 4);  // pod kouli, mírně níž v canvas Y
    dummy.position.set(xW, shadowY, 0.5);           // Z=0.5 — za belt plane (-2), před content
    dummy.scale.set(sScale, sScale * 0.45, 1);      // X full, Y zploštělý (perspektivní disk)
    dummy.updateMatrix();
    st.pendingShadowMesh.setMatrixAt(idx, dummy.matrix);
    idx++;
  }

  st.pendingMesh.count = idx;
  st.pendingMesh.instanceMatrix.needsUpdate = true;
  if (st.pendingMesh.instanceColor) st.pendingMesh.instanceColor.needsUpdate = true;
  st.pendingOutlineMesh.count = idx;
  st.pendingOutlineMesh.instanceMatrix.needsUpdate = true;
  st.pendingShadowMesh.count = idx;
  st.pendingShadowMesh.instanceMatrix.needsUpdate = true;
}

// ─── updateBelt ──────────────────────────────────────────────────────────────
// beltArr:   game.js `belt` array, každý prvek {ci, ppu, rocket?}
// beltAnim:  akumulátor z beltLoop (px, scrolluje 0→BELT_TOTAL)
// colorsArr: COLORS z game.js

function updateBelt(beltArr, beltAnim, colorsArr) {
  if (!st.ready) return;

  const dummy = st._dummy;
  const c3    = st._col3;
  let idx = 0;

  const yW     = _worldY(st.beltCenterY);
  const offset = (beltAnim || 0) % BELT_TOTAL;

  for (let i = 0; i < BELT_CAP; i++) {
    if (i >= (beltArr ? beltArr.length : 0)) break;
    const b = beltArr[i];
    if (!b) continue;

    const xCSSrel = BELT_STARTX + (i * BELT_SPACING + offset) % BELT_TOTAL;
    // Kulička mimo viditelný pás → přeskočit
    if (xCSSrel < 28 || xCSSrel > 332) continue;
    const xCSS = st.beltOffsetX + xCSSrel;

    const hexColor = colorsArr ? colorsArr[b.ci] : '#888888';
    c3.set(_hex(hexColor));

    dummy.position.set(xCSS, yW, R_BELT);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    st.beltMesh.setMatrixAt(idx, dummy.matrix);
    st.beltMesh.setColorAt(idx, c3);
    // Outline
    dummy.scale.set(OUTLINE_SCALE_BALL, OUTLINE_SCALE_BALL, OUTLINE_SCALE_BALL);
    dummy.updateMatrix();
    st.beltOutlineMesh.setMatrixAt(idx, dummy.matrix);
    idx++;
  }

  st.beltMesh.count = idx;
  st.beltMesh.instanceMatrix.needsUpdate = true;
  if (st.beltMesh.instanceColor) st.beltMesh.instanceColor.needsUpdate = true;
  st.beltOutlineMesh.count = idx;
  st.beltOutlineMesh.instanceMatrix.needsUpdate = true;
}

// ─── Render ──────────────────────────────────────────────────────────────────

function render() {
  if (!st.ready) return;
  const now = performance.now();
  // v72.49: animace mystery textury — diagonální scroll (offset.x i offset.y).
  if (st._mysteryTex) {
    if (st._mysteryLastTs !== undefined) {
      const dt = Math.min(0.1, (now - st._mysteryLastTs) / 1000);
      const speed = 0.04;
      st._mysteryTex.offset.x = (st._mysteryTex.offset.x - dt * speed) % 1;
      st._mysteryTex.offset.y = (st._mysteryTex.offset.y - dt * speed) % 1;
    }
    st._mysteryLastTs = now;
  }
  // v72.62: reveal meshes — animate uRevealT 0→1 over 0.45s, sync mapOffset s main tex,
  // dispose když anim skončí.
  if (st.mysteryRevealMeshes && st.mysteryRevealMeshes.size > 0) {
    const REVEAL_DUR = 0.45;
    const toDelete = [];
    for (const [key, entry] of st.mysteryRevealMeshes) {
      const t = (now - entry.t0) / 1000;
      if (t >= REVEAL_DUR) {
        toDelete.push(key);
        continue;
      }
      entry.uniforms.uRevealT.value = t / REVEAL_DUR;
      // Sync texture offset so glyphs keep scrolling during reveal
      if (st._mysteryTex) {
        entry.uniforms.mapOffset.value.copy(st._mysteryTex.offset);
      }
    }
    for (const key of toDelete) {
      const entry = st.mysteryRevealMeshes.get(key);
      if (entry) {
        st.contentGroup.remove(entry.mesh);
        entry.mat.dispose();
      }
      st.mysteryRevealMeshes.delete(key);
    }
  }
  st.renderer.render(st.scene, st.camera);
}

function isReady() { return st.ready; }

function dispose() {
  if (!st.scene) return;
  st.renderer.dispose();
  st.scene.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  if (st.canvas && st.canvas.parentNode) st.canvas.parentNode.removeChild(st.canvas);
  st.ready = false;
}

// ─── updateWalls (v72.19) ────────────────────────────────────────────────────
// BFS connected components + ExtrudeGeometry z polygon outline. Adjacent walls
// libovolného tvaru (L/T/+/U) se merguje do JEDNOHO mesh s true monolith
// vzhledem — žádné seams. Inflated cell rects (each ±half-gap směrem k sousedu
// v komponentě) zajistí že polygon překlene gaps mezi cells.
//
// Algoritmus:
//   1. BFS najde connected wall components (4-directional adjacency).
//   2. Pro každou komponentu: inflated cell rects (gaps included).
//   3. Boundary edges = outer edges (kde adjacent cell NENÍ v komponentě).
//   4. Trace edges in chain → polygon.
//   5. THREE.Shape z polygon → ExtrudeGeometry → Mesh.

// Posune každý vertex polygonu outward o `thickness` px po bisektoru sousedních hran.
// Trace je CW v Y-down (CSS) coords, takže outward = rotace dir o -90° (= (dy, -dx)).
// Použito pro wall outline — uniform tloušťka kolem celého obvodu (vs. scale, který
// dělá tloušťku závislou na rozměru).
function _offsetPolygonOutward(poly, thickness) {
  const n = poly.length;
  if (n < 3) return poly.slice();
  const edges = [];
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) { edges.push(null); continue; }
    const nx = dy / len;   // outward normal pro CW-in-Y-down polygon
    const ny = -dx / len;
    edges.push({
      ox: p1[0] + nx * thickness,
      oy: p1[1] + ny * thickness,
      dx, dy,
    });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const eA = edges[(i - 1 + n) % n];
    const eB = edges[i];
    if (!eA || !eB) { out.push(poly[i].slice()); continue; }
    const cross = eA.dx * eB.dy - eA.dy * eB.dx;
    if (Math.abs(cross) < 1e-6) {
      // Kolineární — použij start offsetované eB
      out.push([eB.ox, eB.oy]);
      continue;
    }
    const t = ((eB.ox - eA.ox) * eB.dy - (eB.oy - eA.oy) * eB.dx) / cross;
    out.push([eA.ox + t * eA.dx, eA.oy + t * eA.dy]);
  }
  return out;
}

// Vytvoří THREE.Shape z polygonu (pole [x, y]) s zaoblenými rohy.
// Místo lineTo do každého vertexu se použije quadraticCurveTo: kvadratická křivka
// začíná `radius` px před vertexem na předchozí hraně, kontrolní bod je samotný
// vertex, končí `radius` px za vertexem na následující hraně.
// Funguje pro convex i concave rohy (rounding směřuje "do strany" od vrcholu).
function _buildRoundedShape(polygon, radius) {
  const n = polygon.length;
  const shape = new THREE.Shape();
  if (n < 3) return shape;

  // Pro každý vertex spočítej in-point (před vertexem) a out-point (za vertexem)
  const inPts = new Array(n);
  const outPts = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];
    const dxIn = curr[0] - prev[0];
    const dyIn = curr[1] - prev[1];
    const lenIn = Math.hypot(dxIn, dyIn);
    const dxOut = next[0] - curr[0];
    const dyOut = next[1] - curr[1];
    const lenOut = Math.hypot(dxOut, dyOut);
    // Cap radius na polovinu kratší přilehlé hrany (jinak by se křivky překrývaly)
    const rIn = Math.min(radius, lenIn / 2);
    const rOut = Math.min(radius, lenOut / 2);
    inPts[i]  = lenIn  > 1e-6 ? [curr[0] - dxIn  / lenIn  * rIn,  curr[1] - dyIn  / lenIn  * rIn]  : curr.slice();
    outPts[i] = lenOut > 1e-6 ? [curr[0] + dxOut / lenOut * rOut, curr[1] + dyOut / lenOut * rOut] : curr.slice();
  }

  shape.moveTo(outPts[0][0], outPts[0][1]);
  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    shape.lineTo(inPts[nextIdx][0], inPts[nextIdx][1]);
    shape.quadraticCurveTo(polygon[nextIdx][0], polygon[nextIdx][1], outPts[nextIdx][0], outPts[nextIdx][1]);
  }
  shape.closePath();
  return shape;
}

function _findWallComponents(columns) {
  const visited = columns.map(col => (col || []).map(_ => false));
  const components = [];
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    if (!col) continue;
    for (let r = 0; r < col.length; r++) {
      if (!col[r] || col[r].wall !== true || visited[c][r]) continue;
      // BFS flood-fill
      const cells = [];
      const queue = [[c, r]];
      visited[c][r] = true;
      while (queue.length) {
        const [cc, rr] = queue.shift();
        cells.push([cc, rr]);
        const dirs = [[0,1], [0,-1], [1,0], [-1,0]];
        for (const [dc, dr] of dirs) {
          const nc = cc + dc, nr = rr + dr;
          if (nc < 0 || nc >= columns.length || !columns[nc]) continue;
          if (nr < 0 || nr >= columns[nc].length) continue;
          if (visited[nc][nr]) continue;
          if (!columns[nc][nr] || columns[nc][nr].wall !== true) continue;
          visited[nc][nr] = true;
          queue.push([nc, nr]);
        }
      }
      components.push(cells);
    }
  }
  return components;
}

function _buildComponentPolygon(cells, colDivs, halfRowGap, halfColGap) {
  // Trace v grid-coords (integer korner pozice → vždy matchují, no sub-pixel
  // bugs). Pak konvert na CSS pozice přes helper. Inside corners (concave)
  // se umístí na midpoint mezi cells — žádné gap-induced trace failures.
  const cellRects = new Map();
  for (const [c, r] of cells) {
    if (!colDivs[c]) continue;
    const slotDivs = colDivs[c].querySelectorAll('.carrier');
    if (!slotDivs[r]) continue;
    const wb = slotDivs[r].querySelector('.wall-block');
    if (!wb) continue;
    cellRects.set(c + ',' + r, { c, r, rect: wb.getBoundingClientRect() });
  }
  if (cellRects.size === 0) return null;
  const hasCell = (c, r) => cellRects.has(c + ',' + r);

  // Boundary edges v grid-coords (clockwise). Korner = grid intersection.
  // Cell (c, r) zabírá grid square (c, r) → (c+1, r+1).
  const edges = [];
  for (const [c, r] of cells) {
    if (!hasCell(c, r - 1)) edges.push({ from: [c,   r  ], to: [c+1, r  ] });   // top →
    if (!hasCell(c + 1, r)) edges.push({ from: [c+1, r  ], to: [c+1, r+1] });   // right ↓
    if (!hasCell(c, r + 1)) edges.push({ from: [c+1, r+1], to: [c,   r+1] });   // bottom ←
    if (!hasCell(c - 1, r)) edges.push({ from: [c,   r+1], to: [c,   r  ] });   // left ↑
  }
  if (edges.length === 0) return null;

  // Trace — at concave corners 2 edges meet, edgeMap picks first one added.
  // For grid coord exact match works regardless of pixel rounding.
  const k = p => p[0] + ',' + p[1];
  const edgeMap = new Map();
  for (const e of edges) edgeMap.set(k(e.from), e);
  const start = edges[0];
  const gridPoly = [start.from.slice()];
  let current = start;
  for (let i = 0; i < edges.length + 4; i++) {
    gridPoly.push(current.to.slice());
    const next = edgeMap.get(k(current.to));
    if (!next || next === start) break;
    current = next;
  }

  // Convert grid corners → CSS pozice. Pro každý korner (gc, gr) zjisti
  // pozici z okolních cells.
  // cTL = cell jejíž TL corner je zde, cTR = TR corner, cBL = BL corner, cBR = BR corner.
  // count=1 convex outer: přesný outer-corner cell.
  // count=2 edge (2 sousední cells): midpoint gapů — bridge.
  // count=3 concave inside: snap na cell-edge chybějící cell → čistý 90° roh.
  function cornerCSS(gc, gr) {
    const cTL = cellRects.get(gc + ',' + gr);
    const cTR = cellRects.get((gc-1) + ',' + gr);
    const cBL = cellRects.get(gc + ',' + (gr-1));
    const cBR = cellRects.get((gc-1) + ',' + (gr-1));
    let x, y;
    const count = [cTL, cTR, cBL, cBR].filter(Boolean).length;
    if (count === 3) {
      // Concave corner — snap na vnitřní hranu notče (opačná strana od missing cell).
      if (!cTL)      { x = cTR.rect.right;  y = cBL.rect.bottom; }
      else if (!cTR) { x = cTL.rect.left;   y = cBR.rect.bottom; }
      else if (!cBL) { x = cBR.rect.right;  y = cTL.rect.top;    }
      else           { x = cBL.rect.left;   y = cTR.rect.top;    }
    } else {
      // X
      if (cTL && cTR)      x = (cTR.rect.right + cTL.rect.left) / 2;
      else if (cBL && cBR) x = (cBR.rect.right + cBL.rect.left) / 2;
      else if (cTL || cBL) x = (cTL || cBL).rect.left;
      else if (cTR || cBR) x = (cTR || cBR).rect.right;
      else return null;
      // Y
      if (cTL && cBL)      y = (cBL.rect.bottom + cTL.rect.top) / 2;
      else if (cTR && cBR) y = (cBR.rect.bottom + cTR.rect.top) / 2;
      else if (cTL || cTR) y = (cTL || cTR).rect.top;
      else if (cBL || cBR) y = (cBL || cBR).rect.bottom;
      else return null;
    }
    return [x, y];
  }

  const cssPoly = [];
  for (const [gc, gr] of gridPoly) {
    const p = cornerCSS(gc, gr);
    if (!p) continue;
    cssPoly.push(p);
  }
  // Trace končí duplikem start-vertexu ([A,B,C,A]) — dedup, jinak offset polygon
  // má zero-length edge na konci a první vertex se neoffsetne (tenký šev).
  while (cssPoly.length >= 2) {
    const a = cssPoly[0], b = cssPoly[cssPoly.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5) {
      cssPoly.pop();
    } else {
      break;
    }
  }
  if (cssPoly.length < 3) return null;
  return cssPoly;
}

function _disposeWallMeshes() {
  for (const m of st.wallMeshes) {
    if (st._wallContentGroup) st._wallContentGroup.remove(m);
    if (m.geometry) m.geometry.dispose();
  }
  for (const m of st.wallOutlineMeshes) {
    if (st._wallContentGroup) st._wallContentGroup.remove(m);
    if (m.geometry) m.geometry.dispose();
  }
  st.wallMeshes.length = 0;
  st.wallOutlineMeshes.length = 0;
}

function updateWalls(columns) {
  if (!st.ready || !st._wallMat) return;
  // Theme color match — read --carriers-3d-bg z aktuálního theme
  const cs = getComputedStyle(document.body);
  const bgColor = (cs.getPropertyValue('--carriers-3d-bg') || '').trim() || '#6a2f4d';
  // Wall barva = bgColor lightened ~+8 % HSL lightness — wall mírně vyniká z bg.
  const wallCol = new THREE.Color(bgColor);
  const hsl = { h: 0, s: 0, l: 0 };
  wallCol.getHSL(hsl);
  wallCol.setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.02));
  st._wallMat.color.copy(wallCol);
  // Outline barva = wall color × ~0.38 — lehce tmavší než nejtmavší toon band (0.47)
  // pro jemné oddělení od bg, ale ne kontrastně černá.
  st._wallOutlineMat.color.copy(wallCol).multiplyScalar(0.38);
  const rowGap = parseFloat(cs.getPropertyValue('--row-gap')) || 6;
  const colGap = 4;  // viz #carriers-grid gap v CSS

  _disposeWallMeshes();

  const gridEl = document.getElementById('carriers-grid');
  if (!gridEl) return;
  const canvasRect = st.canvas.getBoundingClientRect();
  const colDivs = gridEl.querySelectorAll('.carrier-col');

  const components = _findWallComponents(columns);
  if (components.length === 0) return;

  for (const cells of components) {
    const polygon = _buildComponentPolygon(cells, colDivs, rowGap / 2, colGap / 2);
    if (!polygon || polygon.length < 3) continue;

    // Polygon je v CSS coords (Y down). Convert na shape-local (centered, Y flipped pro Three.js Y up).
    let cx = 0, cy = 0;
    for (const p of polygon) { cx += p[0]; cy += p[1]; }
    cx /= polygon.length;
    cy /= polygon.length;

    // Konvert polygon na shape-local coords (centered, Y flipped pro Three.js Y up)
    const shapePoly = polygon.map(p => [p[0] - cx, -(p[1] - cy)]);
    const shape = _buildRoundedShape(shapePoly, WALL_CORNER_RADIUS);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: WALL_DEPTH,
      bevelEnabled: true,
      bevelThickness: WALL_BEVEL,
      bevelSize: WALL_BEVEL,
      bevelSegments: WALL_BEVEL_SEGS,
      curveSegments: 4,
    });
    // Center mesh v Z (default ExtrudeGeometry extruduje z=0..depth)
    geo.translate(0, 0, -WALL_DEPTH / 2);

    // Mesh position v scene = polygon center v world coords
    const xCSS = cx - canvasRect.left;
    const yCSS = cy - canvasRect.top;
    const xW = xCSS;
    const yW = _worldY(yCSS);

    const mesh = new THREE.Mesh(geo, st._wallMat);
    mesh.position.set(xW, yW, 0);
    mesh.renderOrder = 130;
    mesh.frustumCulled = false;
    st._wallContentGroup.add(mesh);
    st.wallMeshes.push(mesh);

    // Outline: pevná tloušťka (WALL_OUTLINE_PX) — polygon offset outward po normálách,
    // ne scale. Scale dělá tloušťku závislou na rozměru (široká strana = tlustší outline);
    // polygon offset dává uniformní tloušťku po celém obvodu.
    const offsetPoly = _offsetPolygonOutward(polygon, WALL_OUTLINE_PX);
    const outShapePoly = offsetPoly.map(p => [p[0] - cx, -(p[1] - cy)]);
    // Outline corner radius = wall radius + outline thickness, aby outer křivka outlinu
    // byla koncentrická s wall křivkou (jinak outline na rohu vypadá moc tlustý/tenký).
    const outShape = _buildRoundedShape(outShapePoly, WALL_CORNER_RADIUS + WALL_OUTLINE_PX);
    const outGeo = new THREE.ExtrudeGeometry(outShape, {
      depth: WALL_DEPTH + 2 * WALL_OUTLINE_PX,
      bevelEnabled: true,
      bevelThickness: WALL_BEVEL,
      bevelSize: WALL_BEVEL,
      bevelSegments: WALL_BEVEL_SEGS,
      curveSegments: 4,
    });
    outGeo.translate(0, 0, -(WALL_DEPTH + 2 * WALL_OUTLINE_PX) / 2);
    const outMesh = new THREE.Mesh(outGeo, st._wallOutlineMat);
    outMesh.position.set(xW, yW, 0);
    outMesh.renderOrder = 129;
    outMesh.frustumCulled = false;
    st._wallContentGroup.add(outMesh);
    st.wallOutlineMeshes.push(outMesh);
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

// v72.74: re-měření layoutu + canvas/renderer/camera resize. Voláno z game.js
// při level switchi nebo viewport resize, kde se může změnit výška decku
// (nový level s víc řadami = vyšší deck). Bez resize by se bottom rows renderovaly
// MIMO canvas (clipped).
function resize() {
  if (!st.ready || !st.canvas) return;
  const gameEl   = document.getElementById('game');
  const beltWrap = document.getElementById('belt-wrap');
  if (!gameEl || !beltWrap) return;
  const gameRect = gameEl.getBoundingClientRect();
  const beltRect = beltWrap.getBoundingClientRect();
  const bottomEl = document.getElementById('bottom-deck') ||
                   document.getElementById('carriers-wrap');
  const bottomRect = bottomEl ? bottomEl.getBoundingClientRect() : beltRect;
  const carrEl     = document.getElementById('carriers-wrap');
  const pendWrapEl = document.getElementById('pending-wrap');
  let widestRect = beltRect;
  if (carrEl && carrEl.getBoundingClientRect().width > widestRect.width) widestRect = carrEl.getBoundingClientRect();
  if (pendWrapEl && pendWrapEl.getBoundingClientRect().width > widestRect.width) widestRect = pendWrapEl.getBoundingClientRect();
  const W = Math.ceil(widestRect.width);
  const H = Math.max(180, Math.ceil(bottomRect.bottom - beltRect.top) + 90);
  if (W === st.W && H === st.H) return;
  st.W = W;
  st.H = H;
  st.canvas.width  = W;
  st.canvas.height = H;
  st.canvas.style.width  = W + 'px';
  st.canvas.style.height = H + 'px';
  if (st.renderer) st.renderer.setSize(W, H, false);
  if (st.camera) {
    st.camera.left   = 0;
    st.camera.right  = W;
    st.camera.top    = H;
    st.camera.bottom = 0;
    st.camera.updateProjectionMatrix();
  }
  if (st.pivot) st.pivot.position.set(W / 2, H / 2, 0);
  if (st.contentGroup) st.contentGroup.position.set(-W / 2, -H / 2, 0);
  // Update measured position refs (used by updateBelt / updatePending / canvasYtoFunY)
  const canvasTop = Math.round(beltRect.top - gameRect.top);
  const beltSvgEl = document.getElementById('belt-svg');
  const pendEl    = document.getElementById('pending-canvas');
  if (beltSvgEl) {
    const r = beltSvgEl.getBoundingClientRect();
    const offY = Math.round(r.top - gameRect.top) - canvasTop;
    st.beltCenterY = offY + Math.round(r.height / 2);
  }
  if (pendEl) {
    const r = pendEl.getBoundingClientRect();
    st.pendingTopCSS = Math.round(r.top - gameRect.top) - canvasTop;
  }
  if (carrEl) {
    const cR = carrEl.getBoundingClientRect();
    st.carriersTopCSS    = Math.round(cR.top    - gameRect.top) - canvasTop;
    st.carriersBottomCSS = Math.round(cR.bottom - gameRect.top) - canvasTop;
  }
}

// v72.68: clear per-carrier caches + animace — voláno z game.js startLevel, aby
// se carriery nového levelu nedetekovaly jako transition z předchozího levelu
// (falešné pop animace na startu levelu).
function clearCarrierState() {
  if (st.carrierActiveCache) st.carrierActiveCache.clear();
  if (st.carrierHiddenCache) st.carrierHiddenCache.clear();
  if (st.carrierPopAnim) st.carrierPopAnim.clear();
  if (st.carrierDenialAnim) st.carrierDenialAnim.clear();   // v72.78
  if (st.mysteryRevealAnim) st.mysteryRevealAnim.clear();
  if (st.mysteryRevealMeshes) {
    for (const [, entry] of st.mysteryRevealMeshes) {
      if (st.contentGroup && entry.mesh) st.contentGroup.remove(entry.mesh);
      if (entry.mat) entry.mat.dispose();
    }
    st.mysteryRevealMeshes.clear();
  }
}

window.render3dBottom = { init, updateCarriers, updateWalls, updatePending, updateBelt, triggerCarrierFire, triggerCarrierDenial, _hasActiveCarrierAnim, canvasYtoFunY, render, isReady, dispose, clearCarrierState, resize };
window._r3dBState = st;  // debug

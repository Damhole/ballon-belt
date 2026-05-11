// render3d_bottom.js — Three.js render layer pro bottom area (belt + pending + carriers)
// Jeden WebGL canvas pokrývá celou oblast pod image-area: belt-wrap + pending-wrap + carriers-wrap.
// Canvas je absolutně pozicovaný nad DOM (z-index:2, pointer-events:none) takže DOM carrier divy
// zůstávají jako transparentní click targets.
// API vystaveno přes window.render3dBottom = { init, updateCarriers, updatePending, updateBelt, render, isReady, dispose }

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─── Konstanty (musí odpovídat game.js) ──────────────────────────────────────
const BELT_SVG_H      = 64;    // výška #belt-svg viewBox
const PENDING_CANVAS_H = 90;   // výška #pending-canvas
const BELT_CAP        = 14;    // max balls na pásu
const BELT_STARTX     = 50;    // BELT_LX + BELT_BALL_R + 8
const BELT_ENDX       = 310;   // BELT_RX - BELT_BALL_R - 8
const BELT_SPACING    = (BELT_ENDX - BELT_STARTX) / (BELT_CAP - 1); // ~20
const BELT_TOTAL      = BELT_CAP * BELT_SPACING;                     // ~280
const BELT_CENTER_CSS_Y = 32;  // (trackY1+trackY2)/2 = (18+46)/2

// Poloměry koulí (3D) — sjednoceno, aby koule v carriers/trychtýři/belt měly stejnou velikost
const R_CARRIER = 12;
const R_PENDING = 12;
const R_BELT    = 12;

// Carrier slot rounded-box geometry parametry
const SLOT_SIZE       = 50;   // CSS px — vnitřní velikost krabičky
const SLOT_RADIUS     = 9;    // zaoblení rohů
const SLOT_DEPTH      = 14;   // hloubka krabičky (Z)
const SLOT_BEVEL      = 1.6;  // bevel pro hladké hrany

// Outline (inverted-hull technique) — scale faktor pro outline mesh
const OUTLINE_SCALE_BALL = 1.13;  // koule outline 13 %
const OUTLINE_SCALE_SLOT = 1.07;  // slot outline 7 %
const OUTLINE_COLOR      = 0x000000;  // čistá černá (cartoon look)

// Tilt — stejný úhel jako render3d.js image area pro vizuální konzistenci
const TILT_DEG = 19.2;
const TILT_RAD = TILT_DEG * Math.PI / 180;

const MAX_CARRIER_BALLS = 300;
const MAX_CARRIER_SLOTS = 80;
const MAX_PENDING       = 30;

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
  const H = Math.max(180, Math.ceil(bottomRect.bottom - beltRect.top) + 10);

  st.W = W;
  st.H = H;

  // Canvas pozice relativně k #game divu
  const canvasTop  = Math.round(beltRect.top  - gameRect.top);
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
    `top:${canvasTop}px`,
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

  // Carrier slot rounded boxes (3D containery pro koule)
  const slotGeom = _roundedBoxGeom(SLOT_SIZE, SLOT_SIZE, SLOT_RADIUS, SLOT_DEPTH, SLOT_BEVEL);
  const slotMat  = new THREE.MeshToonMaterial({ gradientMap: toonGrad });

  // Helper: vytvoří outline InstancedMesh pro danou geometrii a max počet instancí
  const mkOutline = (geom, max) => {
    const m = new THREE.InstancedMesh(geom, _outlineMat(), max);
    m.count = 0;
    m.renderOrder = -1;  // outline se kreslí PŘED main mesh (BackSide+depth = silueta)
    m.frustumCulled = false;  // InstancedMesh per-instance positions přesahují geometry boundingSphere
    return m;
  };

  // ─── Carrier slots (3D rounded boxes) ───
  st.carrierSlotMesh = new THREE.InstancedMesh(slotGeom, slotMat, MAX_CARRIER_SLOTS);
  st.carrierSlotMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIER_SLOTS * 3), 3);
  st.carrierSlotMesh.count = 0;
  st.carrierSlotMesh.frustumCulled = false;
  contentGroup.add(st.carrierSlotMesh);
  st.carrierSlotOutlineMesh = mkOutline(slotGeom, MAX_CARRIER_SLOTS);
  contentGroup.add(st.carrierSlotOutlineMesh);

  // Hot-swap slot geometry s GLB assetem (async — placeholder rendered do té doby).
  // Asset z Blenderu má 1m × 1m × 0.28m → scale 50× sjednotí na náš SLOT_SIZE.
  new GLTFLoader().load('./assets/3d/carrier.glb', (gltf) => {
    let glbGeom = null;
    gltf.scene.traverse(obj => { if (obj.isMesh && !glbGeom) glbGeom = obj.geometry.clone(); });
    if (!glbGeom) { console.warn('[render3d_bottom] GLB nemá mesh'); return; }
    // Asset je exportován s +Z up (= Blender axes preserved), takže Blender Z
    // (= top face nahoru) odpovídá glTF Z (= top face k divákovi v naší scéně).
    // Žádná rotace v kódu nepotřeba — drop-and-go workflow.
    glbGeom.scale(50, 50, 50);
    // Center geometrie (kdyby origin nebyl uprostřed)
    glbGeom.computeBoundingBox();
    const bb = glbGeom.boundingBox;
    glbGeom.translate(-(bb.min.x+bb.max.x)/2, -(bb.min.y+bb.max.y)/2, -(bb.min.z+bb.max.z)/2);
    glbGeom.computeBoundingSphere();
    // Hot-swap
    const oldMain = st.carrierSlotMesh.geometry;
    const oldOutline = st.carrierSlotOutlineMesh.geometry;
    st.carrierSlotMesh.geometry = glbGeom;
    st.carrierSlotOutlineMesh.geometry = glbGeom;
    if (oldMain && oldMain !== oldOutline) oldMain.dispose();
    if (oldOutline) oldOutline.dispose();
    console.log('[render3d_bottom] carrier.glb loaded, bbox after scale:', bb);
  }, undefined, (err) => {
    console.warn('[render3d_bottom] carrier.glb load failed, keep placeholder:', err);
  });

  // ─── Carrier balls ───
  st.carrierMesh = new THREE.InstancedMesh(carrierGeom, ballMat(), MAX_CARRIER_BALLS);
  st.carrierMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIER_BALLS * 3), 3);
  st.carrierMesh.count = 0;
  st.carrierMesh.frustumCulled = false;
  contentGroup.add(st.carrierMesh);
  st.carrierOutlineMesh = mkOutline(carrierGeom, MAX_CARRIER_BALLS);
  contentGroup.add(st.carrierOutlineMesh);

  // ─── Pending balls ───
  st.pendingMesh = new THREE.InstancedMesh(pendingGeom, ballMat(), MAX_PENDING);
  st.pendingMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PENDING * 3), 3);
  st.pendingMesh.count = 0;
  st.pendingMesh.frustumCulled = false;
  st.pendingMesh.renderOrder = 5;  // vrchol nad slot/carriery
  contentGroup.add(st.pendingMesh);
  st.pendingOutlineMesh = mkOutline(pendingGeom, MAX_PENDING);
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
  let ballIdx  = 0;
  let slotIdx  = 0;

  const colDivs = gridEl.querySelectorAll('.carrier-col');

  for (let c = 0; c < colDivs.length && c < columns.length; c++) {
    const col       = columns[c];
    const slotDivs  = colDivs[c].querySelectorAll('.carrier');

    for (let r = 0; r < slotDivs.length && r < col.length; r++) {
      const slot = col[r];
      // Přeskočíme prázdné, wall, garages a rockets (renderuje CSS)
      if (!slot || slot.wall || slot.type === 'garage' || slot.type === 'rocket') continue;

      const cbox = slotDivs[r].querySelector('.cbox');
      if (!cbox) continue;

      // Active vs inactive — inactive carrier je menší (scale 0.78) bez koulí.
      // Při přechodu inactive→active spustíme pop anim (overshoot scale).
      const isActive = slotDivs[r].classList.contains('active');
      const carrierKey = c + ',' + r;
      const prevActive = st.carrierActiveCache.get(carrierKey);
      if (prevActive === false && isActive) {
        st.carrierPopAnim.set(carrierKey, performance.now());
      }
      st.carrierActiveCache.set(carrierKey, isActive);

      // Compute scale: inactive=0.78, active=1.0, pop anim přidává overshoot křivku
      let slotScale = isActive ? 1.0 : 0.78;
      const popT0 = st.carrierPopAnim.get(carrierKey);
      if (popT0 !== undefined) {
        const popT = (performance.now() - popT0) / 1000;
        if (popT >= 0.30) {
          st.carrierPopAnim.delete(carrierKey);
        } else if (popT < 0.15) {
          // Fáze 1: 0.78 → 1.15 (ease-out)
          const t = popT / 0.15;
          slotScale = 0.78 + (1.15 - 0.78) * (1 - Math.pow(1 - t, 2));
        } else {
          // Fáze 2: 1.15 → 1.0 (settle)
          const t = (popT - 0.15) / 0.15;
          slotScale = 1.15 - (1.15 - 1.0) * (1 - Math.pow(1 - t, 2));
        }
      }

      const cr = cbox.getBoundingClientRect();
      // Střed cboxu v souřadnicích canvasu
      const xCSS = cr.left + cr.width  / 2 - canvasRect.left;
      const yCSS = cr.top  + cr.height / 2 - canvasRect.top;
      const xW   = xCSS;
      const yW   = _worldY(yCSS);

      // Barva slotu — inactive je desaturovaný (× 0.55).
      const hexColor = colorsArr ? colorsArr[slot.color] : '#888888';
      c3.set(_hex(hexColor));
      if (!isActive) c3.multiplyScalar(0.55);
      // Slot box: lehce ztlumený (× 0.85) → koule vystupují přes outline.
      cSlot.copy(c3).multiplyScalar(0.85);

      // Z bias podle row indexu: spodní řády push forward, aby překrývaly horní řády
      // při tilt rendering (na hraně sousedních carriers depth test jinak losuje).
      // Row Z bias: lower rows posunuté víc dopředu, aby fyzicky nekolidovali
      // s carrier řadou nad sebou. Carrier má depth 14 (Z range ±7), takže bias
      // musí být > 14 mezi sousedními řadami.
      const rowZBias = r * 20;

      // 3D rounded-box slot container (jen pokud máme ještě prostor)
      if (slotIdx < MAX_CARRIER_SLOTS) {
        // Slot vystředěný v Z=rowZBias; horní face je Z = SLOT_DEPTH/2 + rowZBias
        dummy.position.set(xW, yW, rowZBias);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(slotScale, slotScale, slotScale);
        dummy.updateMatrix();
        st.carrierSlotMesh.setMatrixAt(slotIdx, dummy.matrix);
        st.carrierSlotMesh.setColorAt(slotIdx, cSlot);
        // Outline (slightly larger)
        const oS = slotScale * OUTLINE_SCALE_SLOT;
        dummy.scale.set(oS, oS, oS);
        dummy.updateMatrix();
        st.carrierSlotOutlineMesh.setMatrixAt(slotIdx, dummy.matrix);
        slotIdx++;
      }

      // Inactive carrier nemá koule — jen menší shell.
      if (!isActive) continue;

      // Rozložení koulí: max 4 v 2×2 mřížce uvnitř slotu
      // Posuneme koule z trochu nad horní face slotu (Z = SLOT_DEPTH/2 + R_CARRIER*0.2)
      // → koule částečně zapuštěné, ale dobře viditelné
      const cw   = cr.width;
      const ch   = cr.height;
      const offX = [-cw * 0.21, cw * 0.21];
      const offY = [-ch * 0.21, ch * 0.21];
      const ballZ = SLOT_DEPTH / 2 + R_CARRIER * 0.25;
      const filled = _countFilled(slot.projectiles);

      let bi = 0;
      outer: for (let row = 0; row < 2; row++) {
        for (let col2 = 0; col2 < 2; col2++) {
          if (ballIdx >= MAX_CARRIER_BALLS) break outer;
          if (bi >= filled) break outer;
          bi++;

          dummy.position.set(xW + offX[col2] * slotScale, yW + offY[1 - row] * slotScale, ballZ + rowZBias);
          dummy.scale.set(slotScale, slotScale, slotScale);
          dummy.updateMatrix();
          st.carrierMesh.setMatrixAt(ballIdx, dummy.matrix);
          st.carrierMesh.setColorAt(ballIdx, c3);
          // Outline
          const oB = slotScale * OUTLINE_SCALE_BALL;
          dummy.scale.set(oB, oB, oB);
          dummy.updateMatrix();
          st.carrierOutlineMesh.setMatrixAt(ballIdx, dummy.matrix);
          ballIdx++;
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
      const lift  = liftT * 55;   // canvas Y up px (vyšší aby unikl carriers řadě před ním)

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
      _vec.set(xW, yW, 5);
      _quat.setFromAxisAngle(_axisX, tilt);

      // Slot
      if (slotIdx < MAX_CARRIER_SLOTS) {
        _slotM.compose(_vec, _quat, dummy.scale.set(scale, scale, scale));
        st.carrierSlotMesh.setMatrixAt(slotIdx, _slotM);
        st.carrierSlotMesh.setColorAt(slotIdx, cSlot);
        const oS = scale * OUTLINE_SCALE_SLOT;
        const _outM = new THREE.Matrix4().compose(_vec, _quat, dummy.scale.set(oS, oS, oS));
        st.carrierSlotOutlineMesh.setMatrixAt(slotIdx, _outM);
        slotIdx++;
      }

      // Balls (s aplikovaným slot transform — koule "ride" se slotem)
      _slotM.compose(_vec, _quat, dummy.scale.set(1, 1, 1));   // matrix bez scale pro pozici
      const offX = [-anim.w * 0.21, anim.w * 0.21];
      const offY = [-anim.h * 0.21, anim.h * 0.21];
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
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          st.carrierMesh.setMatrixAt(ballIdx, dummy.matrix);
          st.carrierMesh.setColorAt(ballIdx, c3);
          const oB = scale * OUTLINE_SCALE_BALL;
          dummy.scale.set(oB, oB, oB);
          dummy.updateMatrix();
          st.carrierOutlineMesh.setMatrixAt(ballIdx, dummy.matrix);
          ballIdx++;
        }
      }
    }
    // Reset dummy.quaternion na identitu pro budoucí volání
    dummy.quaternion.identity();
  }

  st.carrierSlotMesh.count = slotIdx;
  st.carrierSlotMesh.instanceMatrix.needsUpdate = true;
  if (st.carrierSlotMesh.instanceColor) st.carrierSlotMesh.instanceColor.needsUpdate = true;
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

function _hasActiveCarrierAnim() {
  return (st.carrierAnim && st.carrierAnim.size > 0) || (st.carrierPopAnim && st.carrierPopAnim.size > 0);
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

// ─── Export ──────────────────────────────────────────────────────────────────

window.render3dBottom = { init, updateCarriers, updatePending, updateBelt, triggerCarrierFire, _hasActiveCarrierAnim, canvasYtoFunY, render, isReady, dispose };
window._r3dBState = st;  // debug

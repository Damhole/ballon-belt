// render3d_bottom.js — Three.js render layer pro bottom area (belt + pending + carriers)
// Jeden WebGL canvas pokrývá celou oblast pod image-area: belt-wrap + pending-wrap + carriers-wrap.
// Canvas je absolutně pozicovaný nad DOM (z-index:2, pointer-events:none) takže DOM carrier divy
// zůstávají jako transparentní click targets.
// API vystaveno přes window.render3dBottom = { init, updateCarriers, updatePending, updateBelt, render, isReady, dispose }

import * as THREE from 'three';

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
    st.carriersTopCSS = Math.round(carrEl.getBoundingClientRect().top - gameRect.top) - canvasTop;
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
  contentGroup.add(st.pendingMesh);
  st.pendingOutlineMesh = mkOutline(pendingGeom, MAX_PENDING);
  contentGroup.add(st.pendingOutlineMesh);

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

      const cr = cbox.getBoundingClientRect();
      // Střed cboxu v souřadnicích canvasu
      const xCSS = cr.left + cr.width  / 2 - canvasRect.left;
      const yCSS = cr.top  + cr.height / 2 - canvasRect.top;
      const xW   = xCSS;
      const yW   = _worldY(yCSS);

      // Barva slotu (koule mají tutéž barvu) — čistá barva, žádné liftování.
      // Černá = černá jako pixely v image-area. Outline + tilt drží 3D čitelnost.
      const hexColor = colorsArr ? colorsArr[slot.color] : '#888888';
      c3.set(_hex(hexColor));
      // Slot box: lehce ztlumený (× 0.85) → koule vystupují přes outline.
      cSlot.copy(c3).multiplyScalar(0.85);

      // 3D rounded-box slot container (jen pokud máme ještě prostor)
      if (slotIdx < MAX_CARRIER_SLOTS) {
        // Slot vystředěný v Z=0; horní face je Z = SLOT_DEPTH/2
        dummy.position.set(xW, yW, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        st.carrierSlotMesh.setMatrixAt(slotIdx, dummy.matrix);
        st.carrierSlotMesh.setColorAt(slotIdx, cSlot);
        // Outline (slightly larger)
        dummy.scale.set(OUTLINE_SCALE_SLOT, OUTLINE_SCALE_SLOT, OUTLINE_SCALE_SLOT);
        dummy.updateMatrix();
        st.carrierSlotOutlineMesh.setMatrixAt(slotIdx, dummy.matrix);
        slotIdx++;
      }

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

          dummy.position.set(xW + offX[col2], yW + offY[1 - row], ballZ);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          st.carrierMesh.setMatrixAt(ballIdx, dummy.matrix);
          st.carrierMesh.setColorAt(ballIdx, c3);
          // Outline
          dummy.scale.set(OUTLINE_SCALE_BALL, OUTLINE_SCALE_BALL, OUTLINE_SCALE_BALL);
          dummy.updateMatrix();
          st.carrierOutlineMesh.setMatrixAt(ballIdx, dummy.matrix);
          ballIdx++;
        }
      }
    }
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

  // pending[i].x, pending[i].y jsou v FUN coords (pending-canvas 360×90),
  // kde b.y=14 = úzký konec u beltu, b.y=82 = široký konec u carriers.
  // V 3D mapujeme b.y do ROZŠÍŘENÉHO range (od beltu až do horní řady carriers),
  // aby koule byly vidět "vypadávat z carrieru" (ne z nějaké linie trychtýře).
  const FUN_NARROW_Y = 14;
  const FUN_WIDE_Y   = 82;
  const FUN_RANGE    = FUN_WIDE_Y - FUN_NARROW_Y;
  const TOP_CSS      = st.beltCenterY + R_BELT + 2;     // těsně pod beltem
  const BOTTOM_CSS   = st.carriersTopCSS + 70;          // hluboko v 1.–2. řadě carriers
  const RANGE_CSS    = BOTTOM_CSS - TOP_CSS;

  for (const b of (pendingArr || [])) {
    if (idx >= MAX_PENDING) break;
    if (b.x === undefined || b.y === undefined) continue;

    const t   = (b.y - FUN_NARROW_Y) / FUN_RANGE;       // 0 (u beltu) … 1 (u carrieru)
    const yCSS = TOP_CSS + t * RANGE_CSS;
    const xW   = st.beltOffsetX + b.x;
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
    idx++;
  }

  st.pendingMesh.count = idx;
  st.pendingMesh.instanceMatrix.needsUpdate = true;
  if (st.pendingMesh.instanceColor) st.pendingMesh.instanceColor.needsUpdate = true;
  st.pendingOutlineMesh.count = idx;
  st.pendingOutlineMesh.instanceMatrix.needsUpdate = true;
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

window.render3dBottom = { init, updateCarriers, updatePending, updateBelt, render, isReady, dispose };

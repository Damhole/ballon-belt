// v74.80: UNIFIED 3D ORCHESTRATOR — sloučení dvou WebGL kontextů do jednoho.
// Vytváří JEDEN sdílený WebGLRenderer + Scene + OrthographicCamera ve world space =
// CSS-pixel prostor #game (Y-up, flipnuté). Top (image area, render3d.js) i bottom
// (belt/carriers, render3d_bottom.js) region se reparentují jako "placement group"
// subtree do téhle jedné scény. Jeden kontext, jeden render pass, jeden sdílený rig.
//
// Tilt (-19.2°) je v obou modulech transformace GRUPY (tiltGroup.rotation.x), ne kamery —
// obě kamery byly prosté top-down ortho. Proto stačí každou content-hierarchii (pivot)
// "přemístit" (translate + scale) do jednoho světa; vnitřní matematika zůstává beze změny.
// Bottom canvas (#bottom3d-canvas) zůstává jako transparentní "ghost" — měřící reference
// pro getBoundingClientRect (carrier alignment), bez vlastního WebGL kontextu.
import * as THREE from 'three';

if (typeof window !== 'undefined') window.BB_VERSION_UNIFIED = 'v74.80';

const U = {
  ready: false,
  renderer: null,
  scene: null,
  camera: null,
  canvas: null,
  gameEl: null,
  mountTop: null,
  mountBottom: null,
  gameW: 0,
  gameH: 0,
};

function _dpr() { return Math.min(window.devicePixelRatio || 1, 2); }

// Namapuje modul-lokální frustum (x∈[fl,fr], y∈[fbot,ftop], y-up) na screen rect
// (left/top/w/h RELATIVNĚ k #game) uvnitř unified y-up světa.
//   worldX = mount.pos.x + sx*localX  musí = screenLeft + (localX - fl)*sx
//   worldY = mount.pos.y + sy*localY  musí = (gameH - screenTop - screenH) + (localY - fbot)*sy
function _placeMountFrustum(mount, sl, st, sw, sh, fl, fr, fbot, ftop) {
  const sx = sw / (fr - fl);
  const sy = sh / (ftop - fbot);
  mount.scale.set(sx, sy, sx);
  mount.position.set(sl - fl * sx, U.gameH - st - sh - fbot * sy, 0);
}
// Vystaveno pro bottom modul (Stage B), aby si umístil svůj mount sám.
U.placeMountFrustum = _placeMountFrustum;

function _ensureCanvas() {
  if (U.canvas) return true;
  const gameEl = document.getElementById('game');
  if (!gameEl) return false;
  U.gameEl = gameEl;
  if (getComputedStyle(gameEl).position === 'static') gameEl.style.position = 'relative';

  const cv = document.createElement('canvas');
  cv.id = 'bb-unified-canvas';
  // Pozn.: rozměry (style.width/height) nastavuje layout() přes renderer.setSize(...true),
  // ať CSS přesně odpovídá backing store. width/height:100% by stretchovalo když #game
  // roste (carriery se dolayoutují později) — backing store by zůstal v staré výšce.
  cv.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'pointer-events:none',
    'z-index:1',
    'display:block',
  ].join(';');
  gameEl.appendChild(cv);
  U.canvas = cv;

  const renderer = new THREE.WebGLRenderer({
    canvas: cv,
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    stencil: true,        // dolní rám (Stage B) potřebuje stencil clipping
  });
  renderer.setPixelRatio(_dpr());
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  renderer.shadowMap.enabled = true;            // top region má stín; bottom nemá castery
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  U.renderer = renderer;

  U.scene = new THREE.Scene();
  // Unified kamera: CSS-pixel prostor #game, y-up, generózní near/far kvůli naklopené geometrii.
  U.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
  U.camera.position.set(0, 0, 100);

  U.mountTop = new THREE.Group();
  U.mountBottom = new THREE.Group();
  U.scene.add(U.mountTop);
  U.scene.add(U.mountBottom);

  window.addEventListener('resize', layout);
  // #game roste/mění výšku po init (carriery, level switch, font load, URL bar) — re-layout.
  if (typeof ResizeObserver !== 'undefined') {
    U._ro = new ResizeObserver(() => layout());
    U._ro.observe(gameEl);
  }
  return true;
}

// Přepočet velikosti canvasu + kamery + umístění obou regionů. Volat na resize a level-change.
function layout() {
  if (!U.canvas || !U.gameEl) return;
  const gRect = U.gameEl.getBoundingClientRect();
  U.gameW = Math.max(1, Math.round(gRect.width));
  U.gameH = Math.max(1, Math.round(gRect.height));
  // updateStyle=true → canvas CSS rozměry = backing store (žádný implicitní stretch).
  U.renderer.setSize(U.gameW, U.gameH, true);
  U.camera.left = 0;
  U.camera.right = U.gameW;
  U.camera.top = U.gameH;
  U.camera.bottom = 0;
  U.camera.updateProjectionMatrix();

  // TOP region — umístit mountTop na #image-area screen rect.
  const ia = document.getElementById('image-area');
  if (ia && U.mountTop && window.render3d && window.render3d.getLocalSize) {
    const r = ia.getBoundingClientRect();
    const ls = window.render3d.getLocalSize(); // { w: 360, h: 310 }
    _placeMountFrustum(U.mountTop, r.left - gRect.left, r.top - gRect.top, r.width, r.height, 0, ls.w, 0, ls.h);
  }

  // BOTTOM region (Stage B) — modul si umístí mountBottom sám, má-li napojení.
  if (U.mountBottom && window.render3dBottom && window.render3dBottom.placeUnifiedMount) {
    window.render3dBottom.placeUnifiedMount(U, gRect);
  }
}

// Inicializace: vytvoří sdílený kontext a napojí TOP modul.
function ensure(topOpts) {
  if (U.ready) return true;
  if (!window.render3d || typeof window.render3d.init !== 'function') return false;
  if (!_ensureCanvas()) return false;
  const shared = { renderer: U.renderer, scene: U.scene, camera: U.camera, mount: U.mountTop };
  const ok = window.render3d.init(U.canvas, topOpts, shared);
  if (!ok) return false;
  U.ready = true;
  layout();
  return true;
}

// Inicializace BOTTOM regionu (belt/carriers) do sdílené scény přes mountBottom.
// Může se volat nezávisle na ensure() (top) — context se vytvoří dle potřeby.
function ensureBottom() {
  if (U._bottomReady) return true;
  if (!window.render3dBottom || typeof window.render3dBottom.init !== 'function') return false;
  if (!_ensureCanvas()) return false;
  const shared = { renderer: U.renderer, scene: U.scene, camera: U.camera, mount: U.mountBottom };
  const ok = window.render3dBottom.init(shared);
  if (!ok) return false;
  U._bottomReady = true;
  layout();
  return true;
}

function render() {
  if (!U.canvas) return;   // kreslíme jakmile existuje kontext (stačí jeden region)
  U.renderer.render(U.scene, U.camera);
}

window.render3dUnified = {
  ensure,
  ensureBottom,
  render,
  layout,
  isReady: () => !!U.canvas,
  _U: U,
};

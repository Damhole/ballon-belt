// ═══════════════════════════════════════════════════════════════════════════
// Balloon Belt — Level Editor (vanilla JS)
// Uses File System Access API to read editor/levels.json and write gamee/js/levels.js.
// Falls back to download-only mode if FSA API isn't supported (Safari/Firefox).
// Directory handle persists in IndexedDB so reconnect isn't needed on next visit.
// ═══════════════════════════════════════════════════════════════════════════

const IMAGE_SOURCES = ['smiley', 'moon', 'starwars', 'frog', 'mondrian'];
const LEVEL_TYPES = ['relaxing', 'medium', 'hard', 'hardcore'];

// Musí odpovídat gamee/js/game.js (GW=36, GH=31, IMG_GH=27, COLORS[]).
const BE_GW = 36;
const BE_IMG_GH = 27;
const BE_SCALE = 10; // 360×270 canvas → přesně 36×27 buněk po 10 px
const BE_COLORS = [
  // 0–11  výchozí
  '#3dd64a','#ff7a1a','#5bc8f5','#1b9aff','#ff4fa3','#f5d800','#8b4dff','#141414','#ffffff','#e63946','#00c8a0','#8c8c8c',
  // 12–17  červené
  '#ff3b30','#c0392b','#ff6b6b','#b71c1c','#ff8a65','#bf360c',
  // 18–21  oranžové
  '#ff9800','#e65100','#ffb300','#f57c00',
  // 22–25  žluté / limetky
  '#c6e617','#76d400','#ffd600','#aeea00',
  // 26–29  zelené
  '#00c853','#1b5e20','#69f0ae','#33691e',
  // 30–33  tyrkysové / cyan
  '#00bcd4','#006064','#b2ebf2','#00e5ff',
  // 34–38  modré
  '#42a5f5','#0d47a1','#82b1ff','#1565c0','#7986cb',
  // 39–42  fialové
  '#7c4dff','#6a1b9a','#ab47bc','#ce93d8',
  // 43–46  růžové / magenta
  '#e91e63','#f48fb1','#ad1457','#ff80ab',
  // 47–50  tmavé neutrály
  '#212121','#424242','#616161','#757575',
  // 51–54  světlé neutrály
  '#bdbdbd','#e0e0e0','#fff9c4','#fce4ec',
  // 55–60  hnědé / teplé
  '#795548','#5d4037','#a1887f','#d7ccc8','#bf8040','#ffcc80',
  // 61–63  speciální
  '#ff6e40','#40c4ff','#b9f6ca',
];
const BE_SHAPES = ['rect','cross','L','T','circle'];

// Předdefinované palety — každá je pole indexů do BE_COLORS.
const BE_PALETTE_PRESETS = [
  { key: 'default', label: 'Výchozí',       colors: [0,1,2,3,4,5,6,7,8,9,10,11] },
  { key: 'neon',    label: 'Neon',           colors: [0,9,12,1,5,33,3,39,43,25,31,8] },
  { key: 'pastel',  label: 'Pastel',         colors: [28,44,42,32,53,54,63,46,51,4,8,11] },
  { key: 'earthy',  label: 'Zemité',         colors: [55,56,57,58,29,27,19,21,59,60,7,11] },
  { key: 'ocean',   label: 'Oceán',          colors: [3,35,34,30,33,10,2,32,37,36,7,8] },
  { key: 'sunset',  label: 'Západ slunce',   colors: [9,12,16,1,18,20,5,43,45,61,7,8] },
  { key: 'forest',  label: 'Lesní',          colors: [0,26,27,29,24,23,55,56,57,5,7,11] },
  { key: 'fire',    label: 'Oheň',           colors: [9,12,13,15,16,1,17,18,19,5,20,7] },
  { key: 'spring',  label: 'Jaro',           colors: [0,26,28,63,44,46,4,43,5,53,8,51] },
  { key: 'night',   label: 'Noc',            colors: [7,47,48,35,37,3,6,39,40,2,36,11] },
  { key: 'retro',   label: 'Retro',          colors: [13,1,5,0,3,6,55,11,7,8,21,41] },
  { key: 'mono',    label: 'Mono',           colors: [7,47,48,49,50,11,51,52,8,3,0,9] },
  { key: 'popart',  label: 'Pop art',        colors: [12,18,5,22,26,30,3,39,43,14,7,8] },
];

// Port blockMask z game.js (1:1 identický, aby editor renderoval tvary stejně jako hra).
function beBlockMask(shape, w, h) {
  const m = [];
  for (let y = 0; y < h; y++) m.push(new Array(w).fill(false));
  if (shape === 'rect') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y][x] = true;
  } else if (shape === 'cross') {
    const cx = Math.floor((w - 1) / 2), cy = Math.floor((h - 1) / 2);
    const armW = Math.max(1, Math.floor(w / 3)), armH = Math.max(1, Math.floor(h / 3));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.abs(y - cy) <= Math.floor(armH / 2)) m[y][x] = true;
      if (Math.abs(x - cx) <= Math.floor(armW / 2)) m[y][x] = true;
    }
  } else if (shape === 'L') {
    const thick = Math.max(1, Math.floor(w / 3));
    for (let y = 0; y < h; y++) for (let x = 0; x < thick; x++) m[y][x] = true;
    for (let y = h - thick; y < h; y++) for (let x = 0; x < w; x++) m[y][x] = true;
  } else if (shape === 'T') {
    const thick = Math.max(1, Math.floor(h / 3));
    for (let y = 0; y < thick; y++) for (let x = 0; x < w; x++) m[y][x] = true;
    const stemW = Math.max(1, Math.floor(w / 3));
    const stemX = Math.floor((w - stemW) / 2);
    for (let y = thick; y < h; y++) for (let x = stemX; x < stemX + stemW; x++) m[y][x] = true;
  } else if (shape === 'circle') {
    const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2, ry = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      m[y][x] = (nx * nx + ny * ny) <= 1.0;
    }
  }
  return m;
}

// Editor-only state pro Block editor.
const beState = {
  selectedBlockIdx: -1,     // index do lvl.blocks, -1 = nic nevybráno
  drag: null,               // { shape, kind, color, w, h, hp, fromPaletteDrop? }
  mousePx: null,            // {x,y} v image-pixel souřadnicích, pro preview při drag-over
  // Pixel editor (aktivní pouze pro image.source === 'custom'):
  pxTool: 'paint',          // 'paint' | 'erase' | 'rect-fill' | 'rect-erase'
  pxColor: 4,               // 0..8
  pxDragging: false,        // true během click-drag kreslení
  pxRectStart: null,        // {x,y} při rect tool — počáteční pixel
  pxRectEnd: null,          // aktualní end pixel (hover během dragu)
};

// ═══════════════════════════════════════════════════════════════════════════
// UNDO / REDO — per-level history stack
// ═══════════════════════════════════════════════════════════════════════════
// Scope: každý level má vlastní undo+redo stack, navázaný přes WeakMap na
// referenci level objektu (při reload z disku se celé state.levels přepíše →
// staré handly jsou GC'd a historie „resetne" sama bez explicitního úklidu).
//
// Snapshot = deep clone polí, která se dají editovat v editoru (label, key,
// type, image, blocks, rocketTargets, garage, carrierLayouts). NEsnapshotujeme
// runtime state (selectedBlockIdx, pxTool, ...) — ten není součástí dokumentu.
//
// Coalescing: rychlé opakování stejné akce v okně 500ms (např. tažení slideru
// HP, psaní do label) se slije do jediného undo kroku. Řízeno `actionKey` —
// mutation site předá konkrétní identifikátor a `histPush` coalesce řeší sám.
const _histUndo = new WeakMap();
const _histRedo = new WeakMap();
const HIST_LIMIT = 50;
const HIST_COALESCE_MS = 500;
let _histLastKey = null;
let _histLastLvl = null;
let _histLastTime = 0;
let _histApplying = false; // guard: při aplikaci undo/redo nepushujeme do historie

function histSnapshotLvl(lvl) {
  return JSON.parse(JSON.stringify({
    label: lvl.label, key: lvl.key, type: lvl.type,
    image: lvl.image, blocks: lvl.blocks,
    rocketTargets: lvl.rocketTargets, garage: lvl.garage,
    carrierLayouts: lvl.carrierLayouts,
    defaultComplexity: lvl.defaultComplexity,
  }));
}
function histApplySnap(lvl, snap) {
  // Mutujeme stejnou level referenci (nevyměňujeme pole) aby index v state.levels
  // a WeakMap handle zůstal platný.
  lvl.label = snap.label;
  lvl.key = snap.key;
  lvl.type = snap.type;
  lvl.image = snap.image;
  lvl.blocks = snap.blocks;
  lvl.rocketTargets = snap.rocketTargets;
  lvl.garage = snap.garage;
  lvl.carrierLayouts = snap.carrierLayouts;
  if (snap.defaultComplexity) lvl.defaultComplexity = snap.defaultComplexity;
  else delete lvl.defaultComplexity;
}

// Push snapshotu PŘED mutací. `actionKey` coalescuje rychlé po sobě jdoucí
// změny stejného typu (např. HP slider drag) do jednoho kroku.
function histPush(lvl, actionKey) {
  if (!lvl || _histApplying) return;
  const now = Date.now();
  if (actionKey && actionKey === _histLastKey && lvl === _histLastLvl &&
      (now - _histLastTime) < HIST_COALESCE_MS) {
    _histLastTime = now;
    return; // coalesce — první snapshot z téhle série stačí
  }
  _histLastKey = actionKey || null;
  _histLastLvl = lvl;
  _histLastTime = now;
  const stack = _histUndo.get(lvl) || [];
  stack.push(histSnapshotLvl(lvl));
  if (stack.length > HIST_LIMIT) stack.shift();
  _histUndo.set(lvl, stack);
  _histRedo.set(lvl, []); // každá nová mutace invalidates redo větev
  updateHistoryButtons();
  // Edit carrier layoutu invalidates předchozí layout-applied/fallback status —
  // banner by jinak visel s outdated důvodem dokud iframe neukončí nový startLevel
  // a nepošle novou postMessage (~800ms gap). Vyčistit = status „čeká na hru".
  if (actionKey && typeof actionKey === 'string' && actionKey.startsWith('cl-') && lvl.key) {
    const bag = state.layoutStatusByLevel[lvl.key];
    if (bag) delete bag[state.clActiveDiff];
  }
}

function histCanUndo(lvl) { return !!(lvl && (_histUndo.get(lvl) || []).length); }
function histCanRedo(lvl) { return !!(lvl && (_histRedo.get(lvl) || []).length); }

function histUndo() {
  const lvl = beCurrentLvl();
  if (!histCanUndo(lvl)) return;
  const undoStack = _histUndo.get(lvl) || [];
  const redoStack = _histRedo.get(lvl) || [];
  redoStack.push(histSnapshotLvl(lvl));
  const snap = undoStack.pop();
  _histRedo.set(lvl, redoStack);
  _histUndo.set(lvl, undoStack);
  _histApplying = true;
  histApplySnap(lvl, snap);
  _histLastKey = null; // zlomit coalesce řetěz — další mutace = nový záznam
  _histApplying = false;
  afterHistoryApply();
}
function histRedo() {
  const lvl = beCurrentLvl();
  if (!histCanRedo(lvl)) return;
  const undoStack = _histUndo.get(lvl) || [];
  const redoStack = _histRedo.get(lvl) || [];
  undoStack.push(histSnapshotLvl(lvl));
  const snap = redoStack.pop();
  _histUndo.set(lvl, undoStack);
  _histRedo.set(lvl, redoStack);
  _histApplying = true;
  histApplySnap(lvl, snap);
  _histLastKey = null;
  _histApplying = false;
  afterHistoryApply();
}
function afterHistoryApply() {
  // Po aplikaci snapshotu překreslit editor, zaznamenat dirty a reloadnout preview.
  beState.selectedBlockIdx = -1;
  beState.drag = null;
  beState.mousePx = null;
  beState.pxRectStart = null;
  beState.pxRectEnd = null;
  state.dirty = true;
  scheduleAutosave();
  updateUI();
}
function updateHistoryButtons() {
  const btnU = $('btn-undo');
  const btnR = $('btn-redo');
  if (!btnU || !btnR) return;
  const lvl = beCurrentLvl();
  btnU.disabled = !histCanUndo(lvl);
  btnR.disabled = !histCanRedo(lvl);
}

// Inicializace prázdných pixelů pro custom level (27 řad × 36 sloupců hodnot -1).
function beBlankPixels() {
  const p = [];
  for (let y = 0; y < BE_IMG_GH; y++) p.push(new Array(BE_GW).fill(-1));
  return p;
}
function beEnsurePixels(lvl) {
  if (!lvl || !lvl.image) return null;
  if (lvl.image.source !== 'custom') return null;
  if (!Array.isArray(lvl.image.pixels) || lvl.image.pixels.length !== BE_IMG_GH) {
    lvl.image.pixels = beBlankPixels();
  } else {
    // Sanity: každý řádek musí být pole délky GW.
    for (let y = 0; y < BE_IMG_GH; y++) {
      if (!Array.isArray(lvl.image.pixels[y]) || lvl.image.pixels[y].length !== BE_GW) {
        lvl.image.pixels[y] = new Array(BE_GW).fill(-1);
      }
    }
  }
  return lvl.image.pixels;
}

// State -----------------------------------------------------------------------
const state = {
  rootHandle: null,     // FileSystemDirectoryHandle pointing at ballon-belt/ repo root
  levels: [],           // array of level objects (source of truth in memory)
  selectedIdx: -1,      // which level is currently open in edit panel
  dirty: false,         // has the in-memory state diverged from disk since last save?
  fsaSupported: 'showDirectoryPicker' in window,
  // Per-level/difficulty pixel counts reported by preview iframe (balloonbelt:level-stats).
  // Shape: { [levelKey]: { easy: number[9], medium: number[9], hard: number[9] } }.
  pxCountsByLevel: {},
  // Per-level/difficulty projectile totals reported by game (sum per color across carriers+garage).
  // Slouží k game-truth need-vs-have porovnání v editoru — pokud projCounts[c] < pxCounts[c],
  // layout nedodá dost munice a level je technicky nedohratelný.
  projCountsByLevel: {},
  // Per-level/difficulty fallback status reported by game (layout-applied / layout-fallback).
  // Shape: { [levelKey]: { [diff]: { applied:bool, reason:string|null, layoutName:string|null } } }.
  layoutStatusByLevel: {},
};

// IndexedDB for persisting FSA directory handle -------------------------------
const IDB_NAME = 'bbelt-editor';
const IDB_STORE = 'handles';
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSave(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbLoad(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// File System access ---------------------------------------------------------
async function verifyPermission(handle, readWrite = true) {
  const opts = readWrite ? { mode: 'readwrite' } : { mode: 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

async function connectFolder() {
  if (!state.fsaSupported) {
    alert('Your browser does not support File System Access API.\n' +
          'Please use Chrome or Edge. (Download-only fallback mode is planned.)');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: 'bbelt-root',
      mode: 'readwrite',
      startIn: 'documents',
    });
    // Quick sanity: the chosen folder should have a gamee/ subfolder.
    try {
      await handle.getDirectoryHandle('gamee');
    } catch (e) {
      alert('Selected folder does not contain a gamee/ subdirectory.\n' +
            'Please pick the ballon-belt repo root.');
      return;
    }
    state.rootHandle = handle;
    await idbSave('rootHandle', handle);
    await reloadFromDisk();
    updateUI();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

async function tryRestoreConnection() {
  if (!state.fsaSupported) return;
  try {
    const handle = await idbLoad('rootHandle');
    if (!handle) return;
    // Don't prompt on load — only try silently. User can click Connect if we fail.
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
      state.rootHandle = handle;
      await reloadFromDisk();
      updateUI();
    } else {
      // Show a hint that reconnection is needed
      setLastAction('Previous folder found — click Connect to restore access.');
    }
  } catch (e) {
    console.warn('restore failed', e);
  }
}

async function readLevelsJson() {
  const editorDir = await state.rootHandle.getDirectoryHandle('editor');
  const fileHandle = await editorDir.getFileHandle('levels.json');
  const file = await fileHandle.getFile();
  const text = await file.text();
  return JSON.parse(text);
}

async function writeLevelsJson(levels) {
  const editorDir = await state.rootHandle.getDirectoryHandle('editor');
  const fileHandle = await editorDir.getFileHandle('levels.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(levels, null, 2) + '\n');
  await writable.close();
}

async function writeGameLevelsJs(levels) {
  const gameeDir = await state.rootHandle.getDirectoryHandle('gamee');
  const jsDir = await gameeDir.getDirectoryHandle('js');
  const fileHandle = await jsDir.getFileHandle('levels.js', { create: true });
  const writable = await fileHandle.createWritable();
  const content =
    '// ═══════════════════════════════════════════════════════════════════════════\n' +
    '// gamee/js/levels.js  — GENERATED by editor (editor/index.html)\n' +
    '// NEEDITOVAT RUČNĚ — otevři editor a publikuj z něj.\n' +
    '// Pokud tento soubor chybí nebo je prázdný, hra automaticky použije\n' +
    '// LEVELS_FALLBACK z game.js (viz resolveLevels()).\n' +
    '// ═══════════════════════════════════════════════════════════════════════════\n' +
    'window.LEVELS = ' + JSON.stringify(levels, null, 2) + ';\n';
  await writable.write(content);
  await writable.close();
}

async function reloadFromDisk() {
  if (!state.rootHandle) return;
  if (!(await verifyPermission(state.rootHandle))) {
    alert('Permission to access the folder was not granted.');
    return;
  }
  try {
    // Zapamatuj si KEY aktuálně vybraného levelu, ať se po reloadu vrátíme
    // na ten samý level (i když změnil pořadí). Bez toho by se selectedIdx
    // resetoval na -1 a designer ztratil kontext.
    const prevKey = (state.selectedIdx >= 0 && state.levels[state.selectedIdx])
      ? state.levels[state.selectedIdx].key : null;
    state.levels = await readLevelsJson();
    let newIdx = -1;
    if (prevKey) {
      newIdx = state.levels.findIndex(l => l && l.key === prevKey);
    }
    state.selectedIdx = newIdx;
    state.dirty = false;
    setLastAction('Loaded ' + state.levels.length + ' levels from editor/levels.json'
      + (newIdx >= 0 ? ' · vrácen na „' + prevKey + '"' : ''));
    updateUI();
  } catch (e) {
    console.error(e);
    alert('Failed to load editor/levels.json:\n' + e.message);
  }
}

// Auto-save + auto-publish on every edit (debounced).
// Source of truth = editor/levels.json. Game-readable copy = gamee/js/levels.js.
// Both are rewritten together so the preview iframe always sees the latest state.
let _autosaveTimer = null;
function scheduleAutosave() {
  if (!state.rootHandle) return;
  if (_autosaveTimer) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => { _autosaveTimer = null; doAutosave(); }, 300);
}
async function doAutosave() {
  if (!state.rootHandle) return;
  // Auto-rename duplikátů PŘED zápisem — místo silentního skip writeGameLevelsJs.
  // Po renameu je `findDuplicateKeys` prázdné a oba soubory se zapíšou konzistentně.
  // Side effect: state maps (pxCountsByLevel/...) se nepřemigrují automaticky pro
  // renamované klíče — orphan stats se vyčistí až při dalším delete/manuální rename.
  const renamed = _resolveDuplicateKeys(state.levels);
  // Když auto-rename přejmenoval aktuálně vybraný level, sync UI form (jinak
  // f-key input drží starý klíč).
  if (renamed.length) {
    const sel = state.levels[state.selectedIdx];
    if (sel && $('f-key').value !== sel.key) $('f-key').value = sel.key;
  }
  try {
    await writeLevelsJson(state.levels);
    await writeGameLevelsJs(state.levels);
    if (renamed.length) {
      const summary = renamed.map(r => r.oldKey + ' → ' + r.newKey).join(', ');
      setLastAction('🔧 Auto-rename duplicate keys: ' + summary + ' · 💾 Autosaved');
      // Update header chip a list (klíče se mohly změnit).
      updateUI();
    } else {
      setLastAction('💾 Autosaved (' + state.levels.length + ' levels) → editor/levels.json + gamee/js/levels.js');
    }
    // Preview reload AŽ po dokončení zápisu. Jinak by iframe reload proběhl
    // s 150ms debouncem ještě PŘED tím, než autosave (300ms debounce) stihne
    // zapsat soubor → iframe by si natahoval starou verzi levels.js.
    // Server servíruje z /tmp/ballon-belt (TCC blokuje ~/Documents), kam běží
    // rsync daemon /tmp/balloon-sync.sh s 150ms pollingem. FSA write proběhne
    // do ~/Documents instantně, ale do /tmp se mirror dostane při příštím
    // polling tiku (max ~200ms). 400ms forku dává bezpečnou rezervu, aby
    // reload iframe chytil aktuální verzi.
    setTimeout(() => reloadPreview(), 400);
    state.dirty = false;
    $('dirty-status').hidden = true;
    // Sync health check — verify že rsync daemon /tmp/balloon-sync.sh skutečně
    // dostal naše zápisy do /tmp/ballon-belt/, odkud httpd serveruje.
    // Bez toho daemon můžou být stuck a preview pak ukazuje stará data.
    _scheduleSyncHealthCheck();
  } catch (e) {
    console.error(e);
    setLastAction('❌ Autosave failed: ' + e.message);
  }
}

// Sync health check: porovná velikost právě zapsaného gamee/js/levels.js
// (přes FSA do ~/Documents/) s velikostí, kterou serveruje httpd (z /tmp/ballon-belt/).
// Když se liší o víc než 100 bytů (jiný JSON whitespace tolerance) → daemon
// pravděpodobně stuck, ukážeme red chip s návodem na restart.
let _syncCheckTimer = null;
function _scheduleSyncHealthCheck() {
  if (_syncCheckTimer) clearTimeout(_syncCheckTimer);
  // 600ms = 400ms reload safety + 200ms rsync polling rezerva. Po této době
  // by /tmp/ballon-belt/ mělo mít stejný obsah jako ~/Documents/.
  _syncCheckTimer = setTimeout(() => {
    _syncCheckTimer = null;
    _runSyncHealthCheck().catch(e => console.warn('[sync-check] failed:', e));
  }, 600);
}
async function _runSyncHealthCheck() {
  if (!state.rootHandle) return;
  // 1. Read expected size from FSA (what editor wrote to ~/Documents/)
  let expected = -1;
  try {
    const gameeDir = await state.rootHandle.getDirectoryHandle('gamee');
    const jsDir = await gameeDir.getDirectoryHandle('js');
    const fileHandle = await jsDir.getFileHandle('levels.js');
    const file = await fileHandle.getFile();
    expected = file.size;
  } catch (e) { return; /* no permission, skip */ }

  // 2. Fetch served version (from /tmp/ballon-belt/ via Ruby httpd, with cache-bust)
  let served = -1;
  try {
    const r = await fetch('../gamee/js/levels.js?syncprobe=' + Date.now(), { cache: 'no-store' });
    const text = await r.text();
    // Use byte length proxy: TextEncoder gives close-enough size for ASCII/UTF-8 JSON.
    served = new TextEncoder().encode(text).length;
  } catch (e) { return; /* fetch failed, skip */ }

  const chip = $('sync-status');
  if (!chip) return;
  const diff = Math.abs(expected - served);
  // Tolerance 100 bytů — line endings / trailing newline rozdíly. Při skutečné
  // staleness jsou rozdíly v kB až desítkách kB.
  if (expected > 0 && diff > 100) {
    chip.hidden = false;
    chip.textContent = '⚠ Sync stuck: ' + expected + 'B → ' + served + 'B (' + (expected - served) + 'B diff)';
    console.warn('[sync-check] /tmp/ballon-belt out of sync — daemon stuck. Expected', expected, 'served', served);
  } else {
    chip.hidden = true;
  }
  _updateHealthBadge();
}

// Manual "Publish" = force immediate save (same as autosave, but synchronous to the click).
async function publishToGame() {
  if (!state.rootHandle) return;
  if (!state.levels.length) { alert('No levels to publish.'); return; }
  if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
  // Konzistentní s autosave — nikdy neblokujeme zápis kvůli duplikátům, místo
  // toho je auto-renamujeme. Designer dostane toast s mapováním přejmenování.
  const renamed = _resolveDuplicateKeys(state.levels);
  if (renamed.length) {
    const sel = state.levels[state.selectedIdx];
    if (sel && $('f-key').value !== sel.key) $('f-key').value = sel.key;
  }
  try {
    await writeLevelsJson(state.levels);
    await writeGameLevelsJs(state.levels);
    state.dirty = false;
    const renamedNote = renamed.length
      ? ' (auto-rename: ' + renamed.map(r => r.oldKey + ' → ' + r.newKey).join(', ') + ')'
      : '';
    setLastAction('🚀 Published ' + state.levels.length + ' levels to gamee/js/levels.js' + renamedNote);
    schedulePreviewReload();
    updateUI();
    _scheduleSyncHealthCheck();
  } catch (e) {
    console.error(e);
    alert('Publish failed: ' + e.message);
  }
}

// Preview iframe ------------------------------------------------------------
let _previewReloadTimer = null;
function schedulePreviewReload() {
  if (_previewReloadTimer) clearTimeout(_previewReloadTimer);
  _previewReloadTimer = setTimeout(() => {
    _previewReloadTimer = null;
    // Pokud je pending autosave, přeskočíme reload — doAutosave() ho zavolá
    // sám až po úspěšném zápisu, takže iframe dostane fresh data.
    if (_autosaveTimer) return;
    reloadPreview();
  }, 150);
}
function reloadPreview() {
  const frame = $('preview-frame');
  if (!frame) return;
  const lvl = state.levels[state.selectedIdx];
  if (!lvl) {
    frame.src = 'about:blank';
    $('preview-empty').hidden = false;
    frame.hidden = true;
    return;
  }
  $('preview-empty').hidden = true;
  frame.hidden = false;
  const diff = $('preview-diff').value || 'easy';
  const url = '../gamee/index_local.html?level=' + encodeURIComponent(lvl.key) +
              '&diff=' + encodeURIComponent(diff) +
              '&t=' + Date.now();
  // Hard refresh: about:blank → real URL. Vynutí plný reload (včetně cache-bust
  // scriptů uvnitř index_local.html, viz inline <script> tam). Bez blanku browser
  // občas z contextu contextu přežívající levels.js / game.js bere z HTTP cache.
  frame.src = 'about:blank';
  setTimeout(() => { frame.src = url; }, 30);
}

// Validation helpers --------------------------------------------------------
function findDuplicateKeys(levels) {
  const seen = {}, dupes = new Set();
  for (const l of levels) {
    if (seen[l.key]) dupes.add(l.key); else seen[l.key] = true;
  }
  return [...dupes];
}
// Auto-rename duplikátů: projde levely zleva, druhý a další výskyt téhož klíče
// přejmenuje připojením suffixu -2, -3, ... dokud není unikátní. Mutuje level
// objekty in-place. Vrací pole {oldKey, newKey} pro toast/log.
// Volá se v doAutosave PŘED zápisem, aby writeGameLevelsJs nemusel být skipnut
// a preview iframe vždy dostal čerstvá data.
function _resolveDuplicateKeys(levels) {
  const seen = new Set();
  const renamed = [];
  for (const lvl of levels) {
    if (!lvl || !lvl.key) continue;
    if (!seen.has(lvl.key)) { seen.add(lvl.key); continue; }
    const oldKey = lvl.key;
    let n = 2;
    let candidate = oldKey + '-' + n;
    while (seen.has(candidate)) { n++; candidate = oldKey + '-' + n; }
    lvl.key = candidate;
    seen.add(candidate);
    renamed.push({ oldKey, newKey: candidate });
  }
  return renamed;
}
// Type badge — designer-set dropdown na úrovni levelu. Dřív se mixoval s img
// difficulty a carrier complexity, ale to vedlo k bug (badge nikdy neukazoval
// Relaxing, protože rank byl hardcoded 3). Teď čteme lvl.type napřímo.
const TYPE_META = {
  relaxing: { key: 'relaxing', label: 'Relaxing' },
  medium:   { key: 'medium',   label: 'Medium' },
  hard:     { key: 'hard',     label: 'Hard' },
  hardcore: { key: 'hardcore', label: 'Hard-core' },
};
function typeBadge(lvl) {
  const t = (lvl && lvl.type) || 'relaxing';
  return TYPE_META[t] || TYPE_META.relaxing;
}

// Model mutations -----------------------------------------------------------
function _nextAvailableKey() {
  // Najdi nejnižší číslo N takové, že 'new-level-N' nekoliduje s existujícími
  // klíči. Předtím se počítalo prostě state.levels.length + 1, což po smazání
  // / přejmenování vedlo k duplikátům (autosave pak skipoval zápis do
  // gamee/js/levels.js a preview ukazoval staré verze).
  const taken = new Set((state.levels || []).map(l => l && l.key));
  let n = state.levels.length + 1;
  while (taken.has('new-level-' + n)) n++;
  return 'new-level-' + n;
}
function newLevel() {
  return {
    key: _nextAvailableKey(),
    label: 'Nový level',
    type: 'relaxing',
    image: { source: 'smiley' },
    activePalette: BE_PALETTE_PRESETS[0].colors.slice(),
    blocks: [],
    rocketTargets: null,
    garage: null,
  };
}

function markDirty() {
  state.dirty = true;
  updateUI();
  // Auto-save + auto-publish (debounced). Editor is a dev tool, no collaborators,
  // so there's no reason to delay writing gamee/js/levels.js — we want the live
  // preview iframe to update on every change.
  scheduleAutosave();
}

function addLevel() {
  state.levels.push(newLevel());
  state.selectedIdx = state.levels.length - 1;
  markDirty();
}

function deleteLevel(idx) {
  if (!confirm('Delete level "' + state.levels[idx].label + '"?')) return;
  // Před splicem si zapamatuj klíč, ať můžeme vyčistit orphan stats. Bez toho
  // by `state.pxCountsByLevel[oldKey]` / `layoutStatusByLevel[oldKey]` zůstaly
  // navždy a nový level se stejným klíčem (po _nextAvailableKey) by zdědil
  // staré statistiky → matoucí banner / capacity.
  const removedKey = state.levels[idx] && state.levels[idx].key;
  state.levels.splice(idx, 1);
  if (removedKey) _purgeStatsForKey(removedKey);
  if (state.selectedIdx === idx) state.selectedIdx = -1;
  else if (state.selectedIdx > idx) state.selectedIdx -= 1;
  markDirty();
}

// Vyčistí state mapy pro konkrétní level key (delete / rename).
function _purgeStatsForKey(key) {
  if (!key) return;
  if (state.pxCountsByLevel) delete state.pxCountsByLevel[key];
  if (state.projCountsByLevel) delete state.projCountsByLevel[key];
  if (state.layoutStatusByLevel) delete state.layoutStatusByLevel[key];
}
// Migrace state map při key rename (oldKey → newKey). Stats z preview iframe
// jsou key-aware, takže po renameu by se musely znovu načíst při dalším runu;
// zatím prostě smažeme oldKey, aby nenastal collision/orphan.
function _migrateStatsKey(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return;
  // Přesun pod nový klíč (zachová poslední známé hodnoty pro UI).
  ['pxCountsByLevel', 'projCountsByLevel', 'layoutStatusByLevel'].forEach(name => {
    const bag = state[name];
    if (bag && bag[oldKey] !== undefined) {
      bag[newKey] = bag[oldKey];
      delete bag[oldKey];
    }
  });
}

function reorderLevel(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const [item] = state.levels.splice(fromIdx, 1);
  state.levels.splice(toIdx, 0, item);
  if (state.selectedIdx === fromIdx) state.selectedIdx = toIdx;
  else if (state.selectedIdx > fromIdx && state.selectedIdx <= toIdx) state.selectedIdx -= 1;
  else if (state.selectedIdx < fromIdx && state.selectedIdx >= toIdx) state.selectedIdx += 1;
  markDirty();
}

// UI rendering --------------------------------------------------------------
function $(id) { return document.getElementById(id); }
function setLastAction(msg) { $('last-action').textContent = msg; }

function updateUI() {
  const connected = !!state.rootHandle;
  const ps = $('project-status');
  ps.textContent = connected ? '📁 Connected' : '📁 Not connected';
  ps.className = 'status-chip ' + (connected ? 'status-connected' : 'status-disconnected');

  $('dirty-status').hidden = !state.dirty;
  // Duplicate keys badge — když jsou v levelech duplicitní klíče, autosave
  // přeskakuje zápis do gamee/js/levels.js (viz doAutosave). Bez vizuálního
  // varování si toho designer všimne až když preview přestane reagovat.
  const dk = $('dupkey-status');
  if (dk) {
    const dupes = findDuplicateKeys(state.levels || []);
    if (dupes.length) {
      dk.hidden = false;
      dk.textContent = '⚠ Duplicitní klíče: ' + dupes.join(', ');
    } else {
      dk.hidden = true;
    }
  }

  $('btn-load').disabled = !connected;
  $('btn-publish').disabled = !connected || !state.levels.length;
  $('btn-add').disabled = !connected;
  $('btn-add-from-empty').disabled = !connected;

  $('list-empty').hidden = connected && state.levels.length > 0;
  if (!connected) {
    $('list-empty').innerHTML = 'Connect to your <code>ballon-belt</code> folder to load levels.';
  } else if (!state.levels.length) {
    $('list-empty').innerHTML = 'No levels yet. Click <b>+ Add</b> to create one.';
  }

  renderList();
  renderEditor();
  updateHistoryButtons();
  _updateHealthBadge();
}

// Overall health badge — agreguje stav editoru: connected, autosave, sync,
// duplicate keys. Designer vidí jednu zelenou tečku → vše OK; jakmile něco
// hapruje, změní se na žlutou (working) nebo červenou (issues).
function _updateHealthBadge() {
  const badge = $('health-badge');
  if (!badge) return;
  const connected = !!state.rootHandle;
  const dupes = findDuplicateKeys(state.levels || []);
  const syncStuck = !$('sync-status').hidden;
  const dirty = !!state.dirty;

  let cls, txt, title;
  if (!connected) {
    cls = 'health-idle'; txt = '○';
    title = 'Editor není připojen ke složce projektu. Klikni „📁 Connect folder".';
  } else if (dupes.length || syncStuck) {
    cls = 'health-bad'; txt = '●';
    const probs = [];
    if (dupes.length) probs.push('duplicate keys (' + dupes.join(', ') + ')');
    if (syncStuck) probs.push('sync daemon stuck');
    title = '⚠ Problém: ' + probs.join('; ') + '. Zkontroluj červené chipy vlevo.';
  } else if (dirty) {
    cls = 'health-warn'; txt = '●';
    title = 'Připojeno · čeká se na autosave (300ms debounce). Bez akcí se za chvíli ukáže zelená.';
  } else {
    cls = 'health-ok'; txt = '●';
    title = '✓ Připojeno · autosave OK · sync OK · žádné duplicity. Vše šlape.';
  }
  badge.className = 'health-badge ' + cls;
  badge.textContent = txt;
  badge.title = title;
}

// Kontrola zda má level rozumný obrázek. Preset = vždy OK (fixní pixely
// v game.js). Custom = OK když má aspoň jeden obarvený pixel (cell !== -1).
function clLevelHasImage(lvl) {
  if (!lvl || !lvl.image) return false;
  const src = lvl.image.source;
  if (!src) return false;
  if (src !== 'custom') return true;
  const px = lvl.image.pixels;
  if (!Array.isArray(px)) return false;
  for (const row of px) {
    if (!Array.isArray(row)) continue;
    for (const v of row) if (v !== -1 && v != null) return true;
  }
  return false;
}

// Vyhodnotí status levelu. Vrací kind (ok/warn/bad), ikonu a důvod (tooltip).
// Použito v sidebaru za type badge.
//
// Logika (v31+):
//   - "bad"  = reálná chyba v existujícím layoutu: unreachable carriers,
//              kapacita nedostačuje, nebo layout spadl při runu na auto-gen.
//   - "warn" = „rozpracováno" — chybí pin pro výchozí complexity NEBO chybí
//              obrázek (custom je prázdný). Hra funguje, ale level není dotažený.
//   - "ok"   = pin je nastavený, obrázek je vložený, žádný error. „Done."
//
// Chybějící layout pro některou complexity = NENÍ warning — hra auto-gen zvládne
// a pin si stejně vybere jen existující varianty (je disabled bez nich).
function clComputeLevelStatus(lvl) {
  if (!lvl) return { kind: 'ok', icon: '·', reason: '' };
  const layouts = Array.isArray(lvl.carrierLayouts) ? lvl.carrierLayouts : [];
  const problems = [];
  const warnings = [];

  // 1) Errors — problémy s existujícími layouty (neaplikují se na chybějící).
  for (const v of layouts) {
    if (!v || !Array.isArray(v.grid) || !v.grid.length) continue;
    const unreach = clCountUnreachable(v);
    if (unreach > 0) {
      problems.push('"' + (v.name || '?') + '" (' + (v.difficulty || '?') + '): ' + unreach + ' nedostupných nosičů');
    }
  }
  const diffs = ['easy', 'medium', 'hard'];
  const statusBag = state.layoutStatusByLevel[lvl.key] || {};
  const pxBag = state.pxCountsByLevel[lvl.key] || {};
  for (const d of diffs) {
    const v = layouts.find(vv => vv && vv.difficulty === d);
    if (!v) continue; // chybějící layout není error — auto-gen to zvládne
    const st = statusBag[d];
    if (st && st.applied === false) {
      problems.push(d + ': layout spadl na auto-gen (' + (st.reason || 'neznámý důvod') + ')');
      continue;
    }
    const px = pxBag[d] || pxBag.easy || pxBag.medium || pxBag.hard;
    if (px) {
      const slotsByColor = clCountLayoutSlotsByColor(v);
      for (let c = 0; c < BE_COLORS.length; c++) {
        const need = px[c] | 0;
        if (need <= 0) continue;
        const needSlots = Math.ceil(need / CL_PROJECTILES_PER_CARRIER);
        if ((slotsByColor[c] || 0) < needSlots) {
          problems.push(d + ': barva ' + c + ' potřebuje ' + needSlots + ' slot(ů), layout má ' + (slotsByColor[c] || 0));
        }
      }
    }
  }

  // 2) Completeness — pin + obrázek = „done"
  const hasPin = !!lvl.defaultComplexity;
  const hasImage = clLevelHasImage(lvl);
  if (!hasPin) warnings.push('není nastavený pin pro výchozí complexity');
  if (!hasImage) warnings.push('chybí obrázek (custom je prázdný)');

  if (problems.length) {
    return { kind: 'bad', icon: '✗', reason: 'Chyby:\n• ' + problems.join('\n• ') };
  }
  if (warnings.length) {
    return { kind: 'warn', icon: '⚠', reason: 'Rozpracováno — chybí:\n• ' + warnings.join('\n• ') };
  }
  return { kind: 'ok', icon: '✓', reason: 'Level je hotový (pin + obrázek, bez chyb).' };
}

function renderList() {
  const ul = $('level-list');
  ul.innerHTML = '';
  state.levels.forEach((lvl, idx) => {
    const li = document.createElement('li');
    li.className = 'level-item' + (idx === state.selectedIdx ? ' selected' : '');
    li.draggable = true;
    li.dataset.idx = idx;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '≡';
    li.appendChild(handle);

    const order = document.createElement('span');
    order.className = 'level-order';
    order.textContent = '#' + (idx + 1);
    li.appendChild(order);

    const title = document.createElement('span');
    title.className = 'level-title';
    title.innerHTML = escapeHTML(lvl.label) + '<span class="level-key">' + escapeHTML(lvl.key) + '</span>';
    li.appendChild(title);

    const diff = typeBadge(lvl);
    const badge = document.createElement('span');
    badge.className = 'diff-badge diff-' + diff.key;
    badge.textContent = diff.label;
    li.appendChild(badge);

    // Status badge: ✓ OK / ⚠ warning / ✗ error. Rozhodnutí viz clComputeLevelStatus.
    const st = clComputeLevelStatus(lvl);
    const statusEl = document.createElement('span');
    statusEl.className = 'level-status level-status-' + st.kind;
    statusEl.textContent = st.icon;
    statusEl.title = st.reason;
    li.appendChild(statusEl);

    const del = document.createElement('button');
    del.className = 'level-delete';
    del.textContent = '🗑';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteLevel(idx); });
    li.appendChild(del);

    li.addEventListener('click', () => { state.selectedIdx = idx; updateUI(); });

    // Drag & drop s drop indikátorem (linka nad/pod podle Y pozice kurzoru).
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      // cleanup všech indikátorů (mohl zůstat z předchozího dragoveru)
      document.querySelectorAll('.level-item').forEach(el => {
        el.classList.remove('drop-above', 'drop-below');
      });
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const above = (e.clientY - rect.top) < rect.height / 2;
      li.classList.toggle('drop-above', above);
      li.classList.toggle('drop-below', !above);
    });
    li.addEventListener('dragleave', () => {
      li.classList.remove('drop-above', 'drop-below');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const above = (e.clientY - rect.top) < rect.height / 2;
      li.classList.remove('drop-above', 'drop-below');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isNaN(from)) return;
      // Spočítej finální index s ohledem na pozici kurzoru a směr přesunu.
      // Když přesouvám zezhora dolů a dropuji "above" target, target se posune
      // o jednu nahoru po splice → nemusíme adjustovat.
      let to = above ? idx : idx + 1;
      if (from < to) to -= 1; // splice z `from` před vložením posune target
      if (from !== to) reorderLevel(from, to);
    });

    ul.appendChild(li);
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

let _lastPreviewKey = null;
let _lastSelectedKey = null;
function renderEditor() {
  const form = $('edit-form');
  const empty = $('edit-empty');
  const idx = state.selectedIdx;
  if (idx < 0 || idx >= state.levels.length) {
    form.hidden = true;
    empty.hidden = false;
    if (_lastPreviewKey !== null) { _lastPreviewKey = null; schedulePreviewReload(); }
    _lastSelectedKey = null;
    return;
  }
  form.hidden = false;
  empty.hidden = true;
  const lvl = state.levels[idx];

  // Reset transient editor state když se přepíná na JINÝ level. Bez resetu by
  // beState (selectedBlockIdx, drag, paint mode flags) přetrval z předchozího
  // levelu → sidebar / cursor / drag-preview ukazují zombie data.
  if (_lastSelectedKey !== lvl.key) {
    if (typeof beState !== 'undefined' && beState) {
      beState.selectedBlockIdx = -1;
      beState.drag = null;
      beState.pxDragging = false;
      beState.beResizing = false;
      beState.pxRectStart = null;
      beState.pxRectEnd = null;
      beState.mousePx = null;
    }
    // Carrier layout: reset variant selector na první variantu pro current diff
    // (clRenderToolbar pak naplní podle reálných dat). Bez tohoto by zůstal
    // index z předchozího levelu, který může být out-of-range pro nový level.
    state.clActiveVariantIdx = -1;
    _lastSelectedKey = lvl.key;
  }

  $('f-key').value = lvl.key || '';
  $('f-label').value = lvl.label || '';
  $('f-type').value = lvl.type || 'relaxing';
  $('f-image-source').value = (lvl.image && lvl.image.source) || 'smiley';

  $('f-gravity-on').checked = !!lvl.gravity;

  // Rockets/Garage toggles odebrány — speciální tile se aktivuje v carrier
  // layoutu (drag rocket/garage dlaždice). lvl.rocketTargets / lvl.garage
  // zůstávají v datech jen pro legacy levely bez layoutu (nečteme je do formy).

  // Block editor render (canvas + palette + selected-block panel).
  if (!Array.isArray(lvl.blocks)) lvl.blocks = [];
  renderPaletteSection(lvl);
  beUpdatePixelToolbarVisibility();
  renderBlockCanvas();
  renderSelectedBlockPanel();

  // Carrier layout editor (Okruh XL) — per-difficulty variants.
  renderCarrierLayout(lvl);

  const diff = typeBadge(lvl);
  const badge = $('summary-badge');
  badge.textContent = diff.label;
  badge.className = 'diff-badge diff-' + diff.key;

  // Reload iframe only when the selected level actually changed — editing fields
  // on the same level triggers reload via autosave → schedulePreviewReload.
  if (_lastPreviewKey !== lvl.key) {
    _lastPreviewKey = lvl.key;
    schedulePreviewReload();
  }
}

function renderPaletteSection(lvl) {
  if (!lvl.activePalette) lvl.activePalette = BE_PALETTE_PRESETS[0].colors.slice();
  const presetsWrap = $('palette-presets');
  if (!presetsWrap) return;

  // Read-only palette-swatches odebrány — duplikovaly barvy z pt-colors
  // (pixel toolbar) a be-palette (block editor sidebar). Aktivní paleta
  // je vidět tam, kde je interaktivní.
  presetsWrap.innerHTML = '';
  BE_PALETTE_PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-preset-btn';
    btn.textContent = preset.label;
    if (JSON.stringify(lvl.activePalette) === JSON.stringify(preset.colors)) btn.classList.add('active');
    btn.addEventListener('click', () => {
      histPush(lvl, 'palette-preset-' + preset.key);
      lvl.activePalette = preset.colors.slice();
      markDirty();
      renderPaletteSection(lvl);
      beUpdatePixelPalette(lvl);
    });
    presetsWrap.appendChild(btn);
  });
}

// renderCarrierList odebrána — patřila k legacy garage toggle (f-garage-carriers).

// ═══════════════════════════════════════════════════════════════════════════
// CARRIER LAYOUT EDITOR — grid 7×rows tile painter + per-difficulty variants
// ═══════════════════════════════════════════════════════════════════════════
// Data model (v level):
//   lvl.carrierLayouts = [
//     { name, difficulty: 'easy'|'medium'|'hard', grid: [[tile,...7],...rows] }
//   ]
// tile = null | {type:'carrier',color:0..8} | {type:'wall'}
//      | {type:'garage', queue:[{color},...]} | {type:'rocket', color:0..8}
//
// UI state (session only, ne persistuje):
//   state.clActiveDiff = 'easy'|'medium'|'hard'
//   state.clActiveVariantIdx = index v lvl.carrierLayouts (-1 = žádná)
//   state.clTool = null | {kind:'null'|'wall'|'garage'|'carrier'|'rocket', color?}
const CL_COLS = 7;
const CL_MAX_ROWS = 7;
const CL_DIFFICULTIES = ['easy', 'medium', 'hard'];

function clEnsureState() {
  if (!state.clActiveDiff) state.clActiveDiff = 'easy';
  if (state.clActiveVariantIdx == null) state.clActiveVariantIdx = -1;
  // Default tool = 'select' (klik v gridu otevře inspector pro danou buňku).
  if (state.clTool === undefined) state.clTool = { kind: 'select' };
  if (state.clSelCell === undefined) state.clSelCell = null;
}
function clVariants(lvl) {
  if (!lvl || !Array.isArray(lvl.carrierLayouts)) return [];
  return lvl.carrierLayouts;
}
function clVariantsForDiff(lvl, diff) {
  return clVariants(lvl).filter(v => v && v.difficulty === diff);
}
function clActiveVariant(lvl) {
  clEnsureState();
  const all = clVariants(lvl);
  if (state.clActiveVariantIdx < 0 || state.clActiveVariantIdx >= all.length) return null;
  const v = all[state.clActiveVariantIdx];
  if (!v || v.difficulty !== state.clActiveDiff) return null;
  return v;
}
function clPickFirstVariantForDiff(lvl, diff) {
  const all = clVariants(lvl);
  for (let i = 0; i < all.length; i++) if (all[i] && all[i].difficulty === diff) return i;
  return -1;
}
function clBlankGrid(rows) {
  // Default = zed (blokáda). Designer pak pozitivně maluje carriers + případné tunely.
  // Dříve jsme inicializovali null, ale null = cestička, která aktivuje sousedy →
  // designer viděl ve hře všechny nosiče aktivní i bez prvního kliku. Zed je sémanticky
  // správný default pro „nic tady není, aktivace nepropouští".
  const g = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < CL_COLS; c++) row.push({ type: 'wall' });
    g.push(row);
  }
  return g;
}
function clDefaultVariantName(lvl, diff) {
  const existing = clVariantsForDiff(lvl, diff).map(v => v.name || '');
  const base = (lvl.key || 'lvl') + '-' + diff + '-v';
  for (let n = 1; n < 99; n++) if (!existing.includes(base + n)) return base + n;
  return base + Date.now();
}
function clResizeGrid(variant, newRows) {
  if (!variant || !Array.isArray(variant.grid)) return;
  const cur = variant.grid.length;
  if (newRows === cur) return;
  if (newRows < cur) {
    variant.grid = variant.grid.slice(0, newRows);
  } else {
    for (let r = cur; r < newRows; r++) {
      const row = [];
      for (let c = 0; c < CL_COLS; c++) row.push({ type: 'wall' });
      variant.grid.push(row);
    }
  }
}

function renderCarrierLayout(lvl) {
  clEnsureState();
  // Diff tabs: highlight active + vyznačit pin pro default complexity.
  const tabs = document.querySelectorAll('.cl-diff-tab');
  const defaultDiff = (lvl && lvl.defaultComplexity) || null;
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.diff === state.clActiveDiff);
  });
  // Pin state: is-default pro aktuálně pinutou complexity;
  // is-disabled pro complexity bez varianty (nemá smysl defaultovat na prázdno).
  document.querySelectorAll('.cl-diff-pin').forEach(pin => {
    const diff = pin.dataset.pin;
    const hasVariant = lvl && clVariantsForDiff(lvl, diff).length > 0;
    pin.classList.toggle('is-default', diff === defaultDiff && hasVariant);
    pin.classList.toggle('is-disabled', !hasVariant);
    if (diff === defaultDiff && hasVariant) {
      pin.title = 'výchozí complexity při načtení hry';
    } else if (!hasVariant) {
      pin.title = 'nejdřív vytvoř variantu pro tuto complexity';
    } else {
      pin.title = 'klik: nastavit jako výchozí při načtení';
    }
  });

  // Variant select
  const sel = $('cl-variant-select');
  const variants = clVariants(lvl);
  const forDiff = variants.map((v, i) => ({ v, i })).filter(x => x.v && x.v.difficulty === state.clActiveDiff);
  sel.innerHTML = '';
  if (!forDiff.length) {
    sel.disabled = true;
  } else {
    sel.disabled = false;
    forDiff.forEach(({ v, i }) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = v.name || ('varianta ' + i);
      if (i === state.clActiveVariantIdx) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // Ensure activeVariantIdx is valid for current difficulty.
  const activeV = clActiveVariant(lvl);
  if (!activeV) {
    // Pick first variant for current difficulty, if any.
    const idx = clPickFirstVariantForDiff(lvl, state.clActiveDiff);
    state.clActiveVariantIdx = idx;
  }
  const variant = clActiveVariant(lvl);

  // Action buttons
  $('cl-variant-rename').disabled = !variant;
  $('cl-variant-dup').disabled = !variant;
  $('cl-variant-delete').disabled = !variant;

  // Rows slider
  const rowsInput = $('cl-rows');
  const rowsVal = $('cl-rows-val');
  if (variant) {
    rowsInput.value = variant.grid.length;
    rowsVal.textContent = variant.grid.length;
    rowsInput.disabled = false;
  } else {
    rowsVal.textContent = '—';
    rowsInput.disabled = true;
  }

  // Empty vs editor
  const emptyEl = $('cl-empty');
  const edEl = $('cl-editor');
  const capEl = $('cl-capacity');
  if (!variant) {
    emptyEl.hidden = false;
    edEl.hidden = true;
    if (capEl) capEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  edEl.hidden = false;

  // Generator tlačítka — enable jen pokud máme pxCounts pro aktuální level/diff.
  const pxForGen = clGetStatsForCurrent(lvl);
  const genFill = $('cl-gen-fill');
  const genReset = $('cl-gen-reset');
  if (genFill) genFill.disabled = !pxForGen;
  if (genReset) genReset.disabled = !pxForGen;

  clRenderPalette();
  clRenderGrid(variant);
  clRenderCapacity(lvl, variant);
}

// Capacity helper — spočítá "needed vs slots" per barvu pro aktuální layout a
// statistiky z posledního runu hry (pxCounts per level × difficulty).
// Hra posílá do editoru `balloonbelt:level-stats` postMessage při startLevel.
const CL_PROJECTILES_PER_CARRIER = 40; // UPC(4) * PPU(10) — musí odpovídat game.js

function clCountLayoutSlotsByColor(variant) {
  const slots = new Array(BE_COLORS.length).fill(0);
  if (!variant || !Array.isArray(variant.grid)) return slots;
  for (const row of variant.grid) {
    if (!Array.isArray(row)) continue;
    for (const t of row) {
      if (!t) continue;
      if (t.type === 'carrier' && typeof t.color === 'number' && t.color >= 0 && t.color < BE_COLORS.length) {
        slots[t.color]++;
      } else if (t.type === 'garage' && Array.isArray(t.queue)) {
        // Garáž vyprazdňuje nosiče stejné barvy jako queue items — započítej je jako sloty.
        for (const q of t.queue) {
          if (q && typeof q.color === 'number' && q.color >= 0 && q.color < BE_COLORS.length) slots[q.color]++;
        }
      }
      // wall, null, rocket: nečítají jako barevné sloty pro pixely
    }
  }
  return slots;
}

// Lokální výpočet pxCounts (pixely obrazu + HP živých bloků), zrcadlí game.js
// countPixelsAndBlocks. Pro custom image spolehlivě — pixely jsou v lvl.image.pixels.
// Pro smiley/mondrian/... vrací null (ty generátory editor nezrcadlí, fallback
// na iframe postMessage). Solid blok vyčistí svůj footprint v gridu (pixely pod
// ním se do count nepřičtou); mystery blok footprint neruší.
function beComputeLocalPxCounts(lvl) {
  if (!lvl) return null;
  const src = lvl.image && lvl.image.source;
  if (src !== 'custom') return null;
  const pixels = lvl.image && lvl.image.pixels;
  if (!Array.isArray(pixels)) return null;
  const c = new Array(BE_COLORS.length).fill(0);
  // 1) Postav 2D grid z pixelů, pak vyčisti footprint solid bloků na -1.
  const grid = [];
  for (let y = 0; y < BE_IMG_GH; y++) {
    const row = new Array(BE_GW).fill(-1);
    const src = pixels[y];
    if (Array.isArray(src)) {
      for (let x = 0; x < BE_GW; x++) {
        const v = src[x];
        if (Number.isInteger(v) && v >= 0 && v < BE_COLORS.length) row[x] = v;
      }
    }
    grid.push(row);
  }
  const blocks = Array.isArray(lvl.blocks) ? lvl.blocks : [];
  for (const b of blocks) {
    if (b.kind === 'mystery') continue; // mystery footprint neruší pixely
    const w = Math.max(1, b.w | 0), h = Math.max(1, b.h | 0);
    const mask = beBlockMask(b.shape || 'rect', w, h);
    for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++) {
      if (!mask[ly][lx]) continue;
      const gx = (b.x | 0) + lx, gy = (b.y | 0) + ly;
      if (gy >= 0 && gy < BE_IMG_GH && gx >= 0 && gx < BE_GW) grid[gy][gx] = -1;
    }
  }
  // 2) Count pixely
  for (let y = 0; y < BE_IMG_GH; y++) for (let x = 0; x < BE_GW; x++) {
    const v = grid[y][x];
    if (v >= 0 && v < BE_COLORS.length) c[v]++;
  }
  // 3) Přičti HP živých bloků (solid k vlastní barvě, mystery proporčně).
  for (const b of blocks) {
    const hp = Math.max(1, b.hp | 0);
    if (b.kind === 'mystery') {
      const totalPx = c.reduce((a, v) => a + v, 0);
      if (totalPx > 0) {
        for (let i = 0; i < c.length; i++) if (c[i] > 0) c[i] += Math.ceil(hp * (c[i] / totalPx));
      } else {
        c[0] = (c[0] || 0) + hp;
      }
    } else {
      const col = b.color | 0;
      if (col >= 0 && col < c.length) c[col] += hp;
    }
  }
  return c;
}

function clGetStatsForCurrent(lvl) {
  // Primárně lokální výpočet — nezávislý na iframu, vždy odpovídá aktuálnímu
  // editor state (včetně čerstvě přebarvených bloků). Jen pro custom image;
  // pro smiley/mondrian atd. spadneme na iframe postMessage.
  const local = beComputeLocalPxCounts(lvl);
  if (local) return local;
  const bag = state.pxCountsByLevel;
  if (!bag || !lvl || !lvl.key) return null;
  const byDiff = bag[lvl.key];
  if (!byDiff) return null;
  // Primárně vrať data z aktivní obtížnosti. Fallback: libovolný diff, který je
  // k dispozici — pxCounts jsou invariantní vůči obtížnosti (určeny gridem a bloky),
  // takže pro capacity/generator stačí data z jakéhokoliv runu.
  if (byDiff[state.clActiveDiff]) return byDiff[state.clActiveDiff];
  for (const d of ['easy', 'medium', 'hard']) {
    if (byDiff[d]) return byDiff[d];
  }
  return null;
}

// Game-truth projectile totals per barva (sum carriers+garage po injekcích) pro aktuální diff.
// Na rozdíl od pxCounts tato hodnota závisí na difficulty (layout je per-diff), takže
// přednostně vrátí data z aktivní obtížnosti, fallback na jakoukoliv dostupnou.
function clGetProjCountsForCurrent(lvl) {
  const bag = state.projCountsByLevel;
  if (!bag || !lvl || !lvl.key) return null;
  const byDiff = bag[lvl.key];
  if (!byDiff) return null;
  if (byDiff[state.clActiveDiff]) return byDiff[state.clActiveDiff];
  for (const d of ['easy', 'medium', 'hard']) {
    if (byDiff[d]) return byDiff[d];
  }
  return null;
}

// Vrátí ze které obtížnosti data pochází (nebo null). Hodí se pro UI informaci.
function clGetStatsSourceDiff(lvl) {
  const bag = state.pxCountsByLevel;
  if (!bag || !lvl || !lvl.key) return null;
  const byDiff = bag[lvl.key];
  if (!byDiff) return null;
  if (byDiff[state.clActiveDiff]) return state.clActiveDiff;
  for (const d of ['easy', 'medium', 'hard']) {
    if (byDiff[d]) return d;
  }
  return null;
}

function clRenderCapacity(lvl, variant) {
  const wrap = $('cl-capacity');
  const body = $('cl-capacity-body');
  const hintEl = $('cl-capacity-hint');
  const statusEl = $('cl-capacity-status');
  if (!wrap || !body || !hintEl || !statusEl) return;

  const slots = clCountLayoutSlotsByColor(variant);
  const pxCounts = clGetStatsForCurrent(lvl);
  // projCounts = game-truth počet projektilů per barva ze hry (sum carriers+garage queue).
  // Když dorazilo, má přednost před slot-based odhadem — porovnáváme pixel-level.
  const projCounts = clGetProjCountsForCurrent(lvl);
  wrap.hidden = false;

  body.innerHTML = '';
  let worstStatus = 'ok'; // ok < warn < bad
  const rank = { ok: 0, warn: 1, bad: 2 };
  const bump = (s) => { if (rank[s] > rank[worstStatus]) worstStatus = s; };

  const problems = [];

  for (let c = 0; c < BE_COLORS.length; c++) {
    const need = pxCounts ? (pxCounts[c] | 0) : 0;
    const needSlots = need > 0 ? Math.ceil(need / CL_PROJECTILES_PER_CARRIER) : 0;
    const has = slots[c] | 0;
    const haveProj = projCounts ? (projCounts[c] | 0) : null;
    let status = 'ok';
    if (pxCounts) {
      if (haveProj !== null) {
        // Pixel-level game-truth check (autoritativní — přesně odráží co hra postavila).
        if (need > 0 && haveProj < need) {
          status = 'bad';
          problems.push('barva ' + c + ': ' + haveProj + '/' + need + ' px (chybí ' + (need - haveProj) + ')');
        } else if (need === 0 && haveProj > 0) {
          status = 'warn';
          problems.push('barva ' + c + ': ' + haveProj + ' projektilů bez pixelů');
        }
      } else {
        // Fallback slot-based check, dokud nedorazí projCounts z preview iframu.
        if (need > 0 && has === 0) { status = 'bad'; problems.push('barva ' + c + ': chybí nosiče (' + need + ' px)'); }
        else if (need > 0 && has < needSlots) { status = 'bad'; problems.push('barva ' + c + ': málo slotů (' + has + '/' + needSlots + ')'); }
        else if (need === 0 && has > 0) { status = 'warn'; problems.push('barva ' + c + ': přebytečné sloty (' + has + ' bez pixelů)'); }
      }
    } else {
      status = 'idle';
    }
    if (status !== 'idle') bump(status);

    if (pxCounts && need === 0 && has === 0 && (haveProj === null || haveProj === 0)) continue;

    const chip = document.createElement('div');
    chip.className = 'cl-cap-chip chip-' + status;
    const sw = document.createElement('span');
    sw.className = 'cl-cap-sw';
    sw.style.background = BE_COLORS[c];
    sw.textContent = String(c); // index barvy — odpovídá číslu v gridu (cl-cell)
    chip.appendChild(sw);
    const nums = document.createElement('span');
    nums.className = 'cl-cap-nums';
    const main = document.createElement('span');
    main.className = 'cl-cap-need';
    if (pxCounts && haveProj !== null) {
      main.textContent = haveProj + ' / ' + need + ' px';
      chip.title = 'barva ' + c + ': hra postavila ' + haveProj + ' projektilů, potřeba ' + need + ' px (' + has + ' slot(ů))';
    } else if (pxCounts) {
      main.textContent = has + ' / ' + needSlots;
      chip.title = 'barva ' + c + ': ' + need + ' px → potřeba ' + needSlots + ' nosič(ů), máš ' + has;
    } else {
      main.textContent = 'sloty: ' + has;
      chip.title = 'barva ' + c + ': ' + has + ' slot(ů) v layoutu';
    }
    nums.appendChild(main);
    if (pxCounts && need > 0) {
      const sub = document.createElement('span');
      sub.className = 'cl-cap-sub';
      if (haveProj !== null) {
        sub.textContent = has + ' nos · ' + Math.ceil(need / CL_PROJECTILES_PER_CARRIER) + ' min';
      } else {
        const perSlot = has > 0 ? Math.ceil(need / has) : 0;
        sub.textContent = need + ' px' + (has > 0 ? (' · ' + perSlot + '/nos') : '');
      }
      nums.appendChild(sub);
    }
    chip.appendChild(nums);
    body.appendChild(chip);
  }

  // Total řádek — součet napříč všemi barvami (pixelů vs projektilů).
  if (pxCounts) {
    let totalNeed = 0, totalHave = 0;
    for (let c = 0; c < BE_COLORS.length; c++) {
      totalNeed += (pxCounts[c] | 0);
      if (projCounts) totalHave += (projCounts[c] | 0);
    }
    const totalChip = document.createElement('div');
    totalChip.className = 'cl-cap-chip chip-' + (projCounts ? (totalHave < totalNeed ? 'bad' : 'ok') : 'idle');
    totalChip.style.flexBasis = '100%';
    const tNums = document.createElement('span');
    tNums.className = 'cl-cap-nums';
    const tMain = document.createElement('span');
    tMain.className = 'cl-cap-need';
    if (projCounts) {
      tMain.textContent = 'celkem: ' + totalHave + ' / ' + totalNeed + ' proj.';
      totalChip.title = 'Celkem projektilů napříč barvami: hra postavila ' + totalHave + ' / potřeba ' + totalNeed;
    } else {
      tMain.textContent = 'celkem potřeba: ' + totalNeed + ' proj.';
      totalChip.title = 'Celkem pixelů/HP k rozbití: ' + totalNeed + ' (projCounts ještě nedorazil z preview)';
    }
    tNums.appendChild(tMain);
    totalChip.appendChild(tNums);
    body.appendChild(totalChip);
  }

  // Banner: kombinuje PIN status (co hra zvolí jako výchozí při startu)
  // a APPLIED status (jestli hra layout přijala v preview iframe).
  // Závažnost se odvíjí od toho, jestli koukáme na pinnutou complexity.
  // — pinnutý + applied=true → zelený („live")
  // — pinnutý + applied=false → ČERVENÝ (kritická chyba — hra by spadla na auto-gen)
  // — nepinnutý + applied=true → modro-žlutý info („alternativa pro switch")
  // — nepinnutý + applied=false → žlutý warning (alternativa s problémem,
  //   ale nezasahuje startup hry)
  // — žádný pin → oranžový (designer musí vybrat default)
  const bannerEl = $('cl-layout-banner');
  if (bannerEl) {
    const pinnedDiff = lvl && lvl.defaultComplexity;
    const currentDiff = state.clActiveDiff;
    const stBag = state.layoutStatusByLevel[lvl && lvl.key];
    const st = stBag ? stBag[currentDiff] : null;
    const isPinnedTab = pinnedDiff === currentDiff;
    // Spočítáme PRO TENTO konkrétní variant: kolik má carrier/rocket/garage
    // slotů. Prázdná varianta (žádné dlaždice, jen walls) je nepoužitelná.
    const selectedVariantName = variant && variant.name;
    let selectedSlotCount = 0;
    if (variant && Array.isArray(variant.grid)) {
      for (const row of variant.grid) {
        if (!Array.isArray(row)) continue;
        for (const t of row) {
          if (!t) continue;
          if (t.type === 'carrier' || t.type === 'rocket') selectedSlotCount++;
          else if (t.type === 'garage' && Array.isArray(t.queue)) selectedSlotCount += t.queue.length;
        }
      }
    }
    // Varianty pro CURRENT diff a pro PINNED diff — data-driven check, ne
    // závislé na runtime statusu (ten může být stale po smazání variant).
    const layoutsAll = Array.isArray(lvl && lvl.carrierLayouts) ? lvl.carrierLayouts : [];
    const sameDiffVariants = layoutsAll.filter(v => v && v.difficulty === currentDiff);
    const pinnedDiffVariants = pinnedDiff ? layoutsAll.filter(v => v && v.difficulty === pinnedDiff) : [];
    const altCount = Math.max(0, sameDiffVariants.length - 1);
    const altNote = altCount > 0
      ? ' Pozor: pro tuto complexity je celkem ' + sameDiffVariants.length + ' variant — hra si mezi nimi při startu náhodně vybírá.'
      : '';

    if (!pinnedDiff) {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-orange';
      bannerEl.textContent = '⚠ Žádná výchozí complexity není nastavená. Klikni na 📍 u jedné z complexity karet, ať hra ví, kterou má použít při startu.';
    } else if (isPinnedTab && pinnedDiffVariants.length === 0) {
      // Pin je na této complexity, ale neexistuje pro ni žádná varianta.
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-bad';
      bannerEl.textContent = '⚠ Pin je na této complexity, ale neexistuje pro ni žádná varianta. Hra spadne na auto-gen. Vytvoř variantu (+ nová) nebo přepni pin jinam.';
    } else if (variant && selectedSlotCount === 0) {
      // Aktuálně vybraná varianta je prázdná.
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-bad';
      bannerEl.textContent = '⚠ Vybraná varianta „' + selectedVariantName + '" je PRÁZDNÁ (žádné carrier/rocket/garage sloty). Hra ji odmítne a spadne na auto-gen.' + altNote;
    } else if (!isPinnedTab && pinnedDiffVariants.length === 0) {
      // Pin míří na jinou complexity, ale ta nemá variantu → hra stejně spadne.
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-bad';
      bannerEl.textContent = '⚠ Pin je na complexity „' + pinnedDiff + '", ale ta nemá žádnou variantu. Hra při startu spadne na auto-gen. Vytvoř variantu pro „' + pinnedDiff + '" nebo přepni pin sem.';
    } else if (isPinnedTab && st && st.applied === false) {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-bad';
      bannerEl.textContent = '⚠ Pin je na této complexity, ale hra layout NEpoužila — spadla na auto-gen. Důvod: ' + (st.reason || 'neznámý') + '.' + altNote;
    } else if (isPinnedTab && st && st.applied === true) {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-ok';
      const usedName = st.layoutName || selectedVariantName || '?';
      const sameAsSelected = !selectedVariantName || usedName === selectedVariantName;
      bannerEl.textContent = '✓ Tato complexity je výchozí (pin). Hra při startu '
        + (sameAsSelected
          ? 'použije tento layout (' + usedName + ').'
          : 'právě teď zvolila layout „' + usedName + '" (vybraná v editoru je „' + selectedVariantName + '").')
        + altNote;
    } else if (isPinnedTab) {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-ok';
      bannerEl.textContent = '✓ Tato complexity je výchozí (pin). (Otevři preview pro ověření, že hra layout přijala.)' + altNote;
    } else if (st && st.applied === false) {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-warn';
      bannerEl.textContent = 'ℹ️ Alternativa pro complexity „' + currentDiff + '" — hra startuje na pinu „' + pinnedDiff + '". Tahle varianta má ale chybu (' + (st.reason || 'neznámý') + '), po přepnutí by ji hra odmítla.' + altNote;
    } else {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-warn';
      bannerEl.textContent = 'ℹ️ Alternativa pro complexity „' + currentDiff + '". Hra startuje na pinu „' + pinnedDiff + '" — tato varianta se použije, jen když hráč přepne complexity.' + altNote;
    }
  }

  // Status pill
  if (!pxCounts) {
    statusEl.className = 'cl-capacity-status status-idle';
    statusEl.textContent = 'čeká na data';
    hintEl.className = 'cl-capacity-hint';
    hintEl.textContent = 'Otevři náhled hry (pravý panel) — po startu levelu se načtou reálné počty pixelů a hláška zmizí.';
  } else if (worstStatus === 'bad') {
    statusEl.className = 'cl-capacity-status status-bad';
    statusEl.textContent = 'nehratelné';
    hintEl.className = 'cl-capacity-hint hint-bad';
    hintEl.textContent = problems.join(' · ');
  } else if (worstStatus === 'warn') {
    statusEl.className = 'cl-capacity-status status-warn';
    statusEl.textContent = 'přebytek';
    hintEl.className = 'cl-capacity-hint hint-warn';
    hintEl.textContent = problems.join(' · ') + ' — layout funguje, ale dodá zbytečné nosiče.';
  } else {
    statusEl.className = 'cl-capacity-status status-ok';
    statusEl.textContent = 'ok';
    hintEl.className = 'cl-capacity-hint';
    hintEl.textContent = 'Všechny barvy pokryté. Kliknutí do hry vlevo / přeběh do hard režimu aktualizuje čísla.';
  }

  // Když používáme data z jiné obtížnosti, přidej poznámku.
  const srcDiff = clGetStatsSourceDiff(lvl);
  if (pxCounts && srcDiff && srcDiff !== state.clActiveDiff) {
    const extra = ' (data z ' + srcDiff + ' — pxCounts jsou stejné pro všechny obtížnosti)';
    hintEl.textContent = hintEl.textContent + extra;
  }
}

// Generator rozložení — napodobuje game.js auto-gen:
//   easy   → frequent-first, round-robin pro variety, mírné shuffle uvnitř řádků
//   medium → full shuffle (chaotické rozložení)
//   hard   → frequent-first v layerech, rare barvy spadnou až do spodních řad
// Vždy respektuje user-set počet řádků (rows slider). Volné sloty = null (průchody).
// Mode: 'fill' = doplní jen null tiles (zachová carrier/wall/garage/rocket),
//       'reset' = vyprázdní grid a naplní znovu.
function clGenerateLayout(variant, pxCounts, mode) {
  if (!variant || !pxCounts) return false;
  const rows = variant.grid.length;
  const cols = CL_COLS;
  if (!rows) return false;
  const diff = state.clActiveDiff;

  // 1) Zachovat existující tiles (fill mode) nebo vyprázdnit (reset).
  //    V novém modelu: wall = default "prázdno", takže ho generator smí přepsat
  //    (považujeme ho za dostupný slot). Uživatelská intent = carrier/rocket/garage/null-tunel.
  const preserve = mode !== 'reset';
  const grid = variant.grid;
  const occupied = new Set();
  const alreadyByColor = new Array(BE_COLORS.length).fill(0);
  if (preserve) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r] && grid[r][c];
        if (!t) continue;
        // Wall = default blank → volné pro generator, neblokuj ho
        if (t.type === 'wall' || t.wall === true) continue;
        occupied.add(r + ',' + c);
        if (t.type === 'carrier' && typeof t.color === 'number') alreadyByColor[t.color]++;
        if (t.type === 'garage' && Array.isArray(t.queue)) {
          for (const q of t.queue) if (q && typeof q.color === 'number') alreadyByColor[q.color]++;
        }
      }
    }
  } else {
    // Reset: vyprázdni do walls (default blank), ne null.
    for (let r = 0; r < rows; r++) {
      grid[r] = new Array(cols).fill(null).map(() => ({ type: 'wall' }));
    }
  }

  // 2) Kolik carrier slotů per barva ještě potřebujeme (minimum = ceil(px/40) - už_umístěno).
  const needByColor = new Array(BE_COLORS.length).fill(0);
  for (let c = 0; c < BE_COLORS.length; c++) {
    const px = pxCounts[c] | 0;
    if (px <= 0) continue;
    const minSlots = Math.ceil(px / CL_PROJECTILES_PER_CARRIER);
    needByColor[c] = Math.max(0, minSlots - alreadyByColor[c]);
  }
  let totalNeeded = needByColor.reduce((a, b) => a + b, 0);
  const freeSlots = rows * cols - occupied.size;
  if (totalNeeded === 0) return true;

  // Scale down pokud se nevejde (zachovej min 1 per potřebnou barvu dokud to jde).
  if (totalNeeded > freeSlots) {
    while (totalNeeded > freeSlots) {
      let idx = -1, max = 1;
      for (let c = 0; c < needByColor.length; c++) {
        if (needByColor[c] > max) { max = needByColor[c]; idx = c; }
      }
      if (idx < 0) break;
      needByColor[idx]--;
      totalNeeded--;
    }
  }

  // 3) Postav queue barev podle difficulty (diff-aware ordering).
  let queue = [];
  for (let c = 0; c < needByColor.length; c++) {
    for (let i = 0; i < needByColor[c]; i++) queue.push(c);
  }

  // Helper: round-robin podle frekvence (frequent-first) — zabrání klastrům stejné barvy.
  const roundRobinByFreq = (arr) => {
    const byColor = {};
    for (const c of arr) (byColor[c] = byColor[c] || []).push(c);
    const keys = Object.keys(byColor).map(Number).sort((a, b) => byColor[b].length - byColor[a].length);
    const out = [];
    while (out.length < arr.length) {
      let progressed = false;
      for (const k of keys) {
        if (byColor[k].length) { out.push(byColor[k].shift()); progressed = true; if (out.length === arr.length) break; }
      }
      if (!progressed) break;
    }
    return out;
  };

  if (diff === 'easy') {
    // Easy: časté barvy nahoru (proxy za "avail + shallow depth" z game.js), round-robin
    // pro variety, pak mírné lokální zamíchání — hráč má krátké cesty, ne repetitivní klastry.
    queue = roundRobinByFreq(queue);
    // Mírný jitter: pro každou pozici s 50% pravdepodobnosti swap se sousedem ±1
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.max(0, Math.min(queue.length - 1, i + Math.floor((Math.random() - 0.5) * 3)));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  } else if (diff === 'hard') {
    // Hard: layered ordering — frequent-first (layer 0), rare poslední. Row-major fill
    // položí rare na konec queue → skončí ve spodních řadách (deep-layer, víc "kopání").
    queue = roundRobinByFreq(queue);
    // Žádný jitter — striktní progression dává hráči signal "rare je dole".
  } else {
    // Medium: plný Fisher-Yates shuffle — chaotický mix.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  }

  // 4) Volné pozice, seskupené podle řádku. Pořadí určuje, kam pozice v queue přistane.
  const byRow = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occupied.has(r + ',' + c)) (byRow[r] = byRow[r] || []).push({ r, c });
    }
  }
  const rowKeys = Object.keys(byRow).map(Number).sort((a, b) => a - b);
  const shuffleArr = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  // Uvnitř každé řady zamíchej sloupce (aby výběr buněk v řadě byl náhodný).
  rowKeys.forEach(r => shuffleArr(byRow[r]));

  // 5) Alokuj kolik carrierů jde do každé řady (stratifikace).
  //    - medium: rovnoměrně + mírná jitter (kvazi-náhodné rozložení, ale pokryje celý grid)
  //    - easy: top-biased (weights klesající lineárně) — frekventované barvy nahoru,
  //            ale spodní řády taky dostanou něco (aktivní plocha, cestičky)
  //    - hard: rovnoměrně stratifikováno — queue má frekvent→rare, a každá řada dostane
  //            svůj chunk, takže rare (konec queue) skončí ve spodních řádcích
  const perRow = new Array(rowKeys.length).fill(0);
  const cap = rowKeys.map(r => byRow[r].length); // max kapacita per řada

  const allocateByWeights = (weights) => {
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    let remaining = queue.length;
    for (let i = 0; i < rowKeys.length; i++) {
      perRow[i] = Math.min(cap[i], Math.round(queue.length * weights[i] / totalW));
      remaining -= perRow[i];
    }
    // Korekce zaokrouhlení — nalij/odeber postupně od řádku s nejvyšší weight dolů.
    const order = rowKeys.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
    let guard = 0;
    while (remaining !== 0 && guard++ < 1000) {
      let changed = false;
      for (const i of order) {
        if (remaining > 0 && perRow[i] < cap[i]) { perRow[i]++; remaining--; changed = true; }
        else if (remaining < 0 && perRow[i] > 0) { perRow[i]--; remaining++; changed = true; }
        if (remaining === 0) break;
      }
      if (!changed) break;
    }
  };

  if (diff === 'easy') {
    // Weights: linear 1..N, top nejvyšší (např. 7 rows → [7,6,5,4,3,2,1])
    allocateByWeights(rowKeys.map((_, i) => rowKeys.length - i));
  } else if (diff === 'hard') {
    // Rovnoměrně = stejná weight per řada. Rare barvy (konec queue) přistanou dole.
    allocateByWeights(rowKeys.map(() => 1));
  } else {
    // medium: rovnoměrně + jitter (každá řada dostane +-1 náhodně)
    allocateByWeights(rowKeys.map(() => 1 + Math.random() * 0.4));
  }

  // 6) Medium potřebuje náhodné pořadí queue → pozice v rámci každé řady i přes řady.
  //    Pro easy/hard zachováváme queue ordering: queue[0..perRow[0]-1] → řada 0 (top),
  //    queue[next chunk] → řada 1, ...  takže frekvent nahoru, rare dolů.
  const placements = [];
  if (diff === 'medium') {
    // Shuffle queue + shuffle všechny vybrané pozice → plný chaos.
    const allSelected = [];
    for (let i = 0; i < rowKeys.length; i++) {
      const cells = byRow[rowKeys[i]];
      for (let k = 0; k < perRow[i]; k++) allSelected.push(cells[k]);
    }
    shuffleArr(allSelected);
    const qShuffled = queue.slice();
    shuffleArr(qShuffled);
    for (let i = 0; i < qShuffled.length && i < allSelected.length; i++) {
      placements.push({ color: qShuffled[i], pos: allSelected[i] });
    }
  } else {
    // easy/hard: mapuj queue chunks → řádky v pořadí.
    let qIdx = 0;
    for (let i = 0; i < rowKeys.length; i++) {
      const cells = byRow[rowKeys[i]];
      for (let k = 0; k < perRow[i] && qIdx < queue.length; k++) {
        placements.push({ color: queue[qIdx], pos: cells[k] });
        qIdx++;
      }
    }
  }

  // 7) Zapiš carriers do gridu. V hard/medium označ část nosičů jako `hidden:true`
  //    (= ve hře se zobrazí jako ? dokud nejsou aktivní). Rate odpovídá herní hodnotě
  //    (game.js:1799 hr: easy=0, medium=0.45, hard=0.8), skip top row. Tím je editor
  //    deterministický — designer vidí přesně, které buňky budou `?`, a může je
  //    přepnout ručně v inspectoru.
  const hiddenRate = diff === 'hard' ? 0.8 : diff === 'medium' ? 0.45 : 0;
  const placedKeys = new Set();
  for (const p of placements) {
    const carrier = { type: 'carrier', color: p.color };
    if (hiddenRate > 0 && p.pos.r > 0 && Math.random() < hiddenRate) {
      carrier.hidden = true;
    }
    grid[p.pos.r][p.pos.c] = carrier;
    placedKeys.add(p.pos.r + ',' + p.pos.c);
  }

  // 8) Leftover volné buňky → VŠECHNY na wall. Default chování = aktivní jen horní řada
  //    a progresivní prokopávání sloupců dolů (klasický dig-down model). Pokud designer
  //    chce honeycomb / cestičky, maluje je manuálně paletou „∅" po vygenerování.
  if (!preserve) {
    for (let i = 0; i < rowKeys.length; i++) {
      for (const cell of byRow[rowKeys[i]]) {
        if (!placedKeys.has(cell.r + ',' + cell.c)) {
          grid[cell.r][cell.c] = { type: 'wall' };
        }
      }
    }
  }

  // 9) Solvability repair: hráč musí mít cestu ke KAŽDÉMU carrierovi. Pokud generátor
  //    uzavřel některé do ostrova z walls, otevřeme minimální tunel (převedeme walls
  //    na null po nejkratší cestě k reachable regionu). Null přidáme JEN tam, kde je
  //    to nevyhnutelné — designer uvidí jasně, kde byl grid „špatný".
  clRepairUnreachable(variant);
  return true;
}

function clRepairUnreachable(variant) {
  const rows = variant.grid.length;
  const cols = CL_COLS;
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
  for (let iter = 0; iter < 50; iter++) {
    const reach = clReachability(variant);
    // Najdi první unreachable carrier/rocket/garage.
    let target = null;
    for (let r = 0; r < rows && !target; r++) {
      for (let c = 0; c < cols; c++) {
        const t = variant.grid[r][c];
        if (!t) continue;
        if ((t.type === 'carrier' || t.type === 'rocket' || t.type === 'garage') && !reach[r][c]) {
          target = { r, c }; break;
        }
      }
    }
    if (!target) return;

    // BFS z targetu ven skrz JAKOUKOLIV buňku (včetně walls) — najdeme parent tree
    // až narazíme na reachable cell. Pak otočíme a otevřeme walls na cestě.
    const parent = new Map();
    const seen = new Set();
    const startKey = target.r + ',' + target.c;
    seen.add(startKey);
    const q = [target];
    let found = null;
    while (q.length) {
      const cur = q.shift();
      if (reach[cur.r][cur.c] && (cur.r !== target.r || cur.c !== target.c)) { found = cur; break; }
      for (const [dr, dc] of DIRS) {
        const nr = cur.r + dr, nc = cur.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const k = nr + ',' + nc;
        if (seen.has(k)) continue;
        seen.add(k);
        parent.set(k, cur.r + ',' + cur.c);
        q.push({ r: nr, c: nc });
      }
    }
    if (!found) return; // celý grid unreachable (row 0 is all walls) — nic neopravíme

    // Zpětná cesta: wall na cestě → null (otevři tunel). Carriery/rockety necháme.
    let cur = found.r + ',' + found.c;
    const targetKey = target.r + ',' + target.c;
    while (cur && cur !== targetKey) {
      const [pr, pc] = cur.split(',').map(Number);
      const t = variant.grid[pr][pc];
      if (t && (t.type === 'wall' || t.wall === true)) {
        variant.grid[pr][pc] = null;
      }
      cur = parent.get(cur);
    }
  }
}

// Relevantní barvy pro aktuální level = sjednocení:
//   (a) barev přítomných v obraze / blocích (pxCounts > 0)
//   (b) barev již použitých v aktuální variantě carrier gridu (aby uživatel
//       nepřišel o přístup k barvě, kterou má v gridu a chce ji odebrat/změnit,
//       i když mezitím zmizela z obrazu).
// Vrací Set čísel (0..63). Když nelze nic odvodit (smiley/mondrian bez pxCounts
// a prázdný grid), vrátí null → palette zobrazí všechny barvy jako fallback.
function clRelevantColors(lvl) {
  const set = new Set();
  const px = (typeof beComputeLocalPxCounts === 'function') ? beComputeLocalPxCounts(lvl) : null;
  if (px && Array.isArray(px)) {
    for (let i = 0; i < px.length; i++) if (px[i] > 0) set.add(i);
  } else if (lvl && lvl.key && state.pxCountsByLevel && state.pxCountsByLevel[lvl.key]) {
    const c = state.pxCountsByLevel[lvl.key];
    for (let i = 0; i < c.length; i++) if (c[i] > 0) set.add(i);
  }
  const v = clActiveVariant(lvl);
  if (v && Array.isArray(v.grid)) {
    for (const row of v.grid) {
      if (!Array.isArray(row)) continue;
      for (const t of row) {
        if (!t) continue;
        if (typeof t.color === 'number') set.add(t.color | 0);
        if (Array.isArray(t.queue)) {
          for (const q of t.queue) if (q && typeof q.color === 'number') set.add(q.color | 0);
        }
      }
    }
  }
  return set.size ? set : null;
}

function clRenderPalette() {
  const pal = $('cl-palette');
  if (!pal) return;
  pal.innerHTML = '';
  const lvl = beCurrentLvl();
  const relevant = clRelevantColors(lvl);
  const items = [];
  items.push({ kind: 'select', label: '◎' });
  items.push({ kind: 'wall', label: '▦' });     // zeď = default blank, blokuje aktivaci
  items.push({ kind: 'null', label: '∅' });      // tunel = propouští aktivaci (honeycomb)
  items.push({ kind: 'garage', label: '🏠' });
  items.push({ kind: 'hidden', label: '?' });
  const colorFilter = (c) => !relevant || relevant.has(c);
  for (let c = 0; c < BE_COLORS.length; c++) if (colorFilter(c)) items.push({ kind: 'carrier', color: c });
  for (let c = 0; c < BE_COLORS.length; c++) if (colorFilter(c)) items.push({ kind: 'rocket', color: c });

  const makeKey = (tool) => tool ? (tool.kind + (tool.color != null ? ':' + tool.color : '')) : '';
  const activeKey = makeKey(state.clTool);

  items.forEach(it => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cl-palette-item tile-' + it.kind;
    if (it.color != null) btn.style.background = BE_COLORS[it.color];
    // Čitelné tooltipy — vysvětlují sémantiku null vs wall.
    const titles = {
      select: 'select — klik na buňku = výběr + inspector, NEmaluje',
      wall: 'zeď — default prázdná plocha. Blokuje aktivaci nosičů v okolí.',
      null: 'tunel (∅) — propouští aktivaci. Nosič se sousedním tunelem je aktivní.',
      garage: 'garáž — zamčený zdroj, vydává nosiče až když má volný přístup',
      hidden: '? — toggle "skrytá barva" (klik na existující carrier přepne hidden flag)',
      carrier: 'carrier barva ' + (it.color != null ? it.color : ''),
      rocket: 'rocket barva ' + (it.color != null ? it.color : ''),
    };
    btn.title = titles[it.kind] || (it.kind + (it.color != null ? ' ' + it.color : ''));
    if (it.kind === 'carrier') btn.textContent = String(it.color);
    if (it.kind === 'hidden') btn.textContent = '?';
    if (makeKey(it) === activeKey) btn.classList.add('active');
    btn.addEventListener('click', () => {
      state.clTool = (it.kind === 'carrier' || it.kind === 'rocket')
        ? { kind: it.kind, color: it.color }
        : { kind: it.kind };
      clRenderPalette();
      updateToolHint();
    });
    pal.appendChild(btn);
  });
  updateToolHint();

  function updateToolHint() {
    const hint = $('cl-tool-hint');
    if (!hint) return;
    if (!state.clTool) { hint.textContent = 'vyber nástroj z palety'; return; }
    const t = state.clTool;
    const desc = t.kind === 'select' ? 'select (klik v gridu = výběr + inspector)'
      : t.kind === 'carrier' ? ('carrier barva ' + t.color)
      : t.kind === 'rocket' ? ('rocket barva ' + t.color)
      : t.kind === 'wall' ? 'zeď (default prázdno — blokuje aktivaci)'
      : t.kind === 'garage' ? 'garáž (klik = vybrat, pak edituj queue v panelu)'
      : t.kind === 'hidden' ? 'hidden toggle (klik na carrier = přepne ? skrytou barvu)'
      : 'tunel ∅ (propouští aktivaci — pro honeycomb cestičky)';
    hint.textContent = 'nástroj: ' + desc;
  }
}

// BFS reachability: najde carriers/rockets, které nemají žádnou cestu (přes jiné
// non-wall buňky) do horní řady. Hra aktivuje carrier, když má null souseda nebo je
// v row 0; player postupně odkopává a odhaluje další. Walls jsou permanentní blokáda,
// takže buňka v regionu obklopeném samými walls je unreachable.
function clReachability(variant) {
  const rows = variant.grid.length;
  const cols = CL_COLS;
  const reach = [];
  for (let r = 0; r < rows; r++) reach.push(new Array(cols).fill(false));
  const isBlock = (r, c) => {
    const t = variant.grid[r][c];
    return !!(t && (t.type === 'wall' || t.wall === true));
  };
  const q = [];
  // Start: všechny non-wall buňky v row 0 (top-edge je „otevřený" per honeycomb pravidla).
  for (let c = 0; c < cols; c++) {
    if (!isBlock(0, c)) { reach[0][c] = true; q.push([0, c]); }
  }
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
  while (q.length) {
    const [r, c] = q.shift();
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (reach[nr][nc]) continue;
      if (isBlock(nr, nc)) continue;
      reach[nr][nc] = true;
      q.push([nr, nc]);
    }
  }
  return reach;
}

// Spočítá unreachable carriers/rockets ve variantě. 0 = vše OK.
function clCountUnreachable(variant) {
  if (!variant || !variant.grid || !variant.grid.length) return 0;
  const reach = clReachability(variant);
  let count = 0;
  for (let r = 0; r < variant.grid.length; r++) {
    for (let c = 0; c < CL_COLS; c++) {
      const t = variant.grid[r][c];
      if (!t) continue;
      if ((t.type === 'carrier' || t.type === 'rocket' || t.type === 'garage') && !reach[r][c]) count++;
    }
  }
  return count;
}

function clRenderGrid(variant) {
  const g = $('cl-grid');
  if (!g) return;
  g.innerHTML = '';
  const rows = variant.grid.length;
  g.style.gridTemplateRows = 'repeat(' + rows + ', 48px)';
  const sel = state.clSelCell;
  const reach = clReachability(variant);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < CL_COLS; c++) {
      const t = variant.grid[r] && variant.grid[r][c];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cl-cell ' + clTileClass(t);
      if (sel && sel.r === r && sel.c === c) btn.classList.add('tile-selected');
      btn.dataset.r = String(r);
      btn.dataset.c = String(c);
      if (t && (t.type === 'carrier' || t.type === 'rocket') && typeof t.color === 'number') {
        btn.style.background = BE_COLORS[t.color];
      }
      if (t && t.type === 'carrier') {
        btn.textContent = String(t.color);
      }
      if (t && (t.type === 'carrier' || t.type === 'rocket') && t.hidden === true) {
        btn.classList.add('tile-hidden');
        const q = document.createElement('span');
        q.className = 'cl-cell-hidden';
        q.textContent = '?';
        btn.appendChild(q);
      }
      // Unreachable marker: carrier/rocket/garage bez cesty k top row.
      if (t && (t.type === 'carrier' || t.type === 'rocket' || t.type === 'garage') && !reach[r][c]) {
        btn.classList.add('tile-unreachable');
        btn.title = (btn.title || '') + ' ⚠ nedostupný (obklopený zdmi)';
      }
      // garage queue count badge
      if (t && t.type === 'garage' && Array.isArray(t.queue) && t.queue.length) {
        const badge = document.createElement('span');
        badge.className = 'cl-cell-badge';
        badge.textContent = String(t.queue.length);
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => clOnCellClick(r, c));
      g.appendChild(btn);
    }
  }
  clRenderInspector(variant);
}

function clRenderInspector(variant) {
  const wrap = $('cl-inspector');
  const body = $('cl-inspector-body');
  const coord = $('cl-inspector-coord');
  if (!wrap || !body) return;
  const sel = state.clSelCell;
  if (!sel || !variant) { wrap.hidden = true; body.innerHTML = ''; coord.textContent = ''; return; }
  const t = variant.grid[sel.r] && variant.grid[sel.r][sel.c];
  coord.textContent = '(row ' + sel.r + ', col ' + sel.c + ')';
  body.innerHTML = '';
  wrap.hidden = false;

  if (!t) {
    body.innerHTML = '<div class="cl-hint">prázdno — hráč může procházet. Použij paletu pro přemalování.</div>';
    return;
  }
  if (t.type === 'wall' || t.wall) {
    body.innerHTML = '<div class="cl-hint">wall — pasivní překážka. Použij paletu pro přemalování.</div>';
    return;
  }
  if (t.type === 'carrier' || t.type === 'rocket') {
    const title = document.createElement('div');
    title.className = 'cl-hint';
    title.textContent = (t.type === 'carrier' ? 'carrier' : 'rocket') + ' — klik barvu pro změnu';
    body.appendChild(title);
    const picker = document.createElement('div');
    picker.className = 'cl-insp-color-picker';
    for (let c = 0; c < BE_COLORS.length; c++) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'cl-csw' + (t.color === c ? ' active' : '');
      sw.style.background = BE_COLORS[c];
      sw.title = 'color ' + c;
      sw.addEventListener('click', () => {
        if (t.color === c) return;
        const lvl = beCurrentLvl();
        histPush(lvl, 'cl-insp-color');
        t.color = c;
        markDirty();
        renderCarrierLayout(lvl);
      });
      picker.appendChild(sw);
    }
    body.appendChild(picker);
    // Hidden toggle — carrier/rocket s `hidden:true` se ve hře zobrazí jako "?" dokud
    // se nestane aktivním (propagace přes prokopání).
    const hiddenRow = document.createElement('label');
    hiddenRow.className = 'cl-insp-hidden';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.hidden === true;
    cb.addEventListener('change', () => {
      const lvl = beCurrentLvl();
      histPush(lvl, 'cl-insp-hidden');
      t.hidden = cb.checked;
      markDirty();
      renderCarrierLayout(lvl);
    });
    hiddenRow.appendChild(cb);
    const lbl = document.createElement('span');
    lbl.textContent = 'skrytá barva (? dokud se neprokopává)';
    hiddenRow.appendChild(lbl);
    body.appendChild(hiddenRow);
    return;
  }
  if (t.type === 'garage') {
    const title = document.createElement('div');
    title.className = 'cl-hint';
    title.textContent = 'garage queue (' + (t.queue || []).length + ' nosič' + ((t.queue || []).length === 1 ? '' : 'ů') + ')';
    body.appendChild(title);
    const row = document.createElement('div');
    row.className = 'cl-insp-queue';
    (t.queue || []).forEach((q, idx) => {
      const chip = document.createElement('div');
      chip.className = 'cl-insp-queue-chip';
      const num = document.createElement('span');
      num.className = 'cl-chip-num';
      num.textContent = String(idx + 1);
      chip.appendChild(num);
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'cl-chip-swatch';
      sw.style.background = BE_COLORS[q.color || 0];
      sw.title = 'klik pro cyklus barvy';
      sw.addEventListener('click', () => {
        const lvl = beCurrentLvl();
        histPush(lvl, 'cl-queue-color-' + idx);
        q.color = ((q.color || 0) + 1) % BE_COLORS.length;
        markDirty();
        renderCarrierLayout(lvl);
      });
      chip.appendChild(sw);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = 'odebrat';
      rm.addEventListener('click', () => {
        const lvl = beCurrentLvl();
        histPush(lvl, 'cl-queue-del-' + idx);
        t.queue.splice(idx, 1);
        markDirty();
        renderCarrierLayout(lvl);
      });
      chip.appendChild(rm);
      row.appendChild(chip);
    });
    body.appendChild(row);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-small';
    addBtn.textContent = '+ nosič';
    addBtn.addEventListener('click', () => {
      const lvl = beCurrentLvl();
      histPush(lvl, 'cl-queue-add');
      if (!Array.isArray(t.queue)) t.queue = [];
      t.queue.push({ color: 0 });
      markDirty();
      renderCarrierLayout(lvl);
    });
    body.appendChild(addBtn);
    return;
  }
  body.innerHTML = '<div class="cl-hint">neznámý tile</div>';
}

function clTileClass(t) {
  if (!t) return 'tile-null';
  if (t.type === 'carrier') return 'tile-carrier';
  if (t.type === 'rocket') return 'tile-rocket';
  if (t.type === 'garage') return 'tile-garage';
  if (t.type === 'wall' || t.wall) return 'tile-wall';
  return 'tile-null';
}

function clOnCellClick(r, c) {
  const lvl = beCurrentLvl();
  const v = clActiveVariant(lvl);
  if (!v || !state.clTool) return;
  const t = state.clTool;
  // Select mode → označ buňku a ukaž inspector, NEmalujeme.
  if (t.kind === 'select') {
    state.clSelCell = { r, c };
    clRenderGrid(v);
    return;
  }
  // Hidden-toggle → přepne t.hidden na existujícím carrier/rocket. Nepřepisuje.
  if (t.kind === 'hidden') {
    const existing = v.grid[r] && v.grid[r][c];
    if (!existing || (existing.type !== 'carrier' && existing.type !== 'rocket')) {
      setLastAction('? tool: klikni na carrier/rocket pro přepnutí "skryté" barvy');
      return;
    }
    histPush(lvl, 'cl-hidden-toggle');
    existing.hidden = !existing.hidden;
    state.clSelCell = { r, c };
    markDirty();
    clRenderGrid(v);
    return;
  }
  histPush(lvl, 'cl-paint');
  let tile;
  if (t.kind === 'null') tile = null;
  else if (t.kind === 'wall') tile = { type: 'wall' };
  else if (t.kind === 'garage') {
    // Zachovej queue, pokud už v dané buňce garage je.
    const existing = v.grid[r] && v.grid[r][c];
    const queue = (existing && existing.type === 'garage' && Array.isArray(existing.queue)) ? existing.queue : [];
    tile = { type: 'garage', queue };
  }
  else if (t.kind === 'carrier') tile = { type: 'carrier', color: t.color };
  else if (t.kind === 'rocket') tile = { type: 'rocket', color: t.color };
  else return;
  v.grid[r][c] = tile;
  // Po paint se vybraná buňka posune na nově malovanou (hráč rovnou vidí inspector).
  state.clSelCell = { r, c };
  markDirty();
  clRenderGrid(v);
  // Capacity refresh — mutace buňky mění počty slotů per barvu (carrier/rocket/garage),
  // takže chips vlevo musí přepočítat. Bez toho zůstaly stale dokud user nepřepnul
  // variant a zpět.
  clRenderCapacity(lvl, v);
}

function wireCarrierLayout() {
  // Diff tabs — klik na tab přepíná edit view, klik na pin (uvnitř tabu)
  // nastaví default complexity pro load hry. stopPropagation v pin handleru
  // zajistí, že pin klik nezmění edit view.
  document.querySelectorAll('.cl-diff-tab').forEach(tab => {
    tab.addEventListener('click', (ev) => {
      // Pin klik řešíme zvlášť níže.
      if (ev.target.classList.contains('cl-diff-pin')) return;
      state.clActiveDiff = tab.dataset.diff;
      // Přepni na první variantu v této obtížnosti, pokud existuje.
      const lvl = beCurrentLvl();
      state.clActiveVariantIdx = lvl ? clPickFirstVariantForDiff(lvl, state.clActiveDiff) : -1;
      renderCarrierLayout(lvl);
      // Sync preview: když upravuju medium/hard, preview má zůstat na stejné obtížnosti
      // (a po případném startLevel restartu se nevracet na easy).
      const diffSel = $('preview-diff');
      if (diffSel && diffSel.value !== state.clActiveDiff) {
        diffSel.value = state.clActiveDiff;
        reloadPreview();
      }
    });
  });

  // Pin click — nastaví defaultComplexity. Toggle: druhý klik na stejný pin
  // default odpinne (level pak při loadu padne přes fallback chain v game.js).
  document.querySelectorAll('.cl-diff-pin').forEach(pin => {
    pin.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const lvl = beCurrentLvl();
      if (!lvl) return;
      const diff = pin.dataset.pin;
      // Pojistka: nelze pinnout complexity bez varianty.
      if (!clVariantsForDiff(lvl, diff).length) return;
      histPush(lvl, 'cl-pin-default');
      if (lvl.defaultComplexity === diff) {
        delete lvl.defaultComplexity;
      } else {
        lvl.defaultComplexity = diff;
      }
      markDirty();
      renderCarrierLayout(lvl);
      // Reload preview iframe — default complexity se aplikuje při loadu hry,
      // ale jen když preview nemá explicitní ?diff override. Preview jede přes
      // URL param, takže pinu ve hře se explicitně nepropaguje — designer vidí
      // efekt až při reálném gamee loadu. OK.
    });
  });

  // Variant select
  $('cl-variant-select').addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (!Number.isNaN(idx)) {
      state.clActiveVariantIdx = idx;
      renderCarrierLayout(beCurrentLvl());
    }
  });

  // + new variant
  $('cl-variant-add').addEventListener('click', () => {
    const lvl = beCurrentLvl();
    if (!lvl) return;
    histPush(lvl, 'cl-variant-add');
    if (!Array.isArray(lvl.carrierLayouts)) lvl.carrierLayouts = [];
    const v = {
      name: clDefaultVariantName(lvl, state.clActiveDiff),
      difficulty: state.clActiveDiff,
      grid: clBlankGrid(4),
    };
    lvl.carrierLayouts.push(v);
    state.clActiveVariantIdx = lvl.carrierLayouts.length - 1;
    markDirty();
    renderCarrierLayout(lvl);
  });

  // Rename
  $('cl-variant-rename').addEventListener('click', () => {
    const lvl = beCurrentLvl();
    const v = clActiveVariant(lvl);
    if (!v) return;
    const name = prompt('Nový název varianty:', v.name || '');
    if (!name || name === v.name) return;
    // Unikátnost per level × difficulty
    const dup = clVariantsForDiff(lvl, v.difficulty).some(o => o !== v && o.name === name);
    if (dup) { alert('Varianta "' + name + '" už existuje pro ' + v.difficulty + '.'); return; }
    histPush(lvl, 'cl-variant-rename');
    v.name = name;
    markDirty();
    renderCarrierLayout(lvl);
  });

  // Duplicate
  $('cl-variant-dup').addEventListener('click', () => {
    const lvl = beCurrentLvl();
    const v = clActiveVariant(lvl);
    if (!v) return;
    histPush(lvl, 'cl-variant-dup');
    const copy = {
      name: clDefaultVariantName(lvl, v.difficulty),
      difficulty: v.difficulty,
      grid: v.grid.map(row => row.map(t => t ? JSON.parse(JSON.stringify(t)) : null)),
    };
    lvl.carrierLayouts.push(copy);
    state.clActiveVariantIdx = lvl.carrierLayouts.length - 1;
    markDirty();
    renderCarrierLayout(lvl);
  });

  // Delete
  $('cl-variant-delete').addEventListener('click', () => {
    const lvl = beCurrentLvl();
    const v = clActiveVariant(lvl);
    if (!v) return;
    // Bez confirm() — dialog byl v embedded/modal kontextu blokován. Undo přes Ctrl+Z.
    histPush(lvl, 'cl-variant-delete');
    const idx = lvl.carrierLayouts.indexOf(v);
    const deletedName = v.name || '?';
    const deletedDiff = v.difficulty;
    if (idx >= 0) lvl.carrierLayouts.splice(idx, 1);
    // Pokud jsme smazali poslední variantu pro pinovanou default complexity,
    // zrušíme pin — jinak by hra padala na fallback a designer by to nevěděl.
    if (lvl.defaultComplexity === deletedDiff && !clVariantsForDiff(lvl, deletedDiff).length) {
      delete lvl.defaultComplexity;
    }
    state.clActiveVariantIdx = clPickFirstVariantForDiff(lvl, state.clActiveDiff);
    markDirty();
    renderCarrierLayout(lvl);
    setLastAction('🗑 Varianta "' + deletedName + '" smazána (Ctrl+Z pro undo)');
  });

  // Generator: fill empty tiles
  $('cl-gen-fill').addEventListener('click', () => {
    const lvl = beCurrentLvl();
    const v = clActiveVariant(lvl);
    const px = clGetStatsForCurrent(lvl);
    if (!v || !px) { alert('Spusť preview hry vpravo — generator potřebuje reálné pxCounts.'); return; }
    histPush(lvl, 'cl-gen-fill');
    const ok = clGenerateLayout(v, px, 'fill');
    if (!ok) { alert('Generator nemohl doplnit — zkontroluj velikost gridu.'); return; }
    markDirty();
    renderCarrierLayout(lvl);
  });

  // Generator: regenerate (wipe + refill). Žádný confirm — undo přes histPush.
  $('cl-gen-reset').addEventListener('click', () => {
    const lvl = beCurrentLvl();
    const v = clActiveVariant(lvl);
    const px = clGetStatsForCurrent(lvl);
    if (!v || !px) { alert('Spusť preview hry vpravo — generator potřebuje reálné pxCounts.'); return; }
    histPush(lvl, 'cl-gen-reset');
    const ok = clGenerateLayout(v, px, 'reset');
    if (!ok) { alert('Generator selhal.'); return; }
    markDirty();
    renderCarrierLayout(lvl);
    setLastAction('♻ Grid přegenerován (Ctrl+Z pro undo)');
  });

  // Rows slider
  const rowsInput = $('cl-rows');
  rowsInput.addEventListener('input', () => {
    $('cl-rows-val').textContent = rowsInput.value;
  });
  rowsInput.addEventListener('change', () => {
    const lvl = beCurrentLvl();
    const v = clActiveVariant(lvl);
    if (!v) return;
    const newRows = Math.max(1, Math.min(CL_MAX_ROWS, parseInt(rowsInput.value, 10) || 4));
    if (newRows === v.grid.length) return;
    histPush(lvl, 'cl-rows');
    clResizeGrid(v, newRows);
    markDirty();
    renderCarrierLayout(lvl);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCK EDITOR — canvas + paleta + výběr/edit/drag-drop
// ═══════════════════════════════════════════════════════════════════════════

function beCurrentLvl() { return state.levels[state.selectedIdx]; }

// Helper: hydrate block pro render (masky + default hodnoty).
function beHydrate(b) {
  const w = Math.max(1, b.w | 0);
  const h = Math.max(1, b.h | 0);
  const shape = b.shape || 'rect';
  return {
    ...b,
    w, h,
    kind: b.kind === 'mystery' ? 'mystery' : 'solid',
    shape,
    color: (b.color | 0),
    hp: Math.max(1, b.hp | 0),
    x: b.x | 0,
    y: b.y | 0,
    _mask: beBlockMask(shape, w, h),
  };
}

// True, pokud barva existuje na levelu i poté, co ignorujeme blok `exceptBlockIdx`:
// - je barvou jiného bloku, NEBO
// - je barvou alespoň jednoho pixelu custom obrázku (pixely pod solid blokem se
//   při spuštění hry vyčistí, takže pixel pod zjišťovaným blokem do úvahy nebereme;
//   u mystery bloku pixely pod ním zůstávají, takže ano).
// Pokud barva nikde jinde NEexistuje → je „orphan", carrier layout by ji neměl držet.
function bePaletteColorStillUsed(lvl, color, exceptBlockIdx) {
  if (!lvl) return false;
  const blocks = lvl.blocks || [];
  for (let i = 0; i < blocks.length; i++) {
    if (i === exceptBlockIdx) continue;
    if ((blocks[i].color | 0) === (color | 0)) return true;
  }
  // Pixely custom obrázku
  const img = lvl.image;
  if (img && img.source === 'custom' && Array.isArray(img.pixels)) {
    // Určíme footprint solid bloku, který právě měníme — ty pixely se ve hře smažou,
    // takže je ignorujeme. Mystery blok footprint nemaže.
    let maskedCells = null;
    const exceptBlk = blocks[exceptBlockIdx];
    if (exceptBlk && exceptBlk.kind !== 'mystery') {
      maskedCells = new Set();
      const w = Math.max(1, exceptBlk.w | 0);
      const h = Math.max(1, exceptBlk.h | 0);
      const mask = beBlockMask(exceptBlk.shape || 'rect', w, h);
      for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++) {
        if (!mask[ly][lx]) continue;
        maskedCells.add(((exceptBlk.y | 0) + ly) + ',' + ((exceptBlk.x | 0) + lx));
      }
    }
    for (let y = 0; y < img.pixels.length; y++) {
      const row = img.pixels[y];
      if (!Array.isArray(row)) continue;
      for (let x = 0; x < row.length; x++) {
        if (maskedCells && maskedCells.has(y + ',' + x)) continue;
        if ((row[x] | 0) === (color | 0)) return true;
      }
    }
    return false;
  }
  // Pro non-custom image (smiley/mondrian) nemáme levný lokální výpočet pixelů →
  // buďme opatrní a vraťme true (barva může být v generovaném obrázku). Uživatel
  // pak případně pře-regeneruje layout ručně. Auto-propagace se tak aktivuje hlavně
  // u custom obrázků, kde je jistota.
  return true;
}

// Propaguje změnu barvy OLD → NEW do všech nosičů + raket + garage queue v carrier
// layoutech daného levelu, plus do top-level lvl.garage. Volat jen když jsme se přesvědčili,
// že OLD barva už na levelu není (jinak bychom přebili designerem nastavené carriers).
function bePropagateBlockColorChange(lvl, oldColor, newColor) {
  if (!lvl || oldColor === newColor) return;
  const variants = Array.isArray(lvl.carrierLayouts) ? lvl.carrierLayouts : [];
  for (const v of variants) {
    if (!v || !Array.isArray(v.grid)) continue;
    for (const row of v.grid) {
      if (!Array.isArray(row)) continue;
      for (const tile of row) {
        if (!tile) continue;
        if ((tile.type === 'carrier' || tile.type === 'rocket') &&
            (tile.color | 0) === (oldColor | 0)) {
          tile.color = newColor;
        }
        if (tile.type === 'garage' && Array.isArray(tile.queue)) {
          for (const q of tile.queue) {
            if (q && (q.color | 0) === (oldColor | 0)) q.color = newColor;
          }
        }
      }
    }
  }
  if (lvl.garage && Array.isArray(lvl.garage.carriers)) {
    for (const c of lvl.garage.carriers) {
      if (c && (c.color | 0) === (oldColor | 0)) c.color = newColor;
    }
  }
}

function beClampPos(blk) {
  blk.x = Math.max(0, Math.min(BE_GW - blk.w, blk.x));
  blk.y = Math.max(0, Math.min(BE_IMG_GH - blk.h, blk.y));
}

// Vykreslení plátna: grid pozadí + všechny bloky + výběr + drag-preview.
function renderBlockCanvas() {
  const cvs = $('be-canvas');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  // BG (tmavě modrá – koresponduje s herním pozadím)
  ctx.fillStyle = '#081a2e';
  ctx.fillRect(0, 0, W, H);
  // Jemná mřížka každých 10 px
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= BE_GW; x++) {
    ctx.beginPath();
    ctx.moveTo(x * BE_SCALE + 0.5, 0);
    ctx.lineTo(x * BE_SCALE + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= BE_IMG_GH; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * BE_SCALE + 0.5);
    ctx.lineTo(W, y * BE_SCALE + 0.5);
    ctx.stroke();
  }
  // Středové linky (pomoc pro symetrické tvary)
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(BE_GW * BE_SCALE / 2 + 0.5, 0);
  ctx.lineTo(BE_GW * BE_SCALE / 2 + 0.5, H);
  ctx.stroke();

  const lvl = beCurrentLvl();
  if (!lvl) return;

  // Pixel layer (jen pro custom source) — vykreslí uložené pixely.
  if (lvl.image && lvl.image.source === 'custom' && Array.isArray(lvl.image.pixels)) {
    const pixels = lvl.image.pixels;
    for (let y = 0; y < BE_IMG_GH; y++) {
      const row = pixels[y];
      if (!Array.isArray(row)) continue;
      for (let x = 0; x < BE_GW; x++) {
        const c = row[x];
        if (c == null || c < 0 || c >= BE_COLORS.length) continue;
        ctx.fillStyle = BE_COLORS[c];
        ctx.fillRect(x * BE_SCALE, y * BE_SCALE, BE_SCALE, BE_SCALE);
      }
    }
  }

  const blocks = lvl.blocks || [];
  blocks.forEach((raw, idx) => {
    const b = beHydrate(raw);
    beDrawOneBlock(ctx, b, idx === beState.selectedBlockIdx, false);
  });

  // Rect-tool preview — zvýrazní se obdélník mezi rectStart a rectEnd.
  if (beState.pxRectStart && beState.pxRectEnd) {
    const a = beState.pxRectStart, b = beState.pxRectEnd;
    const x0 = Math.max(0, Math.min(a.x, b.x));
    const y0 = Math.max(0, Math.min(a.y, b.y));
    const x1 = Math.min(BE_GW - 1, Math.max(a.x, b.x));
    const y1 = Math.min(BE_IMG_GH - 1, Math.max(a.y, b.y));
    ctx.save();
    const isFill = beState.pxTool === 'rect-fill';
    if (isFill) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = BE_COLORS[beState.pxColor];
      ctx.fillRect(x0 * BE_SCALE, y0 * BE_SCALE, (x1 - x0 + 1) * BE_SCALE, (y1 - y0 + 1) * BE_SCALE);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isFill ? BE_COLORS[beState.pxColor] : '#ff4040';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0 * BE_SCALE, y0 * BE_SCALE, (x1 - x0 + 1) * BE_SCALE, (y1 - y0 + 1) * BE_SCALE);
    ctx.restore();
  }

  // Drag preview: poloprůhledný duch bloku na aktuální pozici kurzoru
  if (beState.drag && beState.mousePx) {
    const d = beState.drag;
    const w = d.w, h = d.h;
    const ghost = beHydrate({
      ...d,
      w, h,
      x: Math.max(0, Math.min(BE_GW - w, Math.floor(beState.mousePx.x - w / 2))),
      y: Math.max(0, Math.min(BE_IMG_GH - h, Math.floor(beState.mousePx.y - h / 2))),
    });
    beDrawOneBlock(ctx, ghost, false, true);
  }
}

function beDrawOneBlock(ctx, b, isSelected, isGhost) {
  const isMystery = b.kind === 'mystery';
  const fill = isMystery ? '#555a62' : (BE_COLORS[b.color] || '#888');
  for (let ly = 0; ly < b.h; ly++) for (let lx = 0; lx < b.w; lx++) {
    if (!b._mask[ly][lx]) continue;
    const px = (b.x + lx) * BE_SCALE;
    const py = (b.y + ly) * BE_SCALE;
    ctx.globalAlpha = isGhost ? 0.5 : 1;
    ctx.fillStyle = fill;
    ctx.fillRect(px, py, BE_SCALE, BE_SCALE);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(px + 1, py + 1, BE_SCALE - 2, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 1, py + BE_SCALE - 3, BE_SCALE - 2, 2);
  }
  ctx.globalAlpha = 1;
  // HP text / ?
  const cx = (b.x + b.w / 2) * BE_SCALE;
  const cy = (b.y + b.h / 2) * BE_SCALE;
  // Jednotná velikost čísla — sjednocena s herním rendererem (24px), aby
  // editor + hra ukazovaly identický vzhled.
  const fontPx = 24;
  ctx.save();
  ctx.globalAlpha = isGhost ? 0.6 : 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, fontPx / 7);
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  if (isMystery) {
    ctx.font = 'bold ' + fontPx + 'px system-ui, -apple-system, sans-serif';
    ctx.strokeText('?', cx, cy);
    ctx.fillStyle = '#ffe07a';
    ctx.fillText('?', cx, cy);
  } else {
    ctx.font = 'bold ' + fontPx + 'px system-ui, -apple-system, sans-serif';
    ctx.strokeText(String(b.hp), cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(b.hp), cx, cy);
  }
  ctx.restore();
  // Výběr – žlutý outline bounding boxu
  if (isSelected) {
    ctx.save();
    ctx.strokeStyle = '#ffe07a';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
      b.x * BE_SCALE - 1,
      b.y * BE_SCALE - 1,
      b.w * BE_SCALE + 2,
      b.h * BE_SCALE + 2
    );
    ctx.setLineDash([]);
    // Resize handle squares — středy hran + 4 rohy. Designer chytne handle
    // a táhne pro resize. 8 bodů jako u běžného shape editoru.
    const hs = 6; // velikost handle čtverce v px
    const hx = b.x * BE_SCALE - 1, hy = b.y * BE_SCALE - 1;
    const hw = b.w * BE_SCALE + 2, hh = b.h * BE_SCALE + 2;
    const handles = [
      [hx, hy], [hx + hw / 2, hy], [hx + hw, hy],            // NW, N, NE
      [hx, hy + hh / 2],          [hx + hw, hy + hh / 2],    // W, E
      [hx, hy + hh], [hx + hw / 2, hy + hh], [hx + hw, hy + hh] // SW, S, SE
    ];
    ctx.fillStyle = '#ffe07a';
    ctx.strokeStyle = '#1a1818';
    ctx.lineWidth = 1;
    for (const [hx0, hy0] of handles) {
      ctx.fillRect(hx0 - hs / 2, hy0 - hs / 2, hs, hs);
      ctx.strokeRect(hx0 - hs / 2, hy0 - hs / 2, hs, hs);
    }
    ctx.restore();
  }
}

// Detekuje, jestli je bod (gx, gy) v image-pixel souřadnicích nad jednou
// z edge zón daného (selected) bloku. Vrací 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'
// nebo null. Tolerance je v image-pixelech (~0.4 = 4 reálné pixely při SCALE=10).
function beHitEdge(b, gx, gy) {
  const tol = 0.4;
  const inX = gx > b.x - tol && gx < b.x + b.w + tol;
  const inY = gy > b.y - tol && gy < b.y + b.h + tol;
  if (!inX || !inY) return null;
  const nearN = Math.abs(gy - b.y) < tol;
  const nearS = Math.abs(gy - (b.y + b.h)) < tol;
  const nearW = Math.abs(gx - b.x) < tol;
  const nearE = Math.abs(gx - (b.x + b.w)) < tol;
  if (nearN && nearW) return 'nw';
  if (nearN && nearE) return 'ne';
  if (nearS && nearW) return 'sw';
  if (nearS && nearE) return 'se';
  if (nearN) return 'n';
  if (nearS) return 's';
  if (nearW) return 'w';
  if (nearE) return 'e';
  return null;
}

const BE_EDGE_CURSORS = {
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
};

// Najde index bloku pod pozicí (v image-pixel souřadnicích).
function beHitTest(gx, gy) {
  const lvl = beCurrentLvl();
  if (!lvl || !Array.isArray(lvl.blocks)) return -1;
  // Od posledního k prvnímu – nahoře umístěný blok má prioritu
  for (let i = lvl.blocks.length - 1; i >= 0; i--) {
    const b = beHydrate(lvl.blocks[i]);
    const lx = gx - b.x, ly = gy - b.y;
    if (lx < 0 || ly < 0 || lx >= b.w || ly >= b.h) continue;
    if (b._mask[ly] && b._mask[ly][lx]) return i;
  }
  return -1;
}

// Převede event (clientX/Y) na image-pixel souřadnice {x,y} v rozsahu 0..GW × 0..IMG_GH.
function bePxFromEvent(e) {
  const cvs = $('be-canvas');
  const rect = cvs.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (cvs.width / rect.width);
  const cy = (e.clientY - rect.top) * (cvs.height / rect.height);
  return { x: cx / BE_SCALE, y: cy / BE_SCALE };
}

// Paleta: preset dlaždice (shape × kind) s defaultními rozměry.
function renderBlockPalette() {
  const wrap = $('be-palette');
  if (!wrap) return;
  wrap.innerHTML = '';
  const presets = [
    { shape: 'rect',   kind: 'solid',   w: 4, h: 3, color: 4, hp: 10, label: 'rect' },
    { shape: 'cross',  kind: 'solid',   w: 5, h: 5, color: 3, hp: 12, label: 'cross' },
    { shape: 'L',      kind: 'solid',   w: 4, h: 4, color: 1, hp: 10, label: 'L' },
    { shape: 'T',      kind: 'solid',   w: 5, h: 4, color: 5, hp: 10, label: 'T' },
    { shape: 'circle', kind: 'solid',   w: 5, h: 5, color: 6, hp: 12, label: 'circle' },
    { shape: 'rect',   kind: 'mystery', w: 3, h: 3, color: 0, hp: 8,  label: '? rect' },
  ];
  presets.forEach(p => {
    const tile = document.createElement('div');
    tile.className = 'be-tile';
    tile.draggable = true;
    const mini = document.createElement('canvas');
    mini.width = 42; mini.height = 42;
    beDrawTilePreview(mini, p);
    tile.appendChild(mini);
    const lbl = document.createElement('span');
    lbl.className = 'be-tile-label';
    lbl.textContent = p.label + (p.kind === 'mystery' ? '' : '');
    tile.appendChild(lbl);

    tile.addEventListener('dragstart', (e) => {
      beState.drag = { ...p };
      tile.classList.add('dragging');
      // Firefox vyžaduje data
      try { e.dataTransfer.setData('text/plain', 'be-block'); } catch (_) {}
      e.dataTransfer.effectAllowed = 'copy';
    });
    tile.addEventListener('dragend', () => {
      tile.classList.remove('dragging');
      beState.drag = null;
      beState.mousePx = null;
      renderBlockCanvas();
    });
    wrap.appendChild(tile);
  });
}

function beDrawTilePreview(cvs, preset) {
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.fillStyle = '#0a1626';
  ctx.fillRect(0, 0, W, H);
  const mask = beBlockMask(preset.shape, preset.w, preset.h);
  const cell = Math.floor(Math.min(W, H) / Math.max(preset.w, preset.h));
  const ox = Math.floor((W - cell * preset.w) / 2);
  const oy = Math.floor((H - cell * preset.h) / 2);
  const isMystery = preset.kind === 'mystery';
  const fill = isMystery ? '#555a62' : BE_COLORS[preset.color];
  for (let y = 0; y < preset.h; y++) for (let x = 0; x < preset.w; x++) {
    if (!mask[y][x]) continue;
    ctx.fillStyle = fill;
    ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
  }
  if (isMystery) {
    ctx.fillStyle = '#ffe07a';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', W / 2, H / 2);
  }
}

// Panel výběru – form pro editaci selektu.
function renderSelectedBlockPanel() {
  const wrap = $('be-sel-wrap');
  if (!wrap) return;
  const lvl = beCurrentLvl();
  const idx = beState.selectedBlockIdx;
  const blk = (lvl && Array.isArray(lvl.blocks) && idx >= 0 && idx < lvl.blocks.length) ? lvl.blocks[idx] : null;
  if (!blk) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  // Vyplnit hodnoty
  // kind seg
  wrap.querySelectorAll('.be-seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.kind === (blk.kind === 'mystery' ? 'mystery' : 'solid'));
  });
  $('be-sel-shape').value = blk.shape || 'rect';
  $('be-sel-w').value = blk.w;
  $('be-sel-h').value = blk.h;
  $('be-sel-x').value = blk.x;
  $('be-sel-y').value = blk.y;
  $('be-sel-hp').value = blk.hp;
  $('be-sel-hp-val').textContent = blk.hp;
  // Colors
  const colors = $('be-sel-colors');
  colors.innerHTML = '';
  for (let i = 0; i < BE_COLORS.length; i++) {
    const d = document.createElement('div');
    d.className = 'be-color-dot' + (i === (blk.color | 0) ? ' selected' : '');
    d.style.background = BE_COLORS[i];
    d.title = 'color ' + i;
    d.addEventListener('click', () => {
      const lvl = beCurrentLvl();
      const b = lvl && lvl.blocks[beState.selectedBlockIdx];
      if (!b) return;
      const oldColor = b.color | 0;
      const newColor = i;
      if (oldColor === newColor) return;
      histPush(lvl, 'block-color');
      b.color = newColor;
      // Auto-propagace na carrier layouty + garage: pokud stará barva už není použitá
      // (ani jiným blokem, ani pixelem vlastního obrázku), recoloruj nosiče staré
      // barvy na novou. Bez tohohle zůstávaly v layoutu zamrzle tily s color=OLD,
      // hra je vykreslila v preview jako „orphan" nosiče cizí barvy (report v45).
      if (!bePaletteColorStillUsed(lvl, oldColor, beState.selectedBlockIdx)) {
        bePropagateBlockColorChange(lvl, oldColor, newColor);
      }
      // Změna barvy bloku = změna pxCounts → layout-applied/fallback status z předchozího
      // iframe runu je outdated. Vyčistit, ať banner nedrží starou chybu dokud iframe
      // nepošle novou postMessage (~800ms gap). Stejná logika jako pro cl-* akce
      // (v45 fix) — jen tam byla scoped přímo na histPush.
      if (lvl && lvl.key) {
        const bag = state.layoutStatusByLevel && state.layoutStatusByLevel[lvl.key];
        if (bag) delete bag[state.clActiveDiff];
      }
      renderSelectedBlockPanel();
      renderBlockCanvas();
      renderCarrierLayout(lvl);
      markDirty();
    });
    colors.appendChild(d);
  }
}

function beSelectBlock(idx) {
  beState.selectedBlockIdx = idx;
  renderBlockCanvas();
  renderSelectedBlockPanel();
}

function beDeleteSelected() {
  const lvl = beCurrentLvl();
  if (!lvl || beState.selectedBlockIdx < 0) return;
  histPush(lvl, 'block-delete');
  lvl.blocks.splice(beState.selectedBlockIdx, 1);
  beState.selectedBlockIdx = -1;
  renderBlockCanvas();
  renderSelectedBlockPanel();
  markDirty();
}

function beRotateSelected() {
  const lvl = beCurrentLvl();
  if (!lvl || beState.selectedBlockIdx < 0) return;
  const b = lvl.blocks[beState.selectedBlockIdx];
  if (!b) return;
  histPush(lvl, 'block-rotate');
  // Rotace 90° = swap w/h. Tvar zůstává stejný (rect/cross/circle jsou rot-sym,
  // L/T se „přegenerují" se swapnutými rozměry – aproximace, nejzajímavější efekt
  // je u L a T kde se mění orientace ramene).
  const nw = b.h, nh = b.w;
  if (b.x + nw > BE_GW) b.x = BE_GW - nw;
  if (b.y + nh > BE_IMG_GH) b.y = BE_IMG_GH - nh;
  if (b.x < 0) b.x = 0;
  if (b.y < 0) b.y = 0;
  b.w = nw; b.h = nh;
  renderBlockCanvas();
  renderSelectedBlockPanel();
  markDirty();
}

function beMoveSelected(dx, dy) {
  const lvl = beCurrentLvl();
  if (!lvl || beState.selectedBlockIdx < 0) return;
  const b = lvl.blocks[beState.selectedBlockIdx];
  if (!b) return;
  histPush(lvl, 'block-move-kbd');
  b.x = Math.max(0, Math.min(BE_GW - b.w, b.x + dx));
  b.y = Math.max(0, Math.min(BE_IMG_GH - b.h, b.y + dy));
  renderBlockCanvas();
  renderSelectedBlockPanel();
  markDirty();
}

function beAddBlockFromDrag(pxX, pxY) {
  const lvl = beCurrentLvl();
  if (!lvl || !beState.drag) return;
  if (!Array.isArray(lvl.blocks)) lvl.blocks = [];
  histPush(lvl, 'block-add');
  const d = beState.drag;
  const w = d.w, h = d.h;
  const nb = {
    kind: d.kind || 'solid',
    shape: d.shape || 'rect',
    x: Math.max(0, Math.min(BE_GW - w, Math.floor(pxX - w / 2))),
    y: Math.max(0, Math.min(BE_IMG_GH - h, Math.floor(pxY - h / 2))),
    w, h,
    color: d.color | 0,
    hp: d.hp | 0,
  };
  lvl.blocks.push(nb);
  beState.selectedBlockIdx = lvl.blocks.length - 1;
  renderBlockCanvas();
  renderSelectedBlockPanel();
  markDirty();
}

// Nastaví hodnotu pixelu na dané image-pixel pozici (floor(x), floor(y)).
// color: 0..8 pro barvu, -1 pro erase. Bez-ops při překročení hranic.
// NOTA: nerozsviťuje markDirty() sám — volá to nadřazený handler (paint drag →
// markDirty na mouseup, batch commit). Redraw se dělá po každém zásahu.
function bePaintPixelAt(pxX, pxY, color) {
  const lvl = beCurrentLvl();
  if (!lvl || !lvl.image || lvl.image.source !== 'custom') return;
  const pixels = beEnsurePixels(lvl);
  if (!pixels) return;
  const x = Math.floor(pxX), y = Math.floor(pxY);
  if (x < 0 || y < 0 || x >= BE_GW || y >= BE_IMG_GH) return;
  if (pixels[y][x] === color) return;
  pixels[y][x] = color;
  renderBlockCanvas();
}

// Aplikuje aktuální rectangle (pxRectStart → pxRectEnd) na pixel data.
// color: 0..8 pro fill, -1 pro erase.
function beApplyPixelRect(color) {
  const lvl = beCurrentLvl();
  if (!lvl || !beState.pxRectStart || !beState.pxRectEnd) return;
  const pixels = beEnsurePixels(lvl);
  if (!pixels) return;
  const a = beState.pxRectStart, b = beState.pxRectEnd;
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(BE_GW - 1, Math.max(a.x, b.x));
  const y1 = Math.min(BE_IMG_GH - 1, Math.max(a.y, b.y));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixels[y][x] = color;
}

// Vymaže celé custom plátno (všechny pixely → -1).
function beClearAllPixels() {
  const lvl = beCurrentLvl();
  if (!lvl || !lvl.image || lvl.image.source !== 'custom') return;
  if (!confirm('Opravdu vymazat celé plátno? (Bloky zůstanou.)')) return;
  histPush(lvl, 'pixel-clearall');
  lvl.image.pixels = beBlankPixels();
  renderBlockCanvas();
  markDirty();
}

// Přepnutí aktivního nástroje a obarvení (volá se z toolbar tlačítek + dot kliků).
function beSetPxTool(tool) {
  beState.pxTool = tool;
  document.querySelectorAll('#pixel-toolbar .pt-tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  const wrap = document.querySelector('.be-canvas-wrap');
  if (wrap) wrap.setAttribute('data-tool', tool);
}
function beSetPxColor(ci) {
  beState.pxColor = ci;
  document.querySelectorAll('#pt-colors .be-color-dot').forEach(d => {
    d.classList.toggle('selected', parseInt(d.dataset.ci) === ci);
  });
}

function beUpdatePixelPalette(lvl) {
  const wrap = $('pt-colors');
  if (!wrap) return;
  const palette = (lvl && lvl.activePalette) ? lvl.activePalette : BE_COLORS.map((_, i) => i);
  wrap.innerHTML = '';
  palette.forEach(ci => {
    const d = document.createElement('div');
    d.className = 'be-color-dot' + (ci === beState.pxColor ? ' selected' : '');
    d.style.background = BE_COLORS[ci];
    d.dataset.ci = ci;
    d.title = 'color ' + ci;
    d.addEventListener('click', () => beSetPxColor(ci));
    wrap.appendChild(d);
  });
}

// Zobrazí / skryje pixel toolbar podle image.source aktuálně zvoleného levelu.
function beUpdatePixelToolbarVisibility() {
  const tb = $('pixel-toolbar');
  if (!tb) return;
  const lvl = beCurrentLvl();
  const show = !!(lvl && lvl.image && lvl.image.source === 'custom');
  tb.hidden = !show;
  if (show) {
    beEnsurePixels(lvl);
    beUpdatePixelPalette(lvl);
    const wrap = document.querySelector('.be-canvas-wrap');
    if (wrap) wrap.setAttribute('data-tool', beState.pxTool);
  } else {
    const wrap = document.querySelector('.be-canvas-wrap');
    if (wrap) wrap.removeAttribute('data-tool');
  }
}

function wirePixelToolbar() {
  // Tool buttons
  document.querySelectorAll('#pixel-toolbar .pt-tool').forEach(btn => {
    btn.addEventListener('click', () => beSetPxTool(btn.dataset.tool));
  });
  beUpdatePixelPalette(beCurrentLvl());
  // Clear all
  const clr = $('pt-clear-all');
  if (clr) clr.addEventListener('click', beClearAllPixels);

  wirePhotoImport();
  wireGenerator();
}

// ─────────────────────────────────────────────────────────────────
//  Photo import — crop + quantize fotky do herní palety (36×27)
// ─────────────────────────────────────────────────────────────────

const FI_PAL_RGB = BE_COLORS.map(hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

const fiState = {
  img: null,
  zoom: 1,       // canvas px per original image px
  panX: 0,       // original-image px at crop left edge
  panY: 0,       // original-image px at crop top edge
  dragging: false,
  lastX: 0,
  lastY: 0,
  maxColors: BE_COLORS.length,
};

// subset = pole indexů do FI_PAL_RGB; null = použij vše
function fiNearest(r, g, b, subset) {
  const indices = subset || FI_PAL_RGB.map((_, i) => i);
  let best = indices[0], bestD = Infinity;
  for (const ci of indices) {
    const [pr, pg, pb] = FI_PAL_RGB[ci];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = ci; }
  }
  return best;
}

// Vrátí n nejpoužívanějších indexů palety pro daný snímek (rychlý 1. pass bez dither).
function fiGetColorSubset(imgData, w, h, n, pool) {
  const universe = pool || BE_COLORS.map((_, i) => i);
  if (n >= universe.length) return pool || null;
  const counts = new Array(BE_COLORS.length).fill(0);
  const { data } = imgData;
  for (let i = 0; i < w * h; i++) {
    counts[fiNearest(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], pool || null)]++;
  }
  return universe
    .map(i => ({ i, c: counts[i] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, n)
    .map(x => x.i);
}

function fiQuantize(imgData, w, h, dither, subset) {
  const buf = new Float32Array(imgData.data);
  const result = [];
  for (let y = 0; y < h; y++) {
    result.push(new Array(w));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = Math.max(0, Math.min(255, buf[i]));
      const g = Math.max(0, Math.min(255, buf[i + 1]));
      const b = Math.max(0, Math.min(255, buf[i + 2]));
      const ci = fiNearest(r, g, b, subset);
      result[y][x] = ci;
      if (dither) {
        const [pr, pg, pb] = FI_PAL_RGB[ci];
        const er = r - pr, eg = g - pg, eb = b - pb;
        for (const [dx, dy, f] of [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny < h) {
            const ni = (ny * w + nx) * 4;
            buf[ni] += er * f;
            buf[ni + 1] += eg * f;
            buf[ni + 2] += eb * f;
          }
        }
      }
    }
  }
  return result;
}

function fiClampPan() {
  const cv = $('fi-crop-canvas');
  if (!fiState.img || !cv) return;
  const srcW = cv.width / fiState.zoom;
  const srcH = cv.height / fiState.zoom;
  const iW = fiState.img.naturalWidth, iH = fiState.img.naturalHeight;
  fiState.panX = Math.max(0, Math.min(Math.max(0, iW - srcW), fiState.panX));
  fiState.panY = Math.max(0, Math.min(Math.max(0, iH - srcH), fiState.panY));
}

function fiRenderCrop() {
  const cv = $('fi-crop-canvas');
  if (!cv || !fiState.img) return;
  const ctx = cv.getContext('2d');
  const cW = cv.width, cH = cv.height;
  const srcW = cW / fiState.zoom, srcH = cH / fiState.zoom;
  ctx.clearRect(0, 0, cW, cH);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cW, cH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(fiState.img, fiState.panX, fiState.panY, srcW, srcH, 0, 0, cW, cH);
  // světlá mřížka 36×27
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 0.5;
  const cw = cW / BE_GW, ch = cH / BE_IMG_GH;
  for (let x = 0; x <= BE_GW; x++) { ctx.beginPath(); ctx.moveTo(x * cw, 0); ctx.lineTo(x * cw, cH); ctx.stroke(); }
  for (let y = 0; y <= BE_IMG_GH; y++) { ctx.beginPath(); ctx.moveTo(0, y * ch); ctx.lineTo(cW, y * ch); ctx.stroke(); }
  fiComputeMaxColors();
}

function fiGetImgData() {
  const cropCv = $('fi-crop-canvas');
  if (!cropCv) return null;
  const tmp = document.createElement('canvas');
  tmp.width = BE_GW; tmp.height = BE_IMG_GH;
  const ctx = tmp.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cropCv, 0, 0, BE_GW, BE_IMG_GH);
  return ctx.getImageData(0, 0, BE_GW, BE_IMG_GH);
}

function fiComputeMaxColors() {
  const imgData = fiGetImgData();
  if (!imgData) return;
  const pixels = fiQuantize(imgData, BE_GW, BE_IMG_GH, false, null);
  fiState.maxColors = new Set(pixels.flat().filter(ci => ci >= 0)).size;
  fiUpdateSliderBounds();
}

function fiGetProfilePool() {
  const profileEl = $('fi-profile');
  const key = profileEl ? profileEl.value : 'auto';
  if (key === 'auto') return null;
  if (key === 'active') {
    const lvl = beCurrentLvl();
    return (lvl && lvl.activePalette) ? lvl.activePalette : null;
  }
  const preset = BE_PALETTE_PRESETS.find(p => p.key === key);
  return preset ? preset.colors : null;
}

function fiUpdateSliderBounds() {
  const nSlider = $('fi-ncolors');
  const nVal = $('fi-ncolors-val');
  if (!nSlider) return;
  const profileEl = $('fi-profile');
  const key = profileEl ? profileEl.value : 'auto';
  let maxN;
  if (key === 'auto') {
    maxN = fiState.maxColors;
  } else if (key === 'active') {
    const lvl = beCurrentLvl();
    maxN = (lvl && lvl.activePalette) ? lvl.activePalette.length : BE_COLORS.length;
  } else {
    const preset = BE_PALETTE_PRESETS.find(p => p.key === key);
    maxN = preset ? preset.colors.length : BE_COLORS.length;
  }
  nSlider.max = maxN;
  if (parseInt(nSlider.value) > maxN) nSlider.value = maxN;
  if (nVal) nVal.textContent = nSlider.value;
}

function fiCurrentN() {
  const el = $('fi-ncolors');
  return el ? parseInt(el.value) : BE_COLORS.length;
}

function fiRenderQuant() {
  const quantCv = $('fi-quant-canvas');
  if (!quantCv) return;
  const imgData = fiGetImgData();
  if (!imgData) return;
  const n = fiCurrentN();
  const pool = fiGetProfilePool();
  const subset = fiGetColorSubset(imgData, BE_GW, BE_IMG_GH, n, pool);
  const dither = $('fi-dither') && $('fi-dither').checked;
  const pixels = fiQuantize(imgData, BE_GW, BE_IMG_GH, dither, subset);
  const ctx = quantCv.getContext('2d');
  const sw = quantCv.width / BE_GW, sh = quantCv.height / BE_IMG_GH;
  for (let y = 0; y < BE_IMG_GH; y++) {
    for (let x = 0; x < BE_GW; x++) {
      const ci = pixels[y][x];
      ctx.fillStyle = ci >= 0 ? BE_COLORS[ci] : '#1a1a1c';
      ctx.fillRect(x * sw, y * sh, sw, sh);
    }
  }
}

function fiRender() {
  fiRenderCrop();
  fiRenderQuant();
}

function fiOpen(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      fiState.img = img;
      const cv = $('fi-crop-canvas');
      if (!cv) return;
      // fill-mode: obraz vyplní celý crop (center crop)
      const fillZoom = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
      fiState.zoom = fillZoom;
      const srcW = cv.width / fillZoom, srcH = cv.height / fillZoom;
      fiState.panX = (img.naturalWidth - srcW) / 2;
      fiState.panY = (img.naturalHeight - srcH) / 2;
      const profileSel = $('fi-profile');
      if (profileSel) profileSel.value = 'auto';
      fiUpdateSliderBounds();
      $('foto-import-modal').hidden = false;
      fiRender();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function fiConfirm() {
  const imgData = fiGetImgData();
  if (!imgData) return;
  const n = fiCurrentN();
  const pool = fiGetProfilePool();
  const subset = fiGetColorSubset(imgData, BE_GW, BE_IMG_GH, n, pool);
  const dither = $('fi-dither') && $('fi-dither').checked;
  const pixels = fiQuantize(imgData, BE_GW, BE_IMG_GH, dither, subset);

  const L = beCurrentLvl();
  if (!L) return;
  histPush(L, 'photo-import');
  L.image = { source: 'custom', pixels };

  const profileEl = $('fi-profile');
  if (profileEl && profileEl.value === 'auto') {
    const usedColors = [...new Set(pixels.flat().filter(ci => ci >= 0))].sort((a, b) => a - b);
    if (usedColors.length > 0) L.activePalette = usedColors;
  }

  $('foto-import-modal').hidden = true;
  const srcSel = $('f-image-source');
  if (srcSel) srcSel.value = 'custom';
  renderPaletteSection(L);
  beUpdatePixelToolbarVisibility();
  renderBlockCanvas();
  markDirty();
}

function wirePhotoImport() {
  const fileInput = $('pt-foto-file');
  const importBtn = $('pt-import-foto');
  if (!importBtn || !fileInput) return;

  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) { fileInput.value = ''; fiOpen(f); }
  });

  const cancelBtn = $('fi-cancel');
  const confirmBtn = $('fi-confirm');
  const ditherChk = $('fi-dither');
  const nSlider = $('fi-ncolors');
  const nVal = $('fi-ncolors-val');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { $('foto-import-modal').hidden = true; });
  if (confirmBtn) confirmBtn.addEventListener('click', fiConfirm);
  if (ditherChk) ditherChk.addEventListener('change', fiRenderQuant);
  const profileSel = $('fi-profile');
  if (profileSel) profileSel.addEventListener('change', () => { fiUpdateSliderBounds(); fiRenderQuant(); });
  if (nSlider) {
    nSlider.value = 12;
    if (nVal) nVal.textContent = 12;
    nSlider.addEventListener('input', () => {
      if (nVal) nVal.textContent = nSlider.value;
      fiRenderQuant();
    });
  }

  const cv = $('fi-crop-canvas');
  if (!cv) return;
  cv.style.cursor = 'grab';

  cv.addEventListener('mousedown', (e) => {
    fiState.dragging = true;
    fiState.lastX = e.clientX;
    fiState.lastY = e.clientY;
    cv.style.cursor = 'grabbing';
  });
  window.addEventListener('mouseup', () => {
    if (!fiState.dragging) return;
    fiState.dragging = false;
    if (cv) cv.style.cursor = 'grab';
  });
  window.addEventListener('mousemove', (e) => {
    if (!fiState.dragging) return;
    const dx = e.clientX - fiState.lastX;
    const dy = e.clientY - fiState.lastY;
    fiState.lastX = e.clientX;
    fiState.lastY = e.clientY;
    fiState.panX -= dx / fiState.zoom;
    fiState.panY -= dy / fiState.zoom;
    fiClampPan();
    fiRenderCrop();
    fiRenderQuant();
  });

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const oldZoom = fiState.zoom;
    const minZoom = fiState.img
      ? Math.max(cv.width / fiState.img.naturalWidth, cv.height / fiState.img.naturalHeight)
      : 0.1;
    const newZoom = Math.max(minZoom, Math.min(50, oldZoom * factor));
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    fiState.panX += mx / oldZoom - mx / newZoom;
    fiState.panY += my / oldZoom - my / newZoom;
    fiState.zoom = newZoom;
    fiClampPan();
    fiRender();
  }, { passive: false });
}

// ─────────────────────────────────────────────────────────────────
//  Level Generator — pixel patterns + block scatter
// ─────────────────────────────────────────────────────────────────

let _genStyle = 'stripes';

function _genPalette(lvl) {
  return (lvl && lvl.activePalette && lvl.activePalette.length > 0)
    ? lvl.activePalette
    : BE_PALETTE_PRESETS[0].colors;
}
function _rInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function _rChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function _shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = _rInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genPixelsStripes(palette) {
  const pal = _shuffled(palette);
  const n = pal.length;
  const type = _rChoice(['h', 'v', 'diag+', 'diag-', 'radial']);
  const w = _rInt(Math.max(1, Math.floor(BE_GW / n / 2)), Math.max(2, Math.floor(BE_GW / n)));
  return Array.from({length: BE_IMG_GH}, (_, y) =>
    Array.from({length: BE_GW}, (_, x) => {
      let idx;
      if      (type === 'h')     idx = Math.floor(y / w);
      else if (type === 'v')     idx = Math.floor(x / w);
      else if (type === 'diag+') idx = Math.floor((x + y) / w);
      else if (type === 'diag-') idx = Math.floor((x + BE_IMG_GH - y) / w);
      else                       idx = Math.floor(Math.sqrt((x - BE_GW/2)**2 + (y - BE_IMG_GH/2)**2) / w);
      return pal[Math.abs(idx) % n];
    })
  );
}

function genPixelsCircles(palette) {
  const pal = _shuffled(palette);
  const cx = BE_GW * (0.25 + Math.random() * 0.5);
  const cy = BE_IMG_GH * (0.25 + Math.random() * 0.5);
  const rw = 1.5 + Math.random() * 4;
  const n = pal.length;
  return Array.from({length: BE_IMG_GH}, (_, y) =>
    Array.from({length: BE_GW}, (_, x) => {
      const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      return pal[Math.floor(r / rw) % n];
    })
  );
}

function genPixelsNoise(palette) {
  const pal = _shuffled(palette);
  const blockSize = _rInt(1, 3);
  return Array.from({length: BE_IMG_GH}, (_, y) =>
    Array.from({length: BE_GW}, (_, x) => {
      if (blockSize === 1) return pal[_rInt(0, pal.length - 1)];
      // Blocked noise — same random value per NxN cell
      const key = Math.floor(y / blockSize) * 1000 + Math.floor(x / blockSize);
      // deterministic per cell using seeded-like hash
      return pal[((key * 2654435761) >>> 0) % pal.length];
    })
  );
}

function genPixelsChecker(palette) {
  const pal = _shuffled(palette);
  const size = _rInt(2, 5);
  const offX = _rInt(0, size - 1), offY = _rInt(0, size - 1);
  return Array.from({length: BE_IMG_GH}, (_, y) =>
    Array.from({length: BE_GW}, (_, x) =>
      pal[(Math.floor((x + offX) / size) + Math.floor((y + offY) / size)) % pal.length]
    )
  );
}

function genPixelsMandala(palette) {
  const pal = _shuffled(palette);
  const n = pal.length;
  const sectors = _rChoice([4, 5, 6, 8, 10, 12, 16]);
  const rw = 1.2 + Math.random() * 4;
  const cx = BE_GW * (0.3 + Math.random() * 0.4);
  const cy = BE_IMG_GH * (0.3 + Math.random() * 0.4);
  const aspect = BE_GW / BE_IMG_GH;
  const sectorAngle = (Math.PI * 2) / sectors;
  const subtype = _rChoice(['ring', 'star', 'flower', 'wave', 'spiral']);
  const aWeight = _rInt(1, 6);
  const freq = 1 + Math.random() * 3;
  const petalN = _rChoice([3, 4, 5, 6, 8]);
  const phase = Math.random() * Math.PI * 2;
  const twist = 0.1 + Math.random() * 0.4;
  return Array.from({length: BE_IMG_GH}, (_, y) =>
    Array.from({length: BE_GW}, (_, x) => {
      const dx = x - cx, dy = (y - cy) * aspect;
      const r = Math.sqrt(dx * dx + dy * dy);
      const theta = Math.atan2(dy, dx);
      let a = ((theta + Math.PI * 2) % (Math.PI * 2)) % sectorAngle;
      if (a > sectorAngle / 2) a = sectorAngle - a;
      const rBand = Math.floor(r / rw);
      const aBand = Math.floor(a / (sectorAngle / 2) * aWeight);
      let idx;
      if (subtype === 'ring') {
        idx = rBand + aBand;
      } else if (subtype === 'star') {
        const starR = r + Math.cos(theta * sectors + phase) * rw;
        idx = Math.floor(starR / rw) + aBand;
      } else if (subtype === 'flower') {
        const petalR = r * (1 + 0.4 * Math.cos(theta * petalN + phase));
        idx = Math.floor(petalR / rw) + aBand;
      } else if (subtype === 'wave') {
        const wavy = Math.floor((r + Math.sin(theta * freq + phase) * rw) / rw);
        idx = wavy ^ aBand;
      } else {
        const spiral = Math.floor((r + theta * rw * twist * sectors / (Math.PI * 2)) / rw);
        idx = spiral + aBand;
      }
      return pal[((idx % n) + n) % n];
    })
  );
}

function genPixelsKaleido(palette, blockRatio) {
  const pal = _shuffled(palette);
  const hw = Math.ceil(BE_GW / 2), hh = Math.ceil(BE_IMG_GH / 2);
  const n = pal.length;
  // Velikost coarse grid se škáluje podle blockRatio (0..1):
  //   ratio=1.0 → gw=2 gh=2 (cell 9×7, max plochy = max bloků)
  //   ratio=0.5 → gw=3 gh=2 (cell 6×7)
  //   ratio=0.1 → gw=4 gh=3 (cell 4-5×4-5, min plocha pro 4×6 filtr)
  // Bez blockRatio (pixel-only mód) → původní 3-7 / 2-5 (víc detail).
  let gwMin, gwMax, ghMin, ghMax;
  if (typeof blockRatio === 'number') {
    const r = Math.max(0, Math.min(1, blockRatio));
    // Lineární mapování: čím nižší ratio, tím víc/menších cell.
    const gwTarget = Math.round(2 + (1 - r) * 2); // 2..4
    const ghTarget = Math.round(2 + (1 - r) * 1); // 2..3
    gwMin = gwMax = gwTarget;
    ghMin = ghMax = ghTarget;
  } else {
    gwMin = 3; gwMax = 7; ghMin = 2; ghMax = 5;
  }
  const gw = _rInt(gwMin, gwMax), gh = _rInt(ghMin, ghMax);
  const grid = Array.from({length: gh}, () =>
    Array.from({length: gw}, () => pal[_rInt(0, n - 1)])
  );
  const quad = Array.from({length: hh}, (_, y) =>
    Array.from({length: hw}, (_, x) => {
      const gx = Math.min(Math.floor(x / hw * gw), gw - 1);
      const gy = Math.min(Math.floor(y / hh * gh), gh - 1);
      return grid[gy][gx];
    })
  );
  return Array.from({length: BE_IMG_GH}, (_, y) =>
    Array.from({length: BE_GW}, (_, x) => {
      const qx = Math.min(x < hw ? x : BE_GW - 1 - x, hw - 1);
      const qy = Math.min(y < hh ? y : BE_IMG_GH - 1 - y, hh - 1);
      return quad[qy][qx];
    })
  );
}

function genPixelsKoridor(palette) {
  const pal = _shuffled(palette);
  const hw = _rInt(3, 5);
  const startY = _rInt(hw + 1, BE_IMG_GH - hw - 2);
  const path = [];
  let y = startY;
  for (let x = 0; x < BE_GW; x++) {
    path.push(y);
    const r = Math.random();
    const dy = r < 0.3 ? -1 : r < 0.6 ? 1 : 0;
    y = Math.max(hw + 1, Math.min(BE_IMG_GH - 2 - hw, y + dy));
  }
  const floor = pal[0];
  const walls = pal.length > 1 ? pal.slice(1) : pal;
  const pixels = Array.from({length: BE_IMG_GH}, (_, gy) =>
    Array.from({length: BE_GW}, (_, x) =>
      Math.abs(gy - path[x]) <= hw
        ? floor
        : walls[Math.floor(gy / BE_IMG_GH * walls.length) % walls.length]
    )
  );
  return { pixels, path, hw };
}

// Flood-fill: najde všechny souvislé regiony stejné barvy v pixel obraze.
// Vrací pole { color, cells: [{x,y}], bbox: {x0,y0,x1,y1} } seřazené od největšího.
function _findColorRegions(pixels) {
  if (!pixels) return [];
  const H = pixels.length, W = pixels[0].length;
  const visited = Array.from({ length: H }, () => new Array(W).fill(false));
  const regions = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (visited[y][x]) continue;
    const color = pixels[y][x];
    if (color == null || color < 0) { visited[y][x] = true; continue; }
    const cells = [];
    const stack = [[x, y]];
    let x0 = x, y0 = y, x1 = x, y1 = y;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      if (visited[cy][cx]) continue;
      if (pixels[cy][cx] !== color) continue;
      visited[cy][cx] = true;
      cells.push({ x: cx, y: cy });
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    regions.push({ color, cells, bbox: { x0, y0, x1, y1 } });
  }
  regions.sort((a, b) => b.cells.length - a.cells.length);
  return regions;
}

// Převede pixelové sekce na obdélníkové bloky: flood-fill najde všechny
// souvislé barevné plochy, zfiltruje ty co tvoří plný obdélník (bbox == cells),
// zamíchá je a vezme ratio × count. Každá vybraná sekce → 1 rect blok přes
// celou svou plochu, stejná barva, HP 40+. Bloky přesně překryjí pixely, zbytek
// sekcí zůstane jako pixely.
// Najdi největší obdélník v binární masce (true = volná buňka). Histogramová
// metoda — pro každý řádek udržuje výšky sloupců a počítá max obdélník
// stack-based v O(W). Vrátí {x,y,w,h,area} nebo null.
function _largestRectInMask(mask) {
  const H = mask.length;
  const W = mask[0] ? mask[0].length : 0;
  if (!H || !W) return null;
  const heights = new Array(W).fill(0);
  let bestArea = 0, bestRect = null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) heights[x] = mask[y][x] ? heights[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= W; x++) {
      const curH = x < W ? heights[x] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= curH) {
        const top = stack.pop();
        const left = stack.length ? stack[stack.length - 1] : -1;
        const w = x - left - 1;
        const h = heights[top];
        const area = w * h;
        if (area > bestArea) {
          bestArea = area;
          bestRect = { x: left + 1, y: y - h + 1, w, h, area };
        }
      }
      stack.push(x);
    }
  }
  return bestRect;
}

function genBlocksFromSections(pixels, ratio) {
  const H = pixels.length;
  const W = (pixels && pixels[0] && pixels[0].length) || 0;
  // Filtr: minimální rozměry kandidáta. Mirror-pair chceme aby vyšly i pro
  // sub-rectangly, takže držíme stejně volné minimum.
  const MIN_W = 4;
  const MIN_H = 6;

  // Per-barva 2D maska: true = pixel té barvy a JEŠTĚ neuzavřený do bloku.
  // Pak greedy extrahujeme největší obdélník, smažeme buňky z masky a opakujeme,
  // dokud zbývá obdélník splňující min rozměry. Tím ze stejnobarevné neobdélníkové
  // plochy získáme více ploch (ne jen perfect rect celé plochy).
  const colorMasks = {};
  let totalPixels = 0;
  for (let y = 0; y < H; y++) {
    const row = pixels[y];
    if (!Array.isArray(row)) continue;
    for (let x = 0; x < W; x++) {
      const c = row[x];
      if (c == null || c < 0) continue;
      totalPixels++;
      if (!colorMasks[c]) {
        colorMasks[c] = Array.from({ length: H }, () => new Array(W).fill(false));
      }
      colorMasks[c][y][x] = true;
    }
  }

  const candidates = [];
  for (const [colorStr, mask] of Object.entries(colorMasks)) {
    const color = parseInt(colorStr, 10);
    while (true) {
      const r = _largestRectInMask(mask);
      if (!r) break;
      if (r.w < MIN_W || r.h < MIN_H) break;
      candidates.push({ x: r.x, y: r.y, w: r.w, h: r.h, color, area: r.area });
      // Smaž buňky obdélníku z masky pro další iteraci.
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) mask[yy][xx] = false;
      }
    }
  }
  // Mirror páry: pro každého kandidáta najdi odpovídající zrcadlový (stejná
  // barva, stejné rozměry, x = W - x - w). Self-mirror = kandidát sám sedí
  // na zrcadlové ose. Lone = bez páru.
  // Skládáme do struktur { primary, mirror? } a řadíme PÁRY PRVNÍ podle area
  // (zrcadlově symetrické rozložení = vizuální priorita > přesné %).
  const taken = new Set();
  const pairs = []; // { primary, mirror|null, area, lone }
  for (let i = 0; i < candidates.length; i++) {
    if (taken.has(i)) continue;
    const a = candidates[i];
    const mirrorX = W - a.x - a.w;
    if (a.x === mirrorX) {
      // Self-mirror (sedí na ose) — okamžitě brát, počítá jako 1 blok
      taken.add(i);
      pairs.push({ primary: a, mirror: null, area: a.area, lone: false, self: true });
      continue;
    }
    let mIdx = -1;
    for (let j = i + 1; j < candidates.length; j++) {
      if (taken.has(j)) continue;
      const b = candidates[j];
      if (b.x === mirrorX && b.y === a.y && b.w === a.w && b.h === a.h && b.color === a.color) {
        mIdx = j; break;
      }
    }
    if (mIdx >= 0) {
      taken.add(i); taken.add(mIdx);
      pairs.push({ primary: a, mirror: candidates[mIdx], area: a.area * 2, lone: false, self: false });
    } else {
      taken.add(i);
      pairs.push({ primary: a, mirror: null, area: a.area, lone: true, self: false });
    }
  }
  // Páry / self-mirror první (lone naposled), uvnitř každé skupiny dle area DESC.
  pairs.sort((p, q) => {
    if (p.lone !== q.lone) return p.lone ? 1 : -1;
    return q.area - p.area;
  });

  // Target: ratio × celkové plochy pixelů. Bereme páry/bloky podle area DESC,
  // dokud jejich kumulativní plocha nedosáhne targetArea. Mirror pair = vizuální
  // priorita, takže pár se vždy vezme celý (může lehce přesáhnout target).
  const targetArea = Math.max(1, Math.round(totalPixels * ratio));
  let coveredArea = 0;
  const result = [];
  // HP tiers podle plochy bloku — diskrétní {40, 80, 120} hodnoty.
  const hpForArea = (area) => {
    if (area < 20) return 40;
    if (area < 40) return 80;
    return 120;
  };
  for (const p of pairs) {
    if (coveredArea >= targetArea) break;
    const hp = hpForArea(p.primary.w * p.primary.h);
    result.push({
      x: p.primary.x, y: p.primary.y, w: p.primary.w, h: p.primary.h,
      shape: 'rect', kind: 'solid', color: p.primary.color, hp, rotation: 0,
    });
    coveredArea += p.primary.w * p.primary.h;
    if (p.mirror) {
      result.push({
        x: p.mirror.x, y: p.mirror.y, w: p.mirror.w, h: p.mirror.h,
        shape: 'rect', kind: 'solid', color: p.mirror.color, hp, rotation: 0,
      });
      coveredArea += p.mirror.w * p.mirror.h;
    }
  }
  return result;
}

function doGenerate() {
  const lvl = beCurrentLvl();
  if (!lvl) return;
  const modeEl = document.querySelector('input[name="gen-mode"]:checked');
  const mode = modeEl ? modeEl.value : 'pixels';

  const palette = _genPalette(lvl);
  histPush(lvl, 'generate-' + _genStyle);
  // Když je mode 'blocks', použij ratio i k řízení velikosti pixel-cells
  // v kaleido (víc % bloků = větší jednobarevné plochy = víc kandidátů).
  const blockRatio = (mode === 'blocks')
    ? parseInt($('gen-block-ratio').value || 50) / 100
    : null;

  let pixels;
  if (_genStyle === 'circles')       pixels = genPixelsCircles(palette);
  else if (_genStyle === 'noise')    pixels = genPixelsNoise(palette);
  else if (_genStyle === 'checker')  pixels = genPixelsChecker(palette);
  else if (_genStyle === 'mandala')  pixels = genPixelsMandala(palette);
  else if (_genStyle === 'kaleido')  pixels = genPixelsKaleido(palette, blockRatio);
  else if (_genStyle === 'koridor')  { const r = genPixelsKoridor(palette); pixels = r.pixels; }
  else                               pixels = genPixelsStripes(palette);

  lvl.image = { source: 'custom', pixels };
  const srcSel = $('f-image-source');
  if (srcSel) srcSel.value = 'custom';

  if (mode === 'blocks') {
    lvl.blocks = genBlocksFromSections(pixels, blockRatio);
  } else {
    lvl.blocks = [];
  }

  beUpdatePixelToolbarVisibility();
  renderBlockCanvas();
  markDirty();
  $('gen-panel').hidden = true;
}

function wireGenerator() {
  const toggleBtn = $('pt-generate');
  const panel = $('gen-panel');
  if (!toggleBtn || !panel) return;

  toggleBtn.addEventListener('click', () => { panel.hidden = !panel.hidden; });

  document.querySelectorAll('.gen-style').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      _genStyle = btn.dataset.style;
      document.querySelectorAll('.gen-style').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  const ratioRow = $('gen-block-ratio-row');
  function updateRows() {
    const modeEl = document.querySelector('input[name="gen-mode"]:checked');
    const mode = modeEl ? modeEl.value : 'pixels';
    if (ratioRow) ratioRow.hidden = (mode !== 'blocks');
    // V režimu „Bloky + pixely" má smysl jen kaleido styl (stejnobarevné
    // souvislé plochy, do kterých dobře sednou velké obdélníkové bloky).
    // Ostatní styly (Pruhy, Kruhy, Šum, Šachy, Mandala, Koridor) generují
    // fragmentovanou nebo úzkou geometrii bez dostatečně velkých rect oblastí.
    document.querySelectorAll('.gen-style').forEach(b => {
      if (mode === 'blocks') {
        const isKaleido = b.dataset.style === 'kaleido';
        b.disabled = !isKaleido;
        if (isKaleido) {
          _genStyle = 'kaleido';
          document.querySelectorAll('.gen-style').forEach(bb => bb.classList.toggle('active', bb === b));
        }
      } else {
        b.disabled = false;
      }
    });
  }
  document.querySelectorAll('input[name="gen-mode"]').forEach(r => r.addEventListener('change', updateRows));
  // Inicializace na startu (pro případ, že je pre-selected mode 'blocks').
  updateRows();

  const ratioSlider = $('gen-block-ratio');
  const ratioVal = $('gen-block-ratio-val');
  if (ratioSlider) ratioSlider.addEventListener('input', () => {
    if (ratioVal) ratioVal.textContent = ratioSlider.value + ' %';
  });

  const goBtn = $('gen-go');
  if (goBtn) goBtn.addEventListener('click', doGenerate);
}

// Wire up editor DOM (volá se jednou v boot()).
function wireBlockEditor() {
  const cvs = $('be-canvas');
  if (!cvs) return;

  // Canvas jako drop target pro palette-drag
  cvs.addEventListener('dragover', (e) => {
    if (!beState.drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const p = bePxFromEvent(e);
    beState.mousePx = p;
    renderBlockCanvas();
  });
  cvs.addEventListener('dragleave', () => {
    beState.mousePx = null;
    renderBlockCanvas();
  });
  cvs.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!beState.drag) return;
    const p = bePxFromEvent(e);
    beAddBlockFromDrag(p.x, p.y);
    beState.drag = null;
    beState.mousePx = null;
  });

  // Hover cursor pro edge handles — sleduje pohyb a mění cursor.
  cvs.addEventListener('mousemove', (e) => {
    if (beState.pxDragging || beState.pxRectStart || beState.drag || beState.beResizing) return;
    const lvl = beCurrentLvl();
    const sel = lvl && lvl.blocks && lvl.blocks[beState.selectedBlockIdx];
    if (!sel) { cvs.style.cursor = ''; return; }
    const p = bePxFromEvent(e);
    const edge = beHitEdge(sel, p.x, p.y);
    if (edge) {
      cvs.style.cursor = BE_EDGE_CURSORS[edge] || 'pointer';
    } else {
      const hit = beHitTest(Math.floor(p.x), Math.floor(p.y));
      cvs.style.cursor = (hit >= 0) ? 'move' : '';
    }
  });

  // Klik na plátno → hit-test; existující blok = select, jinak deselect.
  cvs.addEventListener('mousedown', (e) => {
    cvs.focus();
    const p = bePxFromEvent(e);
    const lvl = beCurrentLvl();
    const isCustom = lvl && lvl.image && lvl.image.source === 'custom';

    // Pokud máme selected block a klik je na jeho EDGE → resize-drag.
    // Guard: když je aktivní pixel paint mode (rect-fill / rect-erase už drží
    // start, NEBO drag-paint běží), nech pixel painter převzít — resize handles
    // by se duplicitně aktivovaly. Cursor feedback (mousemove výše) už respektuje
    // tyto flagy, takže designer cursor ani neuvidí jako resize.
    const sel = lvl && lvl.blocks && lvl.blocks[beState.selectedBlockIdx];
    if (sel && !beState.pxDragging && !beState.pxRectStart) {
      const edge = beHitEdge(sel, p.x, p.y);
      if (edge) {
        e.preventDefault();
        const startX = sel.x, startY = sel.y, startW = sel.w, startH = sel.h;
        let resized = false;
        beState.beResizing = true;
        const onMove = (ev) => {
          const pp = bePxFromEvent(ev);
          let nx = startX, ny = startY, nw = startW, nh = startH;
          if (edge.includes('e')) {
            nw = Math.max(1, Math.min(BE_GW - startX, Math.round(pp.x - startX)));
          }
          if (edge.includes('w')) {
            const right = startX + startW;
            const newX = Math.max(0, Math.min(right - 1, Math.round(pp.x)));
            nx = newX;
            nw = right - newX;
          }
          if (edge.includes('s')) {
            nh = Math.max(1, Math.min(BE_IMG_GH - startY, Math.round(pp.y - startY)));
          }
          if (edge.includes('n')) {
            const bot = startY + startH;
            const newY = Math.max(0, Math.min(bot - 1, Math.round(pp.y)));
            ny = newY;
            nh = bot - newY;
          }
          if (nx !== sel.x || ny !== sel.y || nw !== sel.w || nh !== sel.h) {
            if (!resized) histPush(lvl, 'block-resize-drag-' + Date.now());
            sel.x = nx; sel.y = ny; sel.w = nw; sel.h = nh;
            resized = true;
            renderBlockCanvas();
            renderSelectedBlockPanel();
          }
        };
        const onUp = () => {
          beState.beResizing = false;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          if (resized) markDirty();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }
    }

    // Pixel-editor režim má přednost u custom levelů a KDYŽ nebyl trefen blok.
    // (Blok drag-move má přednost — intuitivnější: klik na blok vždy = manipulace s blokem.)
    const hitIdx = beHitTest(Math.floor(p.x), Math.floor(p.y));
    if (isCustom && hitIdx < 0) {
      const tool = beState.pxTool;
      if (tool === 'paint' || tool === 'erase') {
        // Celý drag = 1 undo krok. Push ještě PŘED první úpravou pixelu.
        histPush(lvl, 'pixel-drag-' + Date.now());
        bePaintPixelAt(p.x, p.y, tool === 'paint' ? beState.pxColor : -1);
        beState.pxDragging = true;
        beState.pxDragErase = (tool === 'erase');
        const onMove = (ev) => {
          const pp = bePxFromEvent(ev);
          bePaintPixelAt(pp.x, pp.y, beState.pxDragErase ? -1 : beState.pxColor);
        };
        const onUp = () => {
          beState.pxDragging = false;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          markDirty();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      } else if (tool === 'rect-fill' || tool === 'rect-erase') {
        beState.pxRectStart = { x: Math.floor(p.x), y: Math.floor(p.y) };
        beState.pxRectEnd   = { x: Math.floor(p.x), y: Math.floor(p.y) };
        renderBlockCanvas();
        const onMove = (ev) => {
          const pp = bePxFromEvent(ev);
          beState.pxRectEnd = {
            x: Math.max(0, Math.min(BE_GW - 1, Math.floor(pp.x))),
            y: Math.max(0, Math.min(BE_IMG_GH - 1, Math.floor(pp.y))),
          };
          renderBlockCanvas();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          // Rect = 1 undo krok. Push PŘED apply, aby snapshot zachytil
          // pixely v jejich stavu před vyplněním obdélníku.
          histPush(lvl, 'pixel-rect-' + Date.now());
          beApplyPixelRect(tool === 'rect-fill' ? beState.pxColor : -1);
          beState.pxRectStart = null;
          beState.pxRectEnd = null;
          renderBlockCanvas();
          markDirty();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }
      // fallthrough: pokud by tool byl neznámý, spadne to na select-mode níže
    }

    const idx = hitIdx;
    if (idx !== beState.selectedBlockIdx) {
      beSelectBlock(idx);
    }
    // Pokud trefil blok, příprava na drag-move.
    if (idx >= 0) {
      const lvl = beCurrentLvl();
      const b = lvl.blocks[idx];
      const offX = p.x - b.x;
      const offY = p.y - b.y;
      let moved = false;
      const onMove = (ev) => {
        const pp = bePxFromEvent(ev);
        const nx = Math.max(0, Math.min(BE_GW - b.w, Math.floor(pp.x - offX)));
        const ny = Math.max(0, Math.min(BE_IMG_GH - b.h, Math.floor(pp.y - offY)));
        if (nx !== b.x || ny !== b.y) {
          // Push do historie JEN jednou za drag (v okamžiku kdy se poprvé
          // skutečně pohlo). Pushujeme PŘED vlastní mutací pozice.
          if (!moved) histPush(lvl, 'block-move-drag-' + Date.now());
          b.x = nx; b.y = ny;
          moved = true;
          renderBlockCanvas();
          renderSelectedBlockPanel();
        }
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (moved) markDirty();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  });

  // Klávesnice – funguje když má canvas focus.
  cvs.addEventListener('keydown', (e) => {
    if (beState.selectedBlockIdx < 0) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      beDeleteSelected();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      beRotateSelected();
    } else if (e.key === 'ArrowLeft')  { e.preventDefault(); beMoveSelected(-1, 0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); beMoveSelected( 1, 0); }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); beMoveSelected( 0,-1); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); beMoveSelected( 0, 1); }
    else if (e.key === 'Escape')     { beSelectBlock(-1); }
  });

  // Sidebar: kind segment buttons
  document.querySelectorAll('#be-sel-wrap .be-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lvl = beCurrentLvl();
      const b = lvl && lvl.blocks[beState.selectedBlockIdx];
      if (!b) return;
      histPush(lvl, 'block-kind');
      b.kind = btn.dataset.kind === 'mystery' ? 'mystery' : 'solid';
      renderSelectedBlockPanel();
      renderBlockCanvas();
      markDirty();
    });
  });

  // Sidebar: shape
  $('be-sel-shape').addEventListener('change', (e) => {
    const lvl = beCurrentLvl();
    const b = lvl && lvl.blocks[beState.selectedBlockIdx];
    if (!b) return;
    histPush(lvl, 'block-shape');
    b.shape = e.target.value;
    renderBlockCanvas();
    markDirty();
  });

  // Sidebar: w/h/x/y/hp — input events během slider dragu: coalesce pomocí
  // actionKey (stejný klíč v okně 500ms = 1 undo krok).
  const bindNum = (id, fn, actionKey) => {
    $(id).addEventListener('input', (e) => {
      const lvl = beCurrentLvl();
      const b = lvl && lvl.blocks[beState.selectedBlockIdx];
      if (!b) return;
      const v = parseInt(e.target.value, 10);
      if (Number.isNaN(v)) return;
      histPush(lvl, actionKey);
      fn(b, v);
      renderBlockCanvas();
      markDirty();
    });
  };
  bindNum('be-sel-w', (b, v) => { b.w = Math.max(1, Math.min(BE_GW, v)); if (b.x + b.w > BE_GW) b.x = BE_GW - b.w; }, 'block-w');
  bindNum('be-sel-h', (b, v) => { b.h = Math.max(1, Math.min(BE_IMG_GH, v)); if (b.y + b.h > BE_IMG_GH) b.y = BE_IMG_GH - b.h; }, 'block-h');
  bindNum('be-sel-x', (b, v) => { b.x = Math.max(0, Math.min(BE_GW - b.w, v)); }, 'block-x');
  bindNum('be-sel-y', (b, v) => { b.y = Math.max(0, Math.min(BE_IMG_GH - b.h, v)); }, 'block-y');
  $('be-sel-hp').addEventListener('input', (e) => {
    const lvl = beCurrentLvl();
    const b = lvl && lvl.blocks[beState.selectedBlockIdx];
    if (!b) return;
    histPush(lvl, 'block-hp');
    b.hp = Math.max(1, parseInt(e.target.value, 10) || 1);
    $('be-sel-hp-val').textContent = b.hp;
    renderBlockCanvas();
    markDirty();
  });

  $('be-rotate').addEventListener('click', beRotateSelected);
  $('be-delete').addEventListener('click', beDeleteSelected);
}

// ═══════════════════════════════════════════════════════════════════════════
// Form event wiring --------------------------------------------------------
function wireForm() {
  const lvl = () => state.levels[state.selectedIdx];

  $('f-key').addEventListener('input', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-key');
    const oldKey = L.key;
    const newKey = e.target.value.trim();
    L.key = newKey;
    // Migrate state mapy pod nový klíč (orphan stats by jinak zůstaly pod oldKey).
    _migrateStatsKey(oldKey, newKey);
    // Force preview reload — URL pro iframe se mění (ten odečítá `?level=KEY`).
    // Bez resetu `_lastPreviewKey` by `renderEditor` neviděl změnu (selectedIdx
    // je stejný) a preview by čekal na klíč, co už neexistuje.
    _lastPreviewKey = null;
    markDirty();
    renderList(); // update title preview
  });
  $('f-label').addEventListener('input', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-label');
    L.label = e.target.value;
    markDirty();
    renderList();
  });
  $('f-type').addEventListener('change', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-type');
    L.type = e.target.value;
    markDirty();
    // Sync summary badge + list entry bez čekání na full re-render.
    const diff = typeBadge(L);
    const badge = $('summary-badge');
    badge.textContent = diff.label;
    badge.className = 'diff-badge diff-' + diff.key;
    renderList();
  });
  $('f-image-source').addEventListener('change', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-imgsrc');
    const newSrc = e.target.value;
    const existing = L.image || {};
    // Custom: zachovej případné pixely (návrat zpět na custom po odbočce).
    // Preset: zapomeň pixels, uložíme jen source.
    if (newSrc === 'custom') {
      L.image = { source: 'custom', pixels: Array.isArray(existing.pixels) ? existing.pixels : beBlankPixels() };
    } else {
      L.image = { source: newSrc };
    }
    beUpdatePixelToolbarVisibility();
    renderBlockCanvas();
    markDirty();
    // Force preview reload — image source určuje co hra renderuje (smiley vs
    // moon vs custom pixels). Bez explicit schedule by se reload udělal jen
    // přes autosave (400ms), ale když user mezi tím změnil i jiný field,
    // _lastPreviewKey by mohl zůstat stejný a renderEditor reload neschedule.
    schedulePreviewReload();
  });
  // Image difficulty slider byl odstraněn — Type (f-type) je teď jediná osa
  // obtížnosti, kterou designer nastavuje. Viz komentář u typeBadge.

  $('f-gravity-on').addEventListener('change', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-gravity-on');
    if (e.target.checked) L.gravity = true;
    else delete L.gravity;
    markDirty();
  });

  // Rockets/Garage toggle handlery odebrány — viz comment v loadFormFromLvl.

  $('btn-delete').addEventListener('click', () => {
    if (state.selectedIdx >= 0) deleteLevel(state.selectedIdx);
  });
  $('btn-close').addEventListener('click', () => {
    state.selectedIdx = -1;
    updateUI();
  });
}

// Top-level buttons ---------------------------------------------------------
function wireHeader() {
  $('btn-connect').addEventListener('click', connectFolder);
  $('btn-load').addEventListener('click', reloadFromDisk.bind(null));
  $('btn-publish').addEventListener('click', publishToGame);
  $('btn-add').addEventListener('click', addLevel);
  $('btn-add-from-empty').addEventListener('click', addLevel);
}

function wirePreview() {
  const diffSel = $('preview-diff');
  if (diffSel) diffSel.addEventListener('change', () => reloadPreview());
  const refresh = $('btn-preview-refresh');
  if (refresh) refresh.addEventListener('click', () => reloadPreview());
}

// Undo/Redo wiring: tlačítka v edit-panelu + globální keyboard shortcuts.
// Shortcuts se vykonají jen když fokus NENÍ v text inputu/textarea (jinak
// bychom přebili nativní undo v inputu), s výjimkou canvasu (ten má vlastní
// handler pro arrow/Del, ne pro Z).
function wireHistory() {
  const btnU = $('btn-undo');
  const btnR = $('btn-redo');
  if (btnU) btnU.addEventListener('click', histUndo);
  if (btnR) btnR.addEventListener('click', histRedo);

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;

    // Nevstupujeme do cesty nativnímu undo v textovém inputu — editovaný text
    // má vlastní per-field historii v browseru, zmatek kdyby oba zasáhly najednou.
    const tgt = e.target;
    const tag = tgt && tgt.tagName;
    const isTextInput = tgt && (
      (tag === 'INPUT' && /^(text|search|email|url|tel|password|number)$/i.test(tgt.type || 'text')) ||
      tag === 'TEXTAREA' ||
      tgt.isContentEditable
    );
    if (isTextInput) return;

    // Cmd+Z / Ctrl+Z       = undo
    // Cmd+Shift+Z / Ctrl+Y = redo  (Ctrl+Y je Windows/Linux konvence)
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      histUndo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      histRedo();
    }
  });
}

// Boot ----------------------------------------------------------------------
// postMessage listener — preview iframe (gamee) posílá pxCounts per level×diff
// každý startLevel. Ukládáme pro capacity helper + re-render layoutu, pokud
// jsme zrovna na dotčeném levelu/diffu.
function wireLevelStats() {
  window.addEventListener('message', (ev) => {
    const m = ev && ev.data;
    if (!m || typeof m.type !== 'string') return;

    if (m.type === 'balloonbelt:level-stats' && m.levelKey && Array.isArray(m.pxCounts)) {
      const diff = m.difficulty || 'easy';
      if (!state.pxCountsByLevel[m.levelKey]) state.pxCountsByLevel[m.levelKey] = {};
      state.pxCountsByLevel[m.levelKey][diff] = m.pxCounts.slice(0, BE_COLORS.length);
      if (Array.isArray(m.projCounts)) {
        if (!state.projCountsByLevel) state.projCountsByLevel = {};
        if (!state.projCountsByLevel[m.levelKey]) state.projCountsByLevel[m.levelKey] = {};
        state.projCountsByLevel[m.levelKey][diff] = m.projCounts.slice(0, BE_COLORS.length);
      }
      // Status neresetujeme — applied/fallback message chodí v rámci stejného startLevel
      // a může přijít *před* level-stats (v game.js: buildColsFromLayout posílá applied
      // uvnitř makeColumns, level-stats až potom). Reset by jen smazal čerstvý výsledek.
      _maybeRerenderCapacity(m.levelKey, diff);
      return;
    }

    if ((m.type === 'balloonbelt:layout-applied' || m.type === 'balloonbelt:layout-fallback') && m.levelKey) {
      const diff = m.difficulty || 'easy';
      if (!state.layoutStatusByLevel[m.levelKey]) state.layoutStatusByLevel[m.levelKey] = {};
      state.layoutStatusByLevel[m.levelKey][diff] = {
        applied: m.type === 'balloonbelt:layout-applied',
        reason: m.reason || null,
        layoutName: m.layoutName || null,
      };
      _maybeRerenderCapacity(m.levelKey, diff);
      return;
    }
  });
}

function _maybeRerenderCapacity(levelKey, diff) {
  const lvl = beCurrentLvl();
  if (lvl && lvl.key === levelKey && state.clActiveDiff === diff) {
    // Full render — pxCounts/status ovlivňují i enable stav generator buttons.
    renderCarrierLayout(lvl);
  }
  // Sidebar status badge se mění podle nových pxCounts/layoutStatus — překresli list.
  renderList();
}

// Drag-resize panelů (Levels / Edit / Preview). Šířky se ukládají do localStorage.
function wirePanelResizers() {
  const main = $('app-main');
  if (!main) return;
  const KEY = 'bb-editor-panel-widths';
  // Defaults — match initial CSS (col-list 280px, col-preview 520px, edit fills rest 1fr)
  const defaults = { list: 280, preview: 520 };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  const widths = { ...defaults, ...saved };

  function apply() {
    main.style.setProperty('--col-list', widths.list + 'px');
    main.style.setProperty('--col-preview', widths.preview + 'px');
    // edit zůstává 1fr — vyplní zbytek
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(widths)); } catch (e) {}
  }
  apply();

  document.querySelectorAll('.col-resizer').forEach(el => {
    el.addEventListener('mousedown', startDrag);
  });

  function startDrag(e) {
    e.preventDefault();
    const el = e.currentTarget;
    const which = el.dataset.resizer; // 'list-edit' | 'edit-preview'
    const rect = main.getBoundingClientRect();
    const startX = e.clientX;
    const startList = widths.list;
    const startPreview = widths.preview;
    el.classList.add('dragging');
    document.body.style.cursor = 'col-resize';

    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (which === 'list-edit') {
        // pozitivní dx → list širší
        widths.list = Math.max(180, Math.min(rect.width - widths.preview - 360, startList + dx));
      } else if (which === 'edit-preview') {
        // pozitivní dx → preview UŽŠÍ (handle se posouvá doprava → edit širší, preview menší)
        widths.preview = Math.max(360, Math.min(rect.width - widths.list - 360, startPreview - dx));
      }
      apply();
    }
    function onUp() {
      el.classList.remove('dragging');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      persist();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
}

// Section collapse persist — pamatuje, které z 3 collapsible sekcí (Informace
// /Obraz/Grid) má designer otevřené. Bez toho by se po reloadu vždy všechny
// otevřely a designer musí znovu posbírat preferovaný layout.
function wireSectionCollapsePersist() {
  const KEY = 'bb-editor-section-state';
  const sections = [
    { sel: '.ed-section-info',  id: 'info' },
    { sel: '.ed-section-image', id: 'image' },
    { sel: '.ed-section-grid',  id: 'grid' },
  ];
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  sections.forEach(({ sel, id }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    if (saved[id] === false) el.removeAttribute('open');
    else if (saved[id] === true) el.setAttribute('open', '');
    el.addEventListener('toggle', () => {
      saved[id] = el.open;
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
    });
  });
}

function boot() {
  if (!state.fsaSupported) {
    $('btn-connect').textContent = '❌ FSA not supported';
    $('btn-connect').disabled = true;
    setLastAction('File System Access API is not available in this browser. Use Chrome or Edge.');
  }
  wireHeader();
  wireForm();
  wirePreview();
  wireBlockEditor();
  wirePixelToolbar();
  wireCarrierLayout();
  wireLevelStats();
  wireHistory();
  wirePanelResizers();
  wireSectionCollapsePersist();
  renderBlockPalette();
  updateUI();
  tryRestoreConnection();
}
boot();

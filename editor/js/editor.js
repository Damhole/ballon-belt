// ═══════════════════════════════════════════════════════════════════════════
// Balloon Belt — Level Editor (vanilla JS)
// Uses File System Access API to read editor/levels.json and write gamee/js/levels.js.
// Falls back to download-only mode if FSA API isn't supported (Safari/Firefox).
// Directory handle persists in IndexedDB so reconnect isn't needed on next visit.
// ═══════════════════════════════════════════════════════════════════════════

const IMAGE_SOURCES = ['smiley', 'moon', 'starwars', 'frog', 'mondrian'];
const LEVEL_TYPES = ['relaxing', 'easy', 'medium', 'hard', 'hardcore'];

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

// Otočí masku o 90° po směru hodinových ručiček.
// Vstup: m[nRows][nCols] → výstup: m[nCols][nRows]
function _rotateMaskCW(m, nRows, nCols) {
  const out = [];
  for (let r = 0; r < nCols; r++) out.push(new Array(nRows).fill(false));
  for (let y = 0; y < nRows; y++)
    for (let x = 0; x < nCols; x++)
      out[x][nRows - 1 - y] = m[y][x];
  return out;
}

// Port blockMask z game.js (1:1 identický, aby editor renderoval tvary stejně jako hra).
// rot = 0..3 otočení o 90° CW. w, h jsou zobrazované (effective) rozměry.
function beBlockMask(shape, w, h, rot) {
  rot = ((rot || 0) % 4 + 4) % 4;
  // Kanonické (neotočené) rozměry — základ pro výpočet masky
  const bw = rot % 2 === 0 ? w : h;
  const bh = rot % 2 === 0 ? h : w;
  const m = [];
  for (let y = 0; y < bh; y++) m.push(new Array(bw).fill(false));
  if (shape === 'rect') {
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) m[y][x] = true;
  } else if (shape === 'cross') {
    const cx = Math.floor((bw - 1) / 2), cy = Math.floor((bh - 1) / 2);
    const armW = Math.max(1, Math.floor(bw / 3)), armH = Math.max(1, Math.floor(bh / 3));
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (Math.abs(y - cy) <= Math.floor(armH / 2)) m[y][x] = true;
      if (Math.abs(x - cx) <= Math.floor(armW / 2)) m[y][x] = true;
    }
  } else if (shape === 'L') {
    const thick = Math.max(1, Math.floor(Math.min(bw, bh) / 2));
    for (let y = 0; y < bh; y++) for (let x = 0; x < thick; x++) m[y][x] = true;
    for (let y = bh - thick; y < bh; y++) for (let x = 0; x < bw; x++) m[y][x] = true;
  } else if (shape === 'T') {
    const thick = Math.max(1, Math.floor(Math.min(bw, bh) / 2));
    for (let y = 0; y < thick; y++) for (let x = 0; x < bw; x++) m[y][x] = true;
    const stemW = Math.max(1, Math.floor(bw / 3));
    const stemX = Math.floor((bw - stemW) / 2);
    for (let y = thick; y < bh; y++) for (let x = stemX; x < stemX + stemW; x++) m[y][x] = true;
  } else if (shape === 'circle') {
    const cx = (bw - 1) / 2, cy = (bh - 1) / 2, rx = bw / 2, ry = bh / 2;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      m[y][x] = (nx * nx + ny * ny) <= 1.0;
    }
  }
  // Aplikuj rotaci
  let res = m, cw = bw, ch = bh;
  for (let i = 0; i < rot; i++) {
    res = _rotateMaskCW(res, ch, cw);
    [cw, ch] = [ch, cw];
  }
  return res;
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
  altHeld: false,           // Alt drženo → pipette cursor (visual feedback Alt+klik nasaje barvu)
  selectedBlocks: new Set(), // indexy bloků v multi-selectu (vždy sync s selectedBlockIdx)
  rubberBandStart: null,    // {x,y} v image-px — začátek rubber-band tažení
  rubberBandEnd: null,      // {x,y} aktuální konec rubber-bandu
};

// Clipboard pro copy/paste bloku (in-memory, přežije přepnutí levelu).
let _beCopiedBlock = null;

// Pipette / eyedropper cursor — SVG kapátko (žluté, černý outline). Když je Alt drženo
// nad pixel canvasem custom levelu, zobrazí se místo default cursoru. Hot-spot 2,22
// = špička kapátka vlevo dole.
const PIPETTE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M21 3l-3-3-7 7-1-1-2 2 2 2-7 7v3h3l7-7 2 2 2-2-1-1z' fill='%23ffea00' stroke='%23000' stroke-width='1.5' stroke-linejoin='round'/></svg>") 2 22, crosshair`;

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
  beState.selectedBlocks = new Set();
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
  // Force aktuálně vybranou variantu (jinak hra losuje náhodně mezi variantami
  // pro stejný diff a designer vidí jinou než tu, kterou má v editoru otevřenou).
  const activeV = clActiveVariant(lvl);
  const variantParam = (activeV && activeV.name && activeV.difficulty === diff)
    ? '&variant=' + encodeURIComponent(activeV.name) : '';
  const url = '../gamee/index_local.html?level=' + encodeURIComponent(lvl.key) +
              '&diff=' + encodeURIComponent(diff) +
              variantParam +
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
  easy:     { key: 'easy',     label: 'Easy' },
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
  const diffs = ['easy', 'medium', 'hard', 'hardcore'];
  const statusBag = state.layoutStatusByLevel[lvl.key] || {};
  const pxBag    = state.pxCountsByLevel[lvl.key]    || {};
  const projBag  = state.projCountsByLevel[lvl.key]  || {};
  for (const d of diffs) {
    const v = layouts.find(vv => vv && vv.difficulty === d);
    if (!v) continue; // chybějící layout není error — auto-gen to zvládne
    const st = statusBag[d];
    if (st && st.applied === false) {
      problems.push(d + ': layout spadl na auto-gen (' + (st.reason || 'neznámý důvod') + ')');
      continue;
    }
    const px = pxBag[d] || pxBag.hard || pxBag.medium || pxBag.easy;
    if (!px) continue;

    // Preferuj game-truth projCounts z preview (hra ví přesně kolik projektilů postavila).
    // Fallback: konzervativní slot-count odhad (předpokládá max CL_PROJECTILES_PER_CARRIER/slot).
    // Fallback dává false positive pro barvy s hodně pixely — hra přidělí víc proj/nosič.
    const proj = projBag[d] || null;
    if (proj) {
      // Game-truth check — autoritativní.
      for (let c = 0; c < BE_COLORS.length; c++) {
        const need = px[c] | 0;
        if (need <= 0) continue;
        const have = proj[c] | 0;
        if (have < need) problems.push(d + ': barva ' + c + ' má ' + have + '/' + need + ' px (deficit ' + (need - have) + ')');
      }
    } else {
      // Fallback: slot-based odhad. Používej vyšší práh (2× default) aby se omezily
      // false-positivy u barev s hodně pixely (hra přiděluje >40 proj/nosič když je
      // nosičů méně než minimum). Skutečná chyba se projeví až po načtení preview.
      const slotsByColor = clCountLayoutSlotsByColor(v);
      for (let c = 0; c < BE_COLORS.length; c++) {
        const need = px[c] | 0;
        if (need <= 0) continue;
        const needSlots = Math.ceil(need / (CL_PROJECTILES_PER_CARRIER * 2)); // 2× buffer
        if ((slotsByColor[c] || 0) < needSlots) {
          problems.push(d + ': barva ' + c + ' potřebuje ≥' + needSlots + ' slot(ů), layout má ' + (slotsByColor[c] || 0) + ' (otevři preview pro přesná čísla)');
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
      beState.selectedBlocks = new Set();
      beState.drag = null;
      beState.pxDragging = false;
      beState.beResizing = false;
      beState.pxRectStart = null;
      beState.pxRectEnd = null;
      beState.mousePx = null;
    }
    // Carrier layout: reset variant selector na první variantu pro current diff.
    state.clActiveVariantIdx = -1;
    // Přepni na pinnnutou complexity tohoto levelu (pokud existuje), jinak zachovej
    // aktuální výběr — designer tak vždy vidí relevantní variantu hned po přepnutí.
    if (lvl.defaultComplexity && CL_DIFFICULTIES.includes(lvl.defaultComplexity)) {
      state.clActiveDiff = lvl.defaultComplexity;
    }
    // Sync preview-diff dropdown na clActiveDiff — bez toho zůstane default 'easy'
    // a reloadPreview pošle hru se špatnou difficulty (i když pin je hard).
    const diffSel = $('preview-diff');
    if (diffSel && state.clActiveDiff && diffSel.value !== state.clActiveDiff) {
      diffSel.value = state.clActiveDiff;
    }
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
function clBlankGrid(rows, cols) {
  cols = cols || CL_COLS;
  const g = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push({ type: 'wall' });
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
// Vrátí aktuální počet sloupců varianty (fallback na CL_COLS = 7).
function clGetCols(variant) {
  return (variant && typeof variant.cols === 'number' && variant.cols >= 1)
    ? variant.cols : CL_COLS;
}

function clResizeGrid(variant, newRows, newCols) {
  if (!variant || !Array.isArray(variant.grid)) return;
  const cols = newCols != null ? newCols : clGetCols(variant);

  // Resize sloupců — symetricky z obou stran (vždy lichý počet)
  if (newCols != null && newCols !== clGetCols(variant)) {
    const oldCols = clGetCols(variant);
    variant.cols = newCols;
    const diff = newCols - oldCols;
    const half = Math.abs(diff) >> 1; // diff je vždy sudý (liché→liché)
    const rem  = Math.abs(diff) - half * 2; // 0 nebo 1 (paranoia)
    for (const row of variant.grid) {
      if (diff > 0) {
        // Přidáváme half vlevo + half vpravo (+ 1 vpravo pokud odd diff)
        for (let i = 0; i < half; i++) row.unshift({ type: 'wall' });
        for (let i = 0; i < half + rem; i++) row.push({ type: 'wall' });
      } else {
        // Ubíráme half zleva + half zprava
        for (let i = 0; i < half; i++) row.shift();
        for (let i = 0; i < half + rem; i++) row.pop();
      }
    }
  }

  // Resize řádků
  const cur = variant.grid.length;
  if (newRows != null && newRows !== cur) {
    if (newRows < cur) {
      variant.grid = variant.grid.slice(0, newRows);
    } else {
      for (let r = cur; r < newRows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push({ type: 'wall' });
        variant.grid.push(row);
      }
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
  const colsInput = $('cl-cols');
  const colsVal = $('cl-cols-val');
  if (variant) {
    rowsInput.value = variant.grid.length;
    rowsVal.textContent = variant.grid.length;
    rowsInput.disabled = false;
    const curCols = clGetCols(variant);
    colsInput.value = curCols;
    colsVal.textContent = curCols;
    colsInput.disabled = false;
  } else {
    rowsVal.textContent = '—';
    rowsInput.disabled = true;
    colsVal.textContent = '—';
    colsInput.disabled = true;
  }

  // Empty vs editor
  const emptyEl = $('cl-empty');
  const edEl = $('cl-editor');
  const capEl = $('cl-capacity');
  const testerEl = $('cl-tester');
  if (!variant) {
    emptyEl.hidden = false;
    edEl.hidden = true;
    if (capEl) capEl.hidden = true;
    if (testerEl) testerEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  edEl.hidden = false;
  if (testerEl) testerEl.hidden = false;

  // Generator tlačítka — enable jen pokud máme pxCounts pro aktuální level/diff.
  const pxForGen = clGetStatsForCurrent(lvl);
  const genFill = $('cl-gen-fill');
  const genReset = $('cl-gen-reset');
  if (genFill) genFill.disabled = !pxForGen;
  if (genReset) genReset.disabled = !pxForGen;

  clRenderPalette();
  clRenderGrid(variant);
  clRenderCapacity(lvl, variant);
  // Difficulty Curve panel — viditelnost + render po přepnutí variantu.
  // Nový variant = jiný layout = jiná trace. Schovej popover, reset expand state.
  if (typeof renderCurvesPanel === 'function') {
    _curvesUiState.expandedPinId = null;
    _hideCurvePopover && _hideCurvePopover();
    renderCurvesPanel(lvl, variant);
  }
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

// Vrátí true pokud by umístění garáže (nebo zdi) na (garR, garC) trvale zablokalo
// některý carrier — simuluje "post-empty" stav kde jsou všechny garáže permanentní zdi.
// Používá se jako pre-check před každým umístěním garáže i wall-slotu.
function clGarageBlocksCarriers(grid, rows, cols, testR, testC) {
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
  const isBlock = (r, c) => {
    if (r === testR && c === testC) return true;   // kandidát → zeď
    const t = grid[r][c];
    if (!t) return false;
    return t.type === 'wall' || t.wall === true || t.type === 'garage'; // stávající garáže = permanentní zdi
  };
  const reach = [];
  for (let r = 0; r < rows; r++) reach.push(new Array(cols).fill(false));
  const bq = [];
  for (let c = 0; c < cols; c++) {
    if (!isBlock(0, c)) { reach[0][c] = true; bq.push([0, c]); }
  }
  while (bq.length) {
    const [r, c] = bq.shift();
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (reach[nr][nc] || isBlock(nr, nc)) continue;
      reach[nr][nc] = true;
      bq.push([nr, nc]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === testR && c === testC) continue;
      const t = grid[r][c];
      if (t && t.type === 'carrier' && !reach[r][c]) return true;
    }
  }
  return false;
}

// Po umístění všech garážíků zkontroluje post-garage dostupnost (garáže = zdi).
// Pro každý carrier nedostupný v tomto stavu se pokusí otevřít null tunel cestou
// KOLEM garážíků. Pokud cesta neexistuje, odstraní blokující garáž (→ carrier).
function clRepairPostGarageUnreachable(variant) {
  const rows = variant.grid.length;
  const cols = clGetCols(variant);
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

  const postReach = () => {
    const isBlockPost = (r, c) => {
      const t = variant.grid[r][c];
      return !!(t && (t.type === 'wall' || t.wall === true || t.type === 'garage'));
    };
    const reach = [];
    for (let r = 0; r < rows; r++) reach.push(new Array(cols).fill(false));
    const bq = [];
    for (let c = 0; c < cols; c++) {
      if (!isBlockPost(0, c)) { reach[0][c] = true; bq.push([0, c]); }
    }
    while (bq.length) {
      const [r, c] = bq.shift();
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (reach[nr][nc] || isBlockPost(nr, nc)) continue;
        reach[nr][nc] = true;
        bq.push([nr, nc]);
      }
    }
    return reach;
  };

  for (let iter = 0; iter < 40; iter++) {
    const reach = postReach();
    let target = null;
    for (let r = 0; r < rows && !target; r++) {
      for (let c = 0; c < cols; c++) {
        const t = variant.grid[r][c];
        if (t && t.type === 'carrier' && !reach[r][c]) { target = { r, c }; break; }
      }
    }
    if (!target) return;

    // BFS z target přes walls (NE přes garáže) k dosažitelné zóně
    const parent = new Map();
    const seen = new Set();
    seen.add(target.r + ',' + target.c);
    const bq = [target];
    let found = null;
    while (bq.length) {
      const cur = bq.shift();
      if (reach[cur.r][cur.c] && (cur.r !== target.r || cur.c !== target.c)) { found = cur; break; }
      for (const [dr, dc] of DIRS) {
        const nr = cur.r + dr, nc = cur.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const k = nr + ',' + nc;
        if (seen.has(k)) continue;
        const nt = variant.grid[nr][nc];
        if (nt && nt.type === 'garage') continue;  // garáže nepřekračujeme
        seen.add(k);
        parent.set(k, cur.r + ',' + cur.c);
        bq.push({ r: nr, c: nc });
      }
    }

    if (!found) {
      // Tunel kolem garážíků neexistuje — odstraň blokující garáž sousedící s target nebo s unreachable zónou
      let removed = false;
      // Prohledej unreachable oblast a najdi garáž sousedící s ní
      const unreachSeen = new Set();
      const unreachQ = [target];
      unreachSeen.add(target.r + ',' + target.c);
      while (unreachQ.length) {
        const cur = unreachQ.shift();
        for (const [dr, dc] of DIRS) {
          const nr = cur.r + dr, nc = cur.c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const k = nr + ',' + nc;
          if (unreachSeen.has(k)) continue;
          const nt = variant.grid[nr][nc];
          if (nt && nt.type === 'garage') {
            // Tato garáž blokuje — odstraň ji (první queue položka = carrier)
            const firstColor = nt.queue && nt.queue[0] ? nt.queue[0].color : 0;
            variant.grid[nr][nc] = { type: 'carrier', color: firstColor };
            removed = true;
            break;
          }
          unreachSeen.add(k);
          if (!nt || nt.type === 'wall' || nt.wall) continue;
          unreachQ.push({ r: nr, c: nc });
        }
        if (removed) break;
      }
      if (!removed) return;
      continue;
    }

    // Otevři tunel: wall → null (carriery a rakety necháme)
    let cur = found.r + ',' + found.c;
    const targetKey = target.r + ',' + target.c;
    while (cur && cur !== targetKey) {
      const [pr, pc] = cur.split(',').map(Number);
      const t = variant.grid[pr][pc];
      if (t && (t.type === 'wall' || t.wall === true)) variant.grid[pr][pc] = null;
      cur = parent.get(cur);
    }
  }
}

// Generator rozložení — napodobuje game.js auto-gen:
//   easy   → frequent-first, round-robin pro variety, mírné shuffle uvnitř řádků
//   medium → full shuffle (chaotické rozložení)
//   hard   → frequent-first v layerech, rare barvy spadnou až do spodních řad
// Vždy respektuje user-set počet řádků (rows slider). Volné sloty = null (průchody).
// Mode: 'fill' = doplní jen null tiles (zachová carrier/wall/garage/rocket),
//       'reset' = vyprázdní grid a naplní znovu.
function clGenerateLayout(variant, pxCounts, mode, lvl) {
  if (!variant || !pxCounts) return false;
  const rows = variant.grid.length;
  const cols = clGetCols(variant);
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
    // Weights: linear 1..N, top nejvyšší (např. 7 rows → [7,6,5,4,3,2,1]).
    // Frequent barvy nahoru, hráč má rovnou hodně k dispozici → snadná hra.
    allocateByWeights(rowKeys.map((_, i) => rowKeys.length - i));
  } else if (diff === 'hard') {
    // Bottom-heavy weights [1,2,...,N]: top má málo (rare/mid) carrierů, bottom
    // dostane hodně frequent. Hráč musí prokopat dolů, aby se dostal k frekventním
    // barvám potřebným pro vyčištění obrazu — výrazný bottleneck.
    allocateByWeights(rowKeys.map((_, i) => i + 1));
  } else {
    // medium: rovnoměrně + jitter (každá řada dostane +-1 náhodně)
    allocateByWeights(rowKeys.map(() => 1 + Math.random() * 0.4));
  }

  // *** Garantuj ≥1 nosič v řadě 0 — bez toho je grid od startu uzamčený ***
  // Řada 0 je vždy "aktivní" (top-edge pravidlo honeycomb), takže bez nosiče tam
  // se hráč ke všem ostatním nosičům nedostane.
  {
    const row0Idx = rowKeys.indexOf(0);
    if (row0Idx >= 0 && perRow[row0Idx] === 0 && queue.length > 0) {
      // Přesuň 1 nosič z nejhlubší neprázdné řady do řady 0
      for (let i = rowKeys.length - 1; i > row0Idx; i--) {
        if (perRow[i] > 0) { perRow[i]--; perRow[row0Idx]++; break; }
      }
    }
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
    // Explicitně nastavit hidden i pro false — jinak hra háže vlastní Math.random()
    // pro nosiče bez hodnoty, což způsobuje neshodu editor ↔ preview.
    carrier.hidden = (hiddenRate > 0 && p.pos.r > 0 && Math.random() < hiddenRate);
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

  // 9) SPECIALS: post-process — garáže a rakety. Aplikuje se PŘED repair, aby
  //    repair mohl zafixovat případné nové unreachable tiles.
  const genGarages = !!($('cl-spec-garage-on') && $('cl-spec-garage-on').checked);
  const genRockets = !!($('cl-spec-rocket-on') && $('cl-spec-rocket-on').checked);

  if (genGarages) {
    const baseCount = parseInt(($('cl-spec-garage-count') || {}).value || '2', 10);
    const doRandom  = !!($('cl-spec-garage-random') && $('cl-spec-garage-random').checked);

    // Efektivní počet: přesně tolik kolik říká slider, případně ±1 náhoda.
    // Žádné automatické škálování podle difficulty — designer rozhoduje.
    let numGar = baseCount;
    if (doRandom) numGar += Math.floor(Math.random() * 3) - 1; // -1, 0, nebo +1
    numGar = Math.max(0, Math.min(6, numGar));

    // Počet nosičů v queue per garáž (čím těžší, tím víc "uvnitř")
    const queueSize = diff === 'easy' ? 2 : diff === 'hard' ? 4 : 3;

    // Sbírej jen nově vložené carriers z řad 1+ — řada 0 se NIKDY nedotýká.
    // Řada 0 musí mít vždy aktivní nosič (top-edge pravidlo), jinak je grid uzamčen.
    const newCarriers = [];
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r] && grid[r][c];
        if (t && t.type === 'carrier' && !occupied.has(r + ',' + c)) {
          newCarriers.push({ r, c, color: t.color });
        }
      }
    }

    // Nelze vyrobit víc garážíků než dovoluje počet nosičů (queueSize na každou;
    // garSlot.color + queueSize-1 extra = queueSize celkem). Nechej aspoň 1 volný.
    numGar = Math.min(numGar, Math.floor(Math.max(0, newCarriers.length - 1) / queueSize));

    // Cílová hloubka pro pozici samotné garáže
    const garDepthMin = diff === 'easy'  ? 0
                      : diff === 'medium'? Math.floor(rows * 0.2)
                      :                   Math.floor(rows * 0.35);
    const garDepthMax = diff === 'easy'  ? Math.max(0, Math.ceil(rows * 0.4) - 1)
                      :                   rows - 1;

    for (let g = 0; g < numGar; g++) {
      if (newCarriers.length < queueSize) break; // potřeba: 1 garSlot + queueSize-1 extra

      // Seřaď kandidáty: první zkoušej ty ve správné hloubce, pak ostatní jako fallback.
      const inRange = newCarriers.map((n, i) => i).filter(i => {
        const n = newCarriers[i];
        return n.r >= garDepthMin && n.r <= garDepthMax;
      });
      const outRange = newCarriers.map((n, i) => i).filter(i => !inRange.includes(i));
      if (diff === 'hard') {
        // Hard: prioritizuj nejhlubší pozice (uvnitř i mimo range).
        inRange.reverse();
        outRange.reverse();
      }
      const candidateIdxs = [...inRange, ...outRange];

      // Najdi první kandidáta, jehož permanentní přítomnost (jako zeď) nezablokuje
      // žádný jiný carrier v post-garage simulaci.
      let garIdx = -1;
      for (const idx of candidateIdxs) {
        const n = newCarriers[idx];
        if (!clGarageBlocksCarriers(grid, rows, cols, n.r, n.c)) {
          garIdx = idx;
          break;
        }
      }
      if (garIdx < 0) continue; // žádná bezpečná pozice — přeskoč tuto garáž

      const garSlot = newCarriers.splice(garIdx, 1)[0];

      // Vezmi queue nosiče (queueSize - 1 extra, protože garSlot.color je první položka).
      // Logika: u vyšší complexity dáváme do garage queue FREKVENTNÍ barvy
      // (carriery z bottom-rows v newCarriers — díky bottom-heavy weights tam padly
      // nejvíc-frekventní). Tím vznikne dvojitý bottleneck: frekventní barvy jsou
      // "zakopané" v bottom rows + některé jsou navíc v garage queue (gated dispense).
      //   hard:   z konce pole (bottom-row carriers = frekventní → garage bottleneck)
      //   easy:   ze začátku pole (top-row carriers = endgame barvy → menší dopad)
      //   medium: mix – z obou konců střídavě
      const queueColors = [];
      for (let q = 0; q < queueSize - 1 && newCarriers.length > 0; q++) {
        let qIdx;
        if      (diff === 'hard')   qIdx = newCarriers.length - 1;
        else if (diff === 'easy')   qIdx = 0;
        else                        qIdx = (q % 2 === 0) ? 0 : newCarriers.length - 1;
        // Queue wall: přeskoč pozice, které by zablokovaly ostatní carriery
        let safeQIdx = qIdx;
        for (let attempt = 0; attempt < newCarriers.length; attempt++) {
          const tryIdx = (qIdx + attempt * (diff === 'hard' ? -1 : 1) + newCarriers.length) % newCarriers.length;
          if (!clGarageBlocksCarriers(grid, rows, cols, newCarriers[tryIdx].r, newCarriers[tryIdx].c)) {
            safeQIdx = tryIdx;
            break;
          }
        }
        const qSlot = newCarriers.splice(safeQIdx, 1)[0];
        queueColors.push(qSlot.color);
        grid[qSlot.r][qSlot.c] = { type: 'wall' }; // slot pro queue → zeď
      }

      // Ulož garáž: garSlot.color je 1. položka queue — nosič na pozici garáže NESMÍ
      // být zahozen, jinak jeho barva zmizí z layoutu a hra přepne na auto-gen.
      grid[garSlot.r][garSlot.c] = {
        type: 'garage',
        queue: [{ color: garSlot.color }, ...queueColors.map(color => ({ color }))],
      };
    }

    // Auto-zapni garageMode na levelu (pokud vypnutý) — jinak hra garáže ignoruje
    if (numGar > 0 && lvl && !lvl.garage) {
      lvl.garage = 'multi';
    }
  }

  if (genRockets) {
    // Počet raket: 1 na easy/medium, 2 na hard — záměrně málo (helpers, ne základ)
    const numRockets = diff === 'hard' ? 2 : 1;
    // Rakety patří do přístupné zóny (blíže vrcholu) — jsou to helpery
    const rocketDepthMax = diff === 'easy'  ? Math.min(1, rows - 1)
                         : diff === 'hard'  ? Math.min(3, rows - 1)
                         :                   Math.min(2, rows - 1);

    // Sbírej wall sloty v přístupné zóně (rakety nahrazují jen walls, ne carriers)
    const wallCandidates = [];
    for (let r = 0; r <= rocketDepthMax; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r] && grid[r][c];
        if (!t || t.type === 'wall' || t.wall === true) wallCandidates.push({ r, c });
      }
    }
    shuffleArr(wallCandidates);

    // Barvy raket = nejčetnější barvy v aktuálním gridu (nejlepší helper pro hráče)
    const rocketColorCnt = new Array(BE_COLORS.length).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r] && grid[r][c];
        if (t && t.type === 'carrier') rocketColorCnt[t.color]++;
      }
    }
    const topRocketColors = rocketColorCnt
      .map((cnt, i) => ({ color: i, cnt }))
      .filter(x => x.cnt > 0)
      .sort((a, b) => b.cnt - a.cnt);

    for (let i = 0; i < Math.min(numRockets, wallCandidates.length, topRocketColors.length); i++) {
      const pos = wallCandidates[i];
      grid[pos.r][pos.c] = { type: 'rocket', color: topRocketColors[i].color };
    }
  }

  // 10) Solvability repair: hráč musí mít cestu ke KAŽDÉMU carrierovi/garáži/raketě.
  //     Pokud generátor uzavřel některé do ostrova z walls, otevřeme minimální tunel.
  clRepairUnreachable(variant);
  // Bezpečnostní síť: ověř post-garage dostupnost a oprav, pokud generátor něco
  // přehlédl (např. wall sloty garáže zablokovaly cestu). Volí tunel kolem, nebo
  // v krajním případě garáž odstraní (→ carrier z 1. queue položky).
  if (genGarages) clRepairPostGarageUnreachable(variant);
  return true;
}

function clRepairUnreachable(variant) {
  const rows = variant.grid.length;
  const cols = clGetCols(variant);
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
    if (!found) {
      // Celý grid unreachable — row 0 je plná zdí. Otevři první wall v row 0 jako tunel
      // aby BFS měl odkud startovat. Příští iterace loop pak opraví zbývající.
      let opened = false;
      for (let c = 0; c < cols && !opened; c++) {
        const t = variant.grid[0][c];
        if (t && (t.type === 'wall' || t.wall === true)) {
          variant.grid[0][c] = null;
          opened = true;
        }
      }
      if (!opened) return; // row 0 je prázdná (null buňky) ale přesto unreachable — vzdáme se
      continue; // zkus repair znovu s novým tunelem
    }

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
  const cols = clGetCols(variant);
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
    for (let c = 0; c < clGetCols(variant); c++) {
      const t = variant.grid[r][c];
      if (!t) continue;
      if ((t.type === 'carrier' || t.type === 'rocket' || t.type === 'garage') && !reach[r][c]) count++;
    }
  }
  return count;
}

// Spočítá per-(c,r) projectile count pro carriery v dané variantě.
// Primární zdroj: tester histories (přesné hodnoty pro carriery, na které solver
// klikl). Fallback: aproximace pxCounts[color] / numCarriers[color] (uniform
// distribuce — match s game's buildColsFromLayout logic, jen bez remainderu).
function _clBuildProjMap(lvl, variant) {
  const map = new Map();
  // 1) Z tester histories (pokud máme analýzu)
  if (_lastTesterResult && _lastTesterResult.histories) {
    const h = _lastTesterResult.histories;
    const histories = [h.beam, h.fullUse, h.maxGain].filter(Boolean);
    for (const hist of histories) {
      for (const ev of hist) {
        if (typeof ev.c !== 'number' || typeof ev.r !== 'number') continue;
        if (typeof ev.proj !== 'number') continue;
        const k = ev.c + ',' + ev.r;
        if (!map.has(k)) map.set(k, ev.proj);
      }
    }
  }
  // 2) Aproximace z totals pro carriery bez tester data
  if (variant && variant.grid) {
    const projCounts = (typeof clGetProjCountsForCurrent === 'function')
      ? clGetProjCountsForCurrent(lvl) : null;
    const pxCounts = (typeof clGetStatsForCurrent === 'function')
      ? clGetStatsForCurrent(lvl) : null;
    const totals = projCounts || pxCounts;
    if (totals) {
      const counts = new Array(BE_COLORS.length).fill(0);
      for (const row of variant.grid) {
        if (!Array.isArray(row)) continue;
        for (const t of row) {
          if (!t) continue;
          if (t.type === 'carrier' && typeof t.color === 'number') counts[t.color]++;
          else if (t.type === 'garage' && Array.isArray(t.queue)) {
            for (const q of t.queue) if (q && typeof q.color === 'number') counts[q.color]++;
          }
        }
      }
      // Najdi pro každou barvu poslední carrier v row-major iteraci (= ten,
      // co v game.js dostane "outlier" chunk = total - (n-1)*TARGET).
      const lastCarrierByColor = {};
      for (let r = 0; r < variant.grid.length; r++) {
        const row = variant.grid[r] || [];
        for (let c = 0; c < clGetCols(variant); c++) {
          const t = row[c];
          if (!t || t.type !== 'carrier' || typeof t.color !== 'number') continue;
          lastCarrierByColor[t.color] = c + ',' + r;
        }
      }
      const TARGET = 40; // UPC * PPU
      for (let r = 0; r < variant.grid.length; r++) {
        const row = variant.grid[r] || [];
        for (let c = 0; c < clGetCols(variant); c++) {
          const t = row[c];
          if (!t || t.type !== 'carrier' || typeof t.color !== 'number') continue;
          const k = c + ',' + r;
          if (map.has(k)) continue; // tester history má přednost
          const total = totals[t.color] || 0;
          const num = counts[t.color] || 1;
          if (total <= 0) continue;
          let estProj;
          if (num === 1) {
            estProj = total;
          } else if (total >= (num - 1) * TARGET) {
            // Většina dostane TARGET, "poslední" carrier (row-major) má rest.
            estProj = (lastCarrierByColor[t.color] === k)
              ? total - (num - 1) * TARGET
              : TARGET;
          } else {
            // Underprovisioned: rovnoměrný split (každý dostane <TARGET)
            const base = Math.floor(total / num);
            const rem = total % num;
            // Pro určitost: prvních `rem` carrierů dostane base+1, ostatní base.
            // Bez per-carrier index nejlépe odhadovat průměr.
            estProj = base + (rem > 0 ? 1 : 0);
          }
          map.set(k, estProj);
        }
      }
    }
  }
  return map;
}

function clRenderGrid(variant) {
  const g = $('cl-grid');
  if (!g) return;
  g.innerHTML = '';
  const rows = variant.grid.length;
  const cols = clGetCols(variant);

  // Fluid layout — buňky na 1fr, aspect-ratio wrapperu pro čtvercové buňky
  g.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
  g.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
  const wrap = g.closest('.cl-grid-wrap');
  if (wrap) wrap.style.setProperty('--cl-grid-ratio', cols + '/' + rows);

  const sel = state.clSelCell;
  const reach = clReachability(variant);
  const projMap = _clBuildProjMap(beCurrentLvl(), variant);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
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
        const proj = projMap.get(c + ',' + r);
        if (typeof proj === 'number') {
          // Primární obsah = počet projektilů. Color index → tooltip + malá patička.
          btn.innerHTML = `<span class="cl-cell-proj">${proj}</span><span class="cl-cell-color-idx">b${t.color}</span>`;
          btn.title = `barva ${t.color} · ${proj} projektilů`;
        } else {
          btn.textContent = String(t.color);
        }
      }
      if (t && (t.type === 'carrier' || t.type === 'rocket') && t.hidden === true) {
        btn.classList.add('tile-hidden');
        const q = document.createElement('span');
        q.className = 'cl-cell-hidden';
        q.textContent = '?';
        btn.appendChild(q);
      }
      // Unreachable marker
      if (t && (t.type === 'carrier' || t.type === 'rocket' || t.type === 'garage') && !reach[r][c]) {
        btn.classList.add('tile-unreachable');
        btn.title = (btn.title || '') + ' ⚠ nedostupný (obklopený zdmi)';
      }
      // Garage queue count badge
      if (t && t.type === 'garage' && Array.isArray(t.queue) && t.queue.length) {
        const badge = document.createElement('span');
        badge.className = 'cl-cell-badge';
        badge.textContent = String(t.queue.length);
        btn.appendChild(badge);
      }

      btn.addEventListener('click', () => clOnCellClick(r, c));

      // ── Drag & drop swap ──────────────────────────────────────────
      btn.draggable = true;
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', r + ',' + c);
        e.dataTransfer.effectAllowed = 'move';
        // Odložit přidání třídy, aby prohlížeč stihl udělat drag snapshot
        setTimeout(() => btn.classList.add('cl-drag-src'), 0);
      });
      btn.addEventListener('dragend', () => {
        btn.classList.remove('cl-drag-src');
      });
      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.classList.add('cl-drag-over');
      });
      btn.addEventListener('dragleave', () => {
        btn.classList.remove('cl-drag-over');
      });
      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        btn.classList.remove('cl-drag-over');
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const [srcR, srcC] = raw.split(',').map(Number);
        if (srcR === r && srcC === c) return;
        const lvl = beCurrentLvl();
        const v = clActiveVariant(lvl);
        if (!v) return;
        histPush(lvl, 'cl-swap');
        // Swap tiles
        const tmp = v.grid[srcR][srcC];
        v.grid[srcR][srcC] = v.grid[r][c];
        v.grid[r][c] = tmp;
        markDirty();
        renderCarrierLayout(lvl);
      });
      // ─────────────────────────────────────────────────────────────

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

    // Destroyable toggle
    const destroyRow = document.createElement('div');
    destroyRow.className = 'cl-insp-destroy-row';
    const destroyCb = document.createElement('input');
    destroyCb.type = 'checkbox';
    destroyCb.id = 'cl-insp-destroy-cb';
    destroyCb.checked = !!t.destroyable;
    destroyCb.addEventListener('change', () => {
      histPush(beCurrentLvl(), 'cl-garage-destroyable');
      t.destroyable = destroyCb.checked;
      markDirty();
      renderCarrierLayout(beCurrentLvl());
    });
    const destroyLbl = document.createElement('label');
    destroyLbl.htmlFor = 'cl-insp-destroy-cb';
    destroyLbl.textContent = '💥 zničitelná';
    destroyLbl.title = 'Hráč může garáž zničit kliknutím — obsah queue propadne';
    destroyRow.appendChild(destroyCb);
    destroyRow.appendChild(destroyLbl);
    body.appendChild(destroyRow);

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
      // Force preview reload — jinak hra dál ukazuje náhodnou variantu (nebo tu
      // co dostala při minulém načtení). URL ?variant=NAME přepne hru na tuto.
      _lastPreviewKey = null;
      schedulePreviewReload();
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
    const ok = clGenerateLayout(v, px, 'fill', lvl);
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
    const ok = clGenerateLayout(v, px, 'reset', lvl);
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
    clResizeGrid(v, newRows, null);
    markDirty();
    renderCarrierLayout(lvl);
  });

  // Cols slider
  const colsInput = $('cl-cols');
  colsInput.addEventListener('input', () => {
    $('cl-cols-val').textContent = colsInput.value;
  });
  colsInput.addEventListener('change', () => {
    const lvl = beCurrentLvl();
    const v = clActiveVariant(lvl);
    if (!v) return;
    const newCols = Math.max(1, Math.min(CL_COLS, parseInt(colsInput.value, 10) || CL_COLS));
    if (newCols === clGetCols(v)) return;
    histPush(lvl, 'cl-cols');
    clResizeGrid(v, null, newCols);
    markDirty();
    renderCarrierLayout(lvl);
  });

  // Specials: garáže toggle + slider
  $('cl-spec-garage-on').addEventListener('change', () => {
    const on = $('cl-spec-garage-on').checked;
    $('cl-spec-garage-sub').hidden = !on;
  });
  $('cl-spec-garage-count').addEventListener('input', () => {
    $('cl-spec-garage-count-val').textContent = $('cl-spec-garage-count').value;
  });

  $('cl-analyze-btn').addEventListener('click', () => {
    const frame = $('preview-frame');
    if (!frame || !frame.contentWindow) return;
    const body = $('cl-tester-body');
    if (body) body.innerHTML = '<div class="cl-tester-running">Analyzuji…</div>';
    const farSighted = !!($('cl-far-sighted') && $('cl-far-sighted').checked);
    frame.contentWindow.postMessage({ type: 'balloonbelt:analyze-level', farSighted }, '*');
  });

  // Difficulty Curve panel — wire jednou
  if (typeof _wireCurvesPanelOnce === 'function') _wireCurvesPanelOnce();
  if (typeof _wireReplayPanelOnce === 'function') _wireReplayPanelOnce();
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
    _mask: beBlockMask(shape, w, h, b.rot),
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
  const isSingle = beState.selectedBlocks.size <= 1;
  blocks.forEach((raw, idx) => {
    const b = beHydrate(raw);
    beDrawOneBlock(ctx, b, beState.selectedBlocks.has(idx), false, isSingle);
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

  // Group bounding-box handles (multi-select) — vnější žlutý outline + 8 handles
  if (beState.selectedBlocks.size > 1) {
    const bbox = beGroupBbox();
    if (bbox) {
      ctx.save();
      ctx.strokeStyle = '#ffe07a';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(bbox.x * BE_SCALE - 2, bbox.y * BE_SCALE - 2,
                     bbox.w * BE_SCALE + 4, bbox.h * BE_SCALE + 4);
      ctx.setLineDash([]);
      const hs = 7;
      const hx = bbox.x * BE_SCALE - 2, hy = bbox.y * BE_SCALE - 2;
      const hw = bbox.w * BE_SCALE + 4, hh = bbox.h * BE_SCALE + 4;
      const handles = [
        [hx, hy],           [hx + hw / 2, hy],  [hx + hw, hy],
        [hx, hy + hh / 2],                       [hx + hw, hy + hh / 2],
        [hx, hy + hh],      [hx + hw / 2, hy + hh], [hx + hw, hy + hh],
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

  // Rubber-band selection overlay
  if (beState.rubberBandStart && beState.rubberBandEnd) {
    const rs = beState.rubberBandStart, re = beState.rubberBandEnd;
    const rx = Math.min(rs.x, re.x) * BE_SCALE;
    const ry = Math.min(rs.y, re.y) * BE_SCALE;
    const rw = Math.abs(re.x - rs.x) * BE_SCALE;
    const rh = Math.abs(re.y - rs.y) * BE_SCALE;
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#7eb8f7';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#7eb8f7';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
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

function beDrawOneBlock(ctx, b, isSelected, isGhost, showHandles = true) {
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
    if (showHandles) {
      // Resize handle squares — středy hran + 4 rohy. Pouze pro single-select.
      const hs = 6;
      const hx = b.x * BE_SCALE - 1, hy = b.y * BE_SCALE - 1;
      const hw = b.w * BE_SCALE + 2, hh = b.h * BE_SCALE + 2;
      const handles = [
        [hx, hy], [hx + hw / 2, hy], [hx + hw, hy],
        [hx, hy + hh / 2],           [hx + hw, hy + hh / 2],
        [hx, hy + hh], [hx + hw / 2, hy + hh], [hx + hw, hy + hh],
      ];
      ctx.fillStyle = '#ffe07a';
      ctx.strokeStyle = '#1a1818';
      ctx.lineWidth = 1;
      for (const [hx0, hy0] of handles) {
        ctx.fillRect(hx0 - hs / 2, hy0 - hs / 2, hs, hs);
        ctx.strokeRect(hx0 - hs / 2, hy0 - hs / 2, hs, hs);
      }
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
  // Základní stavební jednotka = 5×5 image px.
  // thick = floor(w/3) → pro přesně 5px ramena musí být w=15 (L, cross).
  // T: top-bar thick = floor(h/3) → h=15 pro přesné rameno.
  const presets = [
    { shape: 'rect',   kind: 'solid',   w:  5, h:  5, color: 4, hp: 10, label: '1×1' },
    { shape: 'cross',  kind: 'solid',   w: 15, h: 15, color: 3, hp: 30, label: 'cross' },
    { shape: 'L',      kind: 'solid',   w: 10, h: 10, color: 1, hp: 15, label: 'L' },
    { shape: 'T',      kind: 'solid',   w: 15, h: 10, color: 5, hp: 20, label: 'T' },
    { shape: 'circle', kind: 'solid',   w:  5, h:  5, color: 6, hp: 10, label: '○' },
    { shape: 'rect',   kind: 'mystery', w:  5, h:  5, color: 0, hp:  8, label: '?' },
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

  const isMulti = beState.selectedBlocks.size > 1;

  // Nadpis — počet v závorce při multi
  const titleEl = wrap.querySelector('.be-section-title');
  if (titleEl) titleEl.textContent = isMulti ? `výběr (${beState.selectedBlocks.size})` : 'výběr';

  // Single-only řádky (druh, tvar, w/h, x/y, rotate) — skrýt v multi
  const singleIds = ['be-sel-kind-row', 'be-sel-shape-row', 'be-sel-wh-row', 'be-sel-xy-row'];
  for (const id of singleIds) { const el = $(id); if (el) el.hidden = isMulti; }
  const rotBtn = $('be-rotate');
  if (rotBtn) rotBtn.hidden = isMulti;

  if (!isMulti) {
    // Single-select: vyplnit všechna pole jako dřív
    wrap.querySelectorAll('.be-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.kind === (blk.kind === 'mystery' ? 'mystery' : 'solid'));
    });
    $('be-sel-shape').value = blk.shape || 'rect';
    $('be-sel-w').value = blk.w;
    $('be-sel-h').value = blk.h;
    $('be-sel-x').value = blk.x;
    $('be-sel-y').value = blk.y;
  }

  // HP — při multi zobraz "—" pokud jsou různé, jinak společnou hodnotu
  if (isMulti) {
    const hps = [...beState.selectedBlocks].map(si => lvl.blocks[si]?.hp).filter(v => v != null);
    const allSameHp = hps.length > 0 && hps.every(v => v === hps[0]);
    $('be-sel-hp-val').textContent = allSameHp ? hps[0] : '—';
    $('be-sel-hp').value = blk.hp; // slider na primárním bloku pro výchozí polohu
  } else {
    $('be-sel-hp').value = blk.hp;
    $('be-sel-hp-val').textContent = blk.hp;
  }

  // Colors — jen barvy aktivní palety levelu
  const paletteIndices = (lvl.activePalette && lvl.activePalette.length > 0)
    ? lvl.activePalette
    : BE_COLORS.map((_, i) => i);
  const selColors = isMulti
    ? [...beState.selectedBlocks].map(si => lvl.blocks[si]?.color | 0)
    : [blk.color | 0];
  const colorsEl = $('be-sel-colors');
  colorsEl.innerHTML = '';
  for (const i of paletteIndices) {
    const d = document.createElement('div');
    const allMatch = selColors.length > 0 && selColors.every(c => c === i);
    d.className = 'be-color-dot' + (allMatch ? ' selected' : '');
    d.style.background = BE_COLORS[i];
    d.title = 'color ' + i;
    d.addEventListener('click', () => {
      const lvl2 = beCurrentLvl();
      if (!lvl2) return;
      if (beState.selectedBlocks.size > 1) {
        // Hromadná změna barvy
        histPush(lvl2, 'block-color');
        for (const si of beState.selectedBlocks) {
          const sb = lvl2.blocks[si];
          if (!sb || (sb.color | 0) === i) continue;
          sb.color = i;
        }
        if (lvl2.key) {
          const bag = state.layoutStatusByLevel?.[lvl2.key];
          if (bag) delete bag[state.clActiveDiff];
        }
        renderSelectedBlockPanel();
        renderBlockCanvas();
        renderCarrierLayout(lvl2);
        markDirty();
      } else {
        const b = lvl2.blocks[beState.selectedBlockIdx];
        if (!b) return;
        const oldColor = b.color | 0;
        if (oldColor === i) return;
        histPush(lvl2, 'block-color');
        b.color = i;
        if (!bePaletteColorStillUsed(lvl2, oldColor, beState.selectedBlockIdx)) {
          bePropagateBlockColorChange(lvl2, oldColor, i);
        }
        if (lvl2.key) {
          const bag = state.layoutStatusByLevel?.[lvl2.key];
          if (bag) delete bag[state.clActiveDiff];
        }
        renderSelectedBlockPanel();
        renderBlockCanvas();
        renderCarrierLayout(lvl2);
        markDirty();
      }
    });
    colorsEl.appendChild(d);
  }
}

function beSelectBlock(idx) {
  beState.selectedBlockIdx = idx;
  beState.selectedBlocks = idx >= 0 ? new Set([idx]) : new Set();
  renderBlockCanvas();
  renderSelectedBlockPanel();
}

function beToggleBlockSelection(idx) {
  if (beState.selectedBlocks.has(idx)) {
    beState.selectedBlocks.delete(idx);
    if (beState.selectedBlockIdx === idx) {
      const rem = [...beState.selectedBlocks];
      beState.selectedBlockIdx = rem.length > 0 ? rem[rem.length - 1] : -1;
    }
  } else {
    beState.selectedBlocks.add(idx);
    beState.selectedBlockIdx = idx;
  }
  renderBlockCanvas();
  renderSelectedBlockPanel();
}

function beSelectBlocks(indices) {
  beState.selectedBlocks = new Set(indices);
  beState.selectedBlockIdx = indices.length > 0 ? indices[indices.length - 1] : -1;
  renderBlockCanvas();
  renderSelectedBlockPanel();
}

function beDeleteSelected() {
  const lvl = beCurrentLvl();
  if (!lvl || beState.selectedBlocks.size === 0) return;
  histPush(lvl, 'block-delete');
  // Mazat od nejvyššího indexu dolů, aby nedocházelo k re-indexaci.
  const indices = [...beState.selectedBlocks].sort((a, b) => b - a);
  for (const i of indices) lvl.blocks.splice(i, 1);
  beState.selectedBlockIdx = -1;
  beState.selectedBlocks = new Set();
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
  b.rot = ((b.rot || 0) + 1) % 4;
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
  if (!lvl || beState.selectedBlocks.size === 0) return;
  histPush(lvl, 'block-move-kbd');
  for (const idx of beState.selectedBlocks) {
    const b = lvl.blocks[idx];
    if (!b) continue;
    b.x = Math.max(0, Math.min(BE_GW - b.w, b.x + dx));
    b.y = Math.max(0, Math.min(BE_IMG_GH - b.h, b.y + dy));
  }
  renderBlockCanvas();
  renderSelectedBlockPanel();
  markDirty();
}

function beCopySelected() {
  const lvl = beCurrentLvl();
  if (!lvl || beState.selectedBlockIdx < 0) return;
  const b = lvl.blocks[beState.selectedBlockIdx];
  if (!b) return;
  // Uložíme čistou kopii bez runtime _mask.
  const { _mask, ...raw } = b;
  _beCopiedBlock = raw;
}

function bePasteBlock() {
  const lvl = beCurrentLvl();
  if (!lvl || !_beCopiedBlock) return;
  if (!Array.isArray(lvl.blocks)) lvl.blocks = [];
  histPush(lvl, 'block-paste');
  const src = _beCopiedBlock;
  const nb = {
    ...src,
    x: Math.min(src.x + 2, BE_GW - src.w),
    y: Math.min(src.y + 2, BE_IMG_GH - src.h),
  };
  lvl.blocks.push(nb);
  beState.selectedBlockIdx = lvl.blocks.length - 1;
  beState.selectedBlocks = new Set([beState.selectedBlockIdx]);
  renderBlockCanvas();
  renderSelectedBlockPanel();
  markDirty();
}

function beGroupBbox() {
  const lvl = beCurrentLvl();
  if (!lvl || beState.selectedBlocks.size < 2) return null;
  const blocks = [...beState.selectedBlocks].map(i => lvl.blocks[i]).filter(Boolean);
  if (!blocks.length) return null;
  const x0 = Math.min(...blocks.map(b => b.x));
  const y0 = Math.min(...blocks.map(b => b.y));
  const x1 = Math.max(...blocks.map(b => b.x + b.w));
  const y1 = Math.max(...blocks.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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
  beState.selectedBlocks = new Set([beState.selectedBlockIdx]);
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

  // Pipette cursor: aktualizuj cursor podle altHeld + custom-level stavu. Voláno
  // z keydown/keyup i z mousemove (přepíše edge/move cursor když je Alt drženo).
  const applyPipetteCursor = () => {
    const lvl = beCurrentLvl();
    const isCustom = lvl && lvl.image && lvl.image.source === 'custom';
    if (beState.altHeld && isCustom) {
      cvs.style.cursor = PIPETTE_CURSOR;
      return true;
    }
    return false;
  };

  // Window-level Alt tracking — keydown/keyup pracuje i mimo canvas focus.
  // Blur reset = když uživatel přepne tab s Alt+Tab, neuvíznem v pipette stavu.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !beState.altHeld) {
      beState.altHeld = true;
      applyPipetteCursor();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && beState.altHeld) {
      beState.altHeld = false;
      cvs.style.cursor = '';
    }
  });
  window.addEventListener('blur', () => {
    if (beState.altHeld) {
      beState.altHeld = false;
      cvs.style.cursor = '';
    }
  });

  // Hover cursor pro edge handles — sleduje pohyb a mění cursor.
  cvs.addEventListener('mousemove', (e) => {
    if (beState.pxDragging || beState.pxRectStart || beState.drag || beState.beResizing) return;
    if (applyPipetteCursor()) return;  // Alt drženo → pipette cursor přepíše vše ostatní
    const lvl = beCurrentLvl();
    const p = bePxFromEvent(e);
    if (beState.selectedBlocks.size === 1) {
      // Single-select: resize cursor na hranách bloku
      const sel = lvl && lvl.blocks && lvl.blocks[beState.selectedBlockIdx];
      if (sel) {
        const edge = beHitEdge(sel, p.x, p.y);
        if (edge) { cvs.style.cursor = BE_EDGE_CURSORS[edge] || 'pointer'; return; }
      }
    } else if (beState.selectedBlocks.size > 1) {
      // Multi-select: resize cursor na hranách group bbox
      const bbox = beGroupBbox();
      if (bbox) {
        const edge = beHitEdge(bbox, p.x, p.y);
        if (edge) { cvs.style.cursor = BE_EDGE_CURSORS[edge] || 'pointer'; return; }
      }
    }
    const hit = beHitTest(Math.floor(p.x), Math.floor(p.y));
    cvs.style.cursor = (hit >= 0) ? 'move' : '';
  });

  // Klik na plátno → hit-test; existující blok = select, jinak deselect.
  cvs.addEventListener('mousedown', (e) => {
    cvs.focus();
    const p = bePxFromEvent(e);
    const lvl = beCurrentLvl();
    const isCustom = lvl && lvl.image && lvl.image.source === 'custom';

    // Pipette / eyedropper — Alt-click nasaje barvu pixelu. Má přednost před vším
    // ostatním (bloky, edge-resize, paint), takže funguje i nad blokem (čte pixel
    // pod ním — ten ve hře blok zakrývá, ale v editoru je zdroj pravdy).
    if (e.altKey && isCustom && lvl.image && Array.isArray(lvl.image.pixels)) {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      const row = lvl.image.pixels[y];
      if (row && x >= 0 && x < row.length) {
        const ci = row[x];
        if (typeof ci === 'number' && ci >= 0) beSetPxColor(ci);
      }
      e.preventDefault();
      return;
    }

    // Pokud máme selected block a klik je na jeho EDGE → resize-drag.
    // Guard: když je aktivní pixel paint mode (rect-fill / rect-erase už drží
    // start, NEBO drag-paint běží), nech pixel painter převzít — resize handles
    // by se duplicitně aktivovaly. Cursor feedback (mousemove výše) už respektuje
    // tyto flagy, takže designer cursor ani neuvidí jako resize.
    const sel = beState.selectedBlocks.size <= 1 && lvl && lvl.blocks && lvl.blocks[beState.selectedBlockIdx];
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

    // Group bbox resize — multi-select: táhnutí za handle skupiny škáluje všechny bloky.
    if (beState.selectedBlocks.size > 1 && !beState.pxDragging && !beState.pxRectStart) {
      const bbox = beGroupBbox();
      if (bbox) {
        const edge = beHitEdge(bbox, p.x, p.y);
        if (edge) {
          e.preventDefault();
          const origBbox = { ...bbox };
          // Snapshot normalizovaných pozic každého bloku v bbox (0..1)
          const origBlocks = new Map();
          for (const i of beState.selectedBlocks) {
            const b = lvl.blocks[i];
            if (!b) continue;
            origBlocks.set(i, {
              rx0: (b.x - origBbox.x) / origBbox.w,
              ry0: (b.y - origBbox.y) / origBbox.h,
              rx1: (b.x + b.w - origBbox.x) / origBbox.w,
              ry1: (b.y + b.h - origBbox.y) / origBbox.h,
            });
          }
          let resized = false;
          beState.beResizing = true;
          const onMove = (ev) => {
            const pp = bePxFromEvent(ev);
            let nx = origBbox.x, ny = origBbox.y, nw = origBbox.w, nh = origBbox.h;
            if (edge.includes('e')) nw = Math.max(1, Math.min(BE_GW - nx, Math.round(pp.x - nx)));
            if (edge.includes('w')) {
              const right = origBbox.x + origBbox.w;
              nx = Math.max(0, Math.min(right - 1, Math.round(pp.x)));
              nw = right - nx;
            }
            if (edge.includes('s')) nh = Math.max(1, Math.min(BE_IMG_GH - ny, Math.round(pp.y - ny)));
            if (edge.includes('n')) {
              const bot = origBbox.y + origBbox.h;
              ny = Math.max(0, Math.min(bot - 1, Math.round(pp.y)));
              nh = bot - ny;
            }
            if (nw !== origBbox.w || nh !== origBbox.h || nx !== origBbox.x || ny !== origBbox.y) {
              if (!resized) histPush(lvl, 'block-group-resize-' + Date.now());
              for (const [i, o] of origBlocks) {
                const b = lvl.blocks[i];
                if (!b) continue;
                const bw = Math.max(1, Math.round((o.rx1 - o.rx0) * nw));
                const bh = Math.max(1, Math.round((o.ry1 - o.ry0) * nh));
                const bx = Math.round(nx + o.rx0 * nw);
                const by = Math.round(ny + o.ry0 * nh);
                b.w = Math.min(bw, BE_GW);
                b.h = Math.min(bh, BE_IMG_GH);
                b.x = Math.max(0, Math.min(BE_GW - b.w, bx));
                b.y = Math.max(0, Math.min(BE_IMG_GH - b.h, by));
              }
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

    if (e.shiftKey && idx >= 0) {
      // Shift+klik = přidat/odebrat blok z multi-selectu
      beToggleBlockSelection(idx);
    } else if (idx >= 0) {
      // Klik na blok — pokud je součástí multi-selectu, zachovat výběr (pro drag)
      if (beState.selectedBlocks.has(idx) && beState.selectedBlocks.size > 1) {
        // Jen aktualizuj primární blok pro panel, neruš multi-select
        beState.selectedBlockIdx = idx;
        renderSelectedBlockPanel();
      } else if (idx !== beState.selectedBlockIdx || beState.selectedBlocks.size > 1 || !beState.selectedBlocks.has(idx)) {
        beSelectBlock(idx);
      }
    } else if (!e.shiftKey) {
      // Klik na prázdné místo bez Shift → deselect
      beSelectBlock(-1);
    }

    // Rubber-band: táhnutí na prázdném místě (bez Shift)
    if (idx < 0 && !e.shiftKey) {
      beState.rubberBandStart = { x: p.x, y: p.y };
      beState.rubberBandEnd   = { x: p.x, y: p.y };
      renderBlockCanvas();
      const onMove = (ev) => {
        const pp = bePxFromEvent(ev);
        beState.rubberBandEnd = { x: pp.x, y: pp.y };
        renderBlockCanvas();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const rs = beState.rubberBandStart, re = beState.rubberBandEnd;
        beState.rubberBandStart = null;
        beState.rubberBandEnd   = null;
        if (rs && re && (Math.abs(re.x - rs.x) > 0.5 || Math.abs(re.y - rs.y) > 0.5)) {
          const x0 = Math.min(rs.x, re.x), x1 = Math.max(rs.x, re.x);
          const y0 = Math.min(rs.y, re.y), y1 = Math.max(rs.y, re.y);
          const dragLvl = beCurrentLvl();
          const hits = [];
          if (dragLvl && dragLvl.blocks) {
            dragLvl.blocks.forEach((raw, i) => {
              const b = beHydrate(raw);
              if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) hits.push(i);
            });
          }
          if (hits.length > 0) beSelectBlocks(hits);
          else renderBlockCanvas();
        } else {
          renderBlockCanvas();
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return; // nepokračovat na drag-move
    }

    // Drag-move: blok byl trefen a není Shift
    if (idx >= 0 && !e.shiftKey) {
      const dragLvl = beCurrentLvl();
      const refBlock = dragLvl.blocks[idx];
      const offX = p.x - refBlock.x;
      const offY = p.y - refBlock.y;
      // Snapshot výchozích pozic všech vybraných bloků
      const startPos = new Map();
      for (const si of beState.selectedBlocks) {
        const sb = dragLvl.blocks[si];
        if (sb) startPos.set(si, { x: sb.x, y: sb.y });
      }
      const refStart = startPos.get(idx) || { x: refBlock.x, y: refBlock.y };
      let moved = false;
      const onMove = (ev) => {
        const pp = bePxFromEvent(ev);
        const newRefX = Math.max(0, Math.min(BE_GW - refBlock.w, Math.floor(pp.x - offX)));
        const newRefY = Math.max(0, Math.min(BE_IMG_GH - refBlock.h, Math.floor(pp.y - offY)));
        const dx = newRefX - refStart.x;
        const dy = newRefY - refStart.y;
        if (dx !== 0 || dy !== 0) {
          if (!moved) histPush(dragLvl, 'block-move-drag-' + Date.now());
          for (const si of beState.selectedBlocks) {
            const sb = dragLvl.blocks[si];
            const sp = startPos.get(si);
            if (!sb || !sp) continue;
            sb.x = Math.max(0, Math.min(BE_GW - sb.w, sp.x + dx));
            sb.y = Math.max(0, Math.min(BE_IMG_GH - sb.h, sp.y + dy));
          }
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
    if (beState.selectedBlocks.size === 0) return;
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
    if (!lvl) return;
    const hp = Math.max(1, parseInt(e.target.value, 10) || 1);
    $('be-sel-hp-val').textContent = hp;
    histPush(lvl, 'block-hp');
    if (beState.selectedBlocks.size > 1) {
      for (const si of beState.selectedBlocks) {
        const sb = lvl.blocks[si];
        if (sb) sb.hp = hp;
      }
    } else {
      const b = lvl.blocks[beState.selectedBlockIdx];
      if (!b) return;
      b.hp = hp;
    }
    renderBlockCanvas();
    markDirty();
  });

  $('be-rotate').addEventListener('click', beRotateSelected);
  $('be-delete').addEventListener('click', beDeleteSelected);

  // Deselekt při kliknutí mimo block-editor canvas.
  // Klik uvnitř be-sel-wrap (slider, tlačítka) NESMÍ rušit výběr.
  document.addEventListener('mousedown', (e) => {
    if (beState.selectedBlocks.size === 0) return;
    const canvas = $('be-canvas');
    const selWrap = $('be-sel-wrap');
    if (!canvas) return;
    if (e.target === canvas) return;                              // klik na canvas — canvas si to sám ohandluje
    if (selWrap && selWrap.contains(e.target)) return;           // klik na panel výběru (HP, barva, …)
    beSelectBlock(-1);
  }, { capture: true });
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
    if (key !== 'z' && key !== 'y' && key !== 'c' && key !== 'v') return;

    // Nevstupujeme do cesty nativnímu undo/copy/paste v textovém inputu.
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
    // Cmd+C / Ctrl+C       = copy vybraného bloku
    // Cmd+V / Ctrl+V       = paste zkopírovaného bloku (offset +2 px)
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      histUndo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      histRedo();
    } else if (key === 'c' && beState.selectedBlockIdx >= 0) {
      e.preventDefault();
      beCopySelected();
    } else if (key === 'v' && _beCopiedBlock) {
      e.preventDefault();
      bePasteBlock();
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

    if (m.type === 'balloonbelt:analysis-results') {
      renderTesterResults(m.results);
      return;
    }

    if (m.type === 'balloonbelt:mutation-suggestions') {
      _mutSuggestState.loading = false;
      _mutSuggestState.progress = null;
      _mutSuggestState.results = m.suggestions || [];
      _mutSuggestState.evalMode = m.evalMode || 'greedy';
      try {
        const lvl = beCurrentLvl(), variant = clActiveVariant(lvl);
        renderMutSuggestPanel(lvl, variant);
      } catch(e) { /* level může být odpojen */ }
      return;
    }

    if (m.type === 'balloonbelt:mutation-progress') {
      _mutSuggestState.progress = { current: m.current, total: m.total };
      _mutSuggestState.evalMode = m.evalMode || 'beam';
      try {
        const lvl = beCurrentLvl(), variant = clActiveVariant(lvl);
        renderMutSuggestPanel(lvl, variant);
      } catch(e) { /* */ }
      return;
    }
  });
}

// Modul-level state — drží poslední výsledky a UI preference,
// aby toggle/checkbox handlery mohly re-renderovat bez nového postMessage.
let _lastTesterResult = null;
const _traceVisibility = { maxGain: true, fullUse: true, beam: true, envelope: true };
let _heatmapMode = 'mini'; // 'mini' | 'overlay'

// Difficulty Curve panel (Úr. 1) — module state
const CURVE_DIMS = ['choice', 'pressure', 'progress', 'solverGap'];
const CURVE_DIM_LABELS = {
  choice:    'Choice (šíře rozhodování) = beneficial / active per krok',
  pressure:  'Pressure (tlak pásu) = beltLoad / BELT_CAP per krok',
  progress:  'Progress (tempo úklidu) = pickedGain / remainingPx_before',
  solverGap: 'Solver gap = kolik z 3 strategií ještě běží',
};
const CURVE_DIM_COLORS = {
  choice:    '#3b82f6', // modrá
  pressure:  '#ef4444', // červená
  progress:  '#10b981', // zelená
  solverGap: '#f59e0b', // oranžová
};
const PIN_TAGS = ['harder', 'easier', 'more decisions', 'less decisions', 'less belt pressure'];
let _curvesUiState = {
  visibleDims: { choice: true, pressure: true, progress: true, solverGap: true },
  expandedPinId: null,    // null = žádný pin v expand mode
  dragHandle: null,       // {pinId, side: 'start'|'end'} při tažení handle
  openPopoverId: null,    // pin id s otevřeným popoverem
};
let _curveCache = null;   // přepočítané křivky pro aktuální _lastTesterResult
let _mutSuggestState = { loading: false, pinId: null, results: [], previewIdx: null, progress: null, evalMode: 'greedy', evalModePref: 'greedy' };

function renderTesterResults(r) {
  _lastTesterResult = r;
  // Difficulty Curve panel — invalidace cache + re-render
  _curveCache = null;
  // Replay panel — invalidace cache + re-render
  if (_replayState) {
    _replayPause && _replayPause();
    _replayState.history = null;
    _replayState.gridCache = null;
    _replayState.step = 0;
  }
  try {
    const lvl = beCurrentLvl();
    const variant = clActiveVariant(lvl);
    renderCurvesPanel(lvl, variant);
    renderReplayPanel && renderReplayPanel();
    // Re-render carrier grid — projectile counts (z tester history) jsou teď k dispozici
    if (variant) clRenderGrid(variant);
  } catch (e) { /* panel může být neinicializovaný při prvním loadu */ }
  const body = $('cl-tester-body');
  if (!body) return;
  if (!r) {
    body.innerHTML = '<div class="cl-tester-error">Výsledky nejsou k dispozici (level není načten).</div>';
    return;
  }
  const hasDeficit = r.colorDetails && Object.values(r.colorDetails).some(d => d.balance < 0);
  const simFailed = !r.solved;
  const toleranceUsed = !!r.toleranceUsed;
  const diffMeta = _difficultyMeta(r.diffScore);
  const bottleneckSwatch = r.bottleneckColor >= 0
    ? `<span class="cl-tester-swatch" style="background:${BE_COLORS[r.bottleneckColor]}"></span> ${r.bottleneckColor}`
    : '—';
  let solverNote = '';
  if (toleranceUsed) {
    const tol = r.SOLVED_TOLERANCE_PX || 40;
    solverNote = `<div class="cl-tester-info">ℹ <b>Effectively solved s tolerancí:</b> solver zbylo <b>${r.remainPx} px</b> (limit ${tol} px = 1 carrier worth). Level považujeme za dohratelný — pár pixelů uvázlo kvůli timing nuancím, lidský hráč by to obvykle vyřešil tím, že by carriery klikal v jiném pořadí. Heat-mapa ukazuje, které pixely zbyly.</div>`;
  } else if (simFailed) {
    if (hasDeficit) {
      solverNote = '<div class="cl-tester-warn">⚠ Simulátor nedokončil — některé barvy mají deficit projektilů (červené řádky v tabulce). Level pravděpodobně není dohratelný.</div>';
    } else {
      // Bilance OK ale solver failed — vyjmenuj konkrétní možné příčiny.
      const causes = [];
      if (r.beltOverflow) causes.push('<b>belt overflow</b> (Peak belt load > 14) — moc no-match balónků se kupí na pásu rychleji, než stíhají vystřelit; v reálné hře by hra skončila zablokovaným pásem');
      else if (r.beltDeadlockRisk) causes.push('<b>belt deadlock risk</b> (Peak belt load > 12) — funnel by občas odmítl klik na carrier, hráč by si musel počkat');
      if (r.stuckBalls && r.stuckBalls > 0) causes.push('<b>' + r.stuckBalls + ' uvízlých balónků</b> na pásu — solver vystřelil carriery, jejichž pixely se nakonec nikdy neodhalily. Pozn.: každý carrier se rozpadá na <b>UPC=4 malé balónky</b>, každý s 1/4 ammo. „Pár chybějících pixelů" v heat-mapě = sečtené ammo ze stuck balónků z různých carrierů, ne celý carrier worth.');
      if (r.hitTimeBudget) causes.push('<b>beam time budget</b> — beam search vypršel 2 s rozpočet; možná existuje řešení, které prostě nestihl prozkoumat');
      causes.push('<b>strategický timing</b> — všechny tři strategie pálí carrier, jakmile je aktivní, neumí počkat na plnou expozici barvy; lidský hráč to umí');
      const causeList = causes.map(c => '<li>' + c + '</li>').join('');
      solverNote = '<div class="cl-tester-info">ℹ <b>Capacity OK + solver fail</b>: bilance per-barva sedí, ale žádná strategie nedokončila. Možné příčiny:<ul style="margin:4px 0 0 14px;padding:0;font-size:11px;">' + causeList + '</ul><div style="margin-top:6px;font-size:11px;">Pozn.: capacity OK kontroluje jen totální projektily per barva. Belt load + access order kontroluje až playtester.</div></div>';
    }
  }
  const minClicksVal = simFailed ? `<span title="solver nedokončil">— (${r.minClicks}+)</span>` : r.minClicks;
  // Difficulty score se zobrazuje VŽDY (i pro nedořešené). Vedle čísla je doporučený label
  // (Relaxing/Easy/Medium/Hard/Hardcore/⚠ Broken). Klikem na ⓘ se zobrazí breakdown jak se
  // skóre počítá. Štítek je jen DOPORUČENÍ — žádná auto-změna level.type.
  const diffScoreVal = `<span class="cl-tr-score ${diffMeta.cls}">${r.diffScore} / 100</span> <span class="cl-difflabel cl-diff-${diffMeta.key}" title="Doporučený label podle skóre. Žádná auto-změna level.type — jen návrh.">${diffMeta.icon} ${diffMeta.name}</span>`;
  // Belt warning — dvouúrovňový (>12 risk, >14 overflow). Jen pokud máme data.
  let beltRow = '';
  if (typeof r.peakBeltLoad === 'number') {
    const cap = r.BELT_CAP || 14;
    const beltCls = r.beltOverflow ? 'val-overflow' : (r.beltDeadlockRisk ? 'val-warn' : '');
    const beltIcon = r.beltOverflow ? '🚫 ' : (r.beltDeadlockRisk ? '⚠ ' : '');
    const beltTitle = `Maximální zatížení pásu během simulace (max ${cap}). Nad 12 = funnel deadlock risk (klik na carrier odmítnut), nad 14 = belt overflow / game-over scénář. Odhad: lookback 8 kliků × no-match kuličky (proj−gain) na pásu.`;
    beltRow = `<div class="cl-tester-row"><span class="cl-tr-label" title="${beltTitle}">Peak belt load</span><span class="cl-tr-val ${beltCls}">${beltIcon}${r.peakBeltLoad} / ${cap}</span></div>`;
  }
  // Solver used — ukázat která strategie zvítězila + tolerance + budget warning + belt overflow
  let solverUsedRow = '';
  if (r.solverUsed) {
    const tol = r.SOLVED_TOLERANCE_PX || 40;
    let badge = '';
    if (r.solved && r.strictSolved) {
      badge = ' <span class="cl-solve-badge cl-solve-strict" title="Solver vyčistil úplně všechny pixely — žádný zbytek.">✓ přesně</span>';
    } else if (r.solved && r.toleranceUsed) {
      badge = ` <span class="cl-solve-badge cl-solve-tolerance" title="Solver zbylo ${r.remainPx} pixelů (tolerance je ${tol} px = 1 carrier worth). Level považován za dohratelný — pár pixelů uvázlo kvůli timing nuancím, které lidský hráč obvykle vyřeší.">✓ tolerance (${r.remainPx} px)</span>`;
    } else if (r.beltOverflow) {
      // Reálný důvod failu: pás přetekl. Tolerance NEPLATÍ — v reálné hře by hra skončila
      // game-overem PŘED dokončením těch zbylých pixelů.
      badge = ` <span class="cl-solve-badge cl-solve-overflow" title="Belt overflow (peak ${r.peakBeltLoad}/${r.BELT_CAP || 14}) — pás by v reálné hře přetekl a hra by skončila GAME-OVEREM dřív, než by solver dokončil zbylé ${r.remainPx} px. Tolerance se NEPOUŽIJE, protože hra by neskončila řádně.">🚫 belt overflow${r.remainPx > 0 ? ` (zbývá ${r.remainPx} px)` : ''}</span>`;
    } else {
      badge = ` <span class="cl-solve-badge cl-solve-fail" title="Solver nedořešil — zbývá ${r.remainPx} px (víc než tolerance ${tol}).">✗ zbývá ${r.remainPx} px</span>`;
    }
    solverUsedRow = `<div class="cl-tester-row"><span class="cl-tr-label" title="Která ze 3 strategií poskytla nejlepší výsledek: max-gain greedy, full-use greedy, nebo beam search. Tolerance ${tol} px (= 1 carrier worth) — pokud zbývá ≤ tolerance A nedošlo k belt overflow, level uznán jako 'effectively solved'.">Použitý solver</span><span class="cl-tr-val">${r.solverUsed}${badge}${r.hitTimeBudget ? ' <span class="cl-tt-budget" title="Beam search vypršel time budget — možná existuje lepší řešení.">⏱</span>' : ''}</span></div>`;
  }
  // Funnel friction — kolik % kliků by reálná hra odmítla (queue >= 12).
  let funnelRow = '';
  if (typeof r.funnelFrictionPct === 'number' && r.funnelRejectedCount > 0) {
    const fpct = r.funnelFrictionPct;
    const threshold = r.PENDING_DISPENSE_THRESHOLD || 12;
    const fcls = fpct >= 30 ? 'val-overflow' : fpct >= 10 ? 'val-warn' : '';
    const ficon = fpct >= 30 ? '🚫 ' : fpct >= 10 ? '⚠ ' : '';
    const ftitle = `V kolika % kliků by reálná hra zobrazila "Funnel full" warning a klik odmítla. Pending threshold = ${threshold}. Solver toto IGNORUJE (klikne i tak), ale v reálu by hráč musel čekat. Vysoké % = level vyžaduje pomalé klikání.`;
    funnelRow = `<div class="cl-tester-row"><span class="cl-tr-label" title="${ftitle}">Funnel friction</span><span class="cl-tr-val ${fcls}">${ficon}${fpct} % (${r.funnelRejectedCount} kliků)</span></div>`;
  }
  body.innerHTML = `
    <div class="cl-tester-row"><span class="cl-tr-label" title="Počet nosičů odebraných nejlepším solverem. Nižší = kratší level.">Minimální kliků</span><span class="cl-tr-val">${minClicksVal}</span></div>
    ${(() => {
      // Hierarchie 3 typů hráčů — od nejhloupějšího po nejchytřejšího.
      // Každý ukazuje X / Y dohrálo. Designer vidí, na jaké úrovni hráče level "padá".
      const tol = r.SOLVED_TOLERANCE_PX || 40;
      const rs = r.randomSuccesses || 0;
      const rc = r.randomCloseCalls || 0;
      const rt = r.randomTotal || 50;
      const hs = r.heuristikSolved || 0;
      const ht = r.heuristikTotal || 2;
      const beam = r.beamSolved ? '✓' : '✗';
      // Random — barva: zelená když ≥ 30 % uspěje, modrá info když 0 (lineární level), šedá střed
      const rPct = Math.round(rs/rt*100);
      const rCls = rs===0 ? (r.solved ? 'val-info' : 'val-warn') : (rPct>=30 ? '' : 'val-info');
      const rCloseStr = rc>0 ? ` <span class="cl-rh-pct">+ ${rc} skoro</span>` : '';
      const hCls = hs===0 ? 'val-warn' : '';
      const beamCls = r.beamSolved ? '' : 'val-warn';
      return `
        <div class="cl-tester-row"><span class="cl-tr-label" title="50 náhodných průchodů (preferují beneficial carrier). Kolik z nich dohrálo do tolerance ${tol} px. ŽÁDNÝ vztah ke solverovi! Tohle simuluje 'nováčka bez plánu'. 'skoro' = další runs, kde zbylo ≤ 2.5× tolerance (= byly blízko k úspěchu).">Random hráč</span><span class="cl-tr-val ${rCls}">${rs} / ${rt}${rCloseStr} <span class="cl-rh-pct">(${rPct}% solve)</span></span></div>
        <div class="cl-tester-row"><span class="cl-tr-label" title="Heuristické solvery (max-gain + full-use greedy) — chytřejší než random, ale BEZ lookaheadu. Simulují 'solidního hráče s intuicí'. Pokud TYTO selžou, level vyžaduje plán dopředu.">Heuristik</span><span class="cl-tr-val ${hCls}">${hs} / ${ht}</span></div>
        <div class="cl-tester-row"><span class="cl-tr-label" title="Beam search (8 paralelních scénářů, lookahead). Nejlepší solver = simuluje 'experta s plánem'. Pokud i tohle selže, level je extrémně tight.">Plánovač (beam)</span><span class="cl-tr-val ${beamCls}">${beam}</span></div>
      `;
    })()}
    <div class="cl-tester-row"><span class="cl-tr-label" title="Průměrný počet smysluplných voleb na krok v optimal průchodu. Nižší = lineárnější level; vyšší = zajímavější, více cest.">Decision richness</span><span class="cl-tr-val">${r.decisionRichness}</span></div>
    <div class="cl-tester-row"><span class="cl-tr-label" title="Barva, kterou simulátor začal používat NEJPOZDĚJI (krok N v sloupci 'přístup' v tabulce výše). POZOR: nejde o pozici carrieru v honeycombu! Carrier té barvy může být klidně v první řadě (fyzicky hned přístupný), ale její PIXELY V OBRAZU jsou buried pod jinými barvami — simulátor čekal, než se odkryjí. Tj. bottleneck = barva s nejhlubšími pixely v obrazu, ne s nejhlubším carrierem.">Bottleneck barva (pixelů)</span><span class="cl-tr-val">${bottleneckSwatch}</span></div>
    <div class="cl-tester-row"><span class="cl-tr-label" title="Podíl slotů v carrier gridu, které jsou typu garáž. 0 % = garáž v tomto layoutu nepřináší žádné nosiče.">Garage utiliz.</span><span class="cl-tr-val">${r.garageUtil} %</span></div>
    ${beltRow}
    ${funnelRow}
    ${solverUsedRow}
    <div class="cl-tester-row"><span class="cl-tr-label" title="Orientační skóre 0–100. Vždy spočítáno (i pro neřešené levely). Vedle čísla je doporučený label.">Difficulty score</span><span class="cl-tr-val">${diffScoreVal}</span></div>
    ${_renderDifficultyBreakdown(r)}
    ${solverNote}
    ${_renderColorDetailsTable(r.colorDetails)}
    ${_renderTraceChart(r.traces, r.randomEnvelope)}
    ${_renderHeatmapPanel(r.remainingGrid, r.solved)}
  `;
  // Post-render: připojit handlery a vykreslit canvasy.
  _wireTraceCheckboxes();
  if (r.remainingGrid && !r.solved) _drawRemainingHeatmap(r.remainingGrid, _heatmapMode);
  _wireHeatmapToggle();
}

function _renderColorDetailsTable(details) {
  if (!details || !Object.keys(details).length) return '';
  const rows = Object.entries(details).map(([c, d]) => {
    // Klíčová diagnostika: stuckPx > 0 = simulace nedokázala vyčistit, i když balance OK.
    // Tj. solver "promrhal" carriery na špatných shlucích a zbytek nezbylo čím pálit.
    const stuckPx = d.stuckPx || 0;
    const cleared = d.cleared != null ? d.cleared : (d.need - stuckPx);
    const hasStuck = stuckPx > 0;
    const rowCls = d.balance < 0 ? 'td-deficit' : (hasStuck ? 'td-stuck' : (d.balance > 10 ? 'td-surplus' : ''));
    const swatch = `<span class="cl-tester-swatch" style="background:${BE_COLORS[Number(c)]}"></span>`;
    const balStr = (d.balance >= 0 ? '+' : '') + d.balance;
    const acc = d.accessStep !== null ? 'krok ' + d.accessStep : '—';
    const clearedStr = hasStuck
      ? `<span class="cl-cleared-warn" title="Solver vyčistil ${cleared} z ${d.need} px této barvy. ${stuckPx} px zůstalo přesto, že balance je +0 nebo kladný — strategický fail (carriery vystřeleny dřív, než se odhalily zbylé shluky barvy).">${cleared}/${d.need} ⚠</span>`
      : `${cleared}/${d.need}`;
    return `<tr class="${rowCls}"><td>${swatch} ${c}</td><td>${d.need}</td><td>${d.have}</td><td>${balStr}</td><td>${clearedStr}</td><td>${acc}</td></tr>`;
  }).join('');
  return `
    <div class="cl-tester-colors">
      <table class="cl-tc-table">
        <thead><tr>
          <th title="Index barvy v paletě">barva</th>
          <th title="Projektilů potřebných k rozbití všech pixelů + HP bloků dané barvy">potřeba</th>
          <th title="Projektilů dostupných ve všech nosičích a frontě garáže dané barvy">zásoby</th>
          <th title="zásoby − potřeba. Záporné (červeně) = reálný deficit → level nejde dokončit. +0 nebo kladné = ok.">bilance</th>
          <th title="Kolik pixelů této barvy simulace skutečně vyčistila / kolik bylo potřeba. Když cleared < need a balance je +0, jde o STRATEGICKÝ fail simulátoru — carriery byly vystřeleny dřív, než se odhalily všechny shluky té barvy. Heat-mapa pak ukáže, kde zbylé pixely jsou.">vyčištěno</th>
          <th title="Krok greedy simulace, kdy byla tato barva poprvé použita. 'krok 0' = hned dostupná, vysoké číslo = hluboko zakopána.">přístup</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Difficulty Curve panel (Úr. 1) — křivky obtížnosti per-step z trace
// ═══════════════════════════════════════════════════════════════════════

// 1) Compute funkce — pure, vrací array {step, value (0-1), raw}
function _pickPrimaryTrace(traces) {
  if (!traces) return null;
  if (traces.beam && traces.beam.length) return traces.beam;
  const candidates = [traces.fullUse, traces.maxGain].filter(t => t && t.length);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.length - a.length)[0];
}
function computeChoiceCurve(trace) {
  return trace.map(p => ({
    step: p.step,
    value: p.activeCount > 0 ? Math.min(1, p.beneficial / p.activeCount) : 0,
    raw: p,
  }));
}
function computePressureCurve(trace, beltCap) {
  const cap = Math.max(1, beltCap || 14);
  return trace.map(p => ({
    step: p.step,
    value: Math.min(1, (p.beltLoad || 0) / cap),
    raw: p,
  }));
}
function computeProgressCurve(trace) {
  return trace.map(p => {
    const before = (p.remainingPx || 0) + (p.pickedGain || 0);
    return {
      step: p.step,
      value: before > 0 ? Math.min(1, (p.pickedGain || 0) / before) : 0,
      raw: p,
    };
  });
}
function computeSolverGapCurve(traces) {
  if (!traces) return [];
  const lens = {
    maxGain: traces.maxGain ? traces.maxGain.length : 0,
    fullUse: traces.fullUse ? traces.fullUse.length : 0,
    beam:    traces.beam    ? traces.beam.length    : 0,
  };
  const maxLen = Math.max(lens.maxGain, lens.fullUse, lens.beam);
  if (!maxLen) return [];
  const totalAvail = (lens.maxGain ? 1 : 0) + (lens.fullUse ? 1 : 0) + (lens.beam ? 1 : 0);
  const out = [];
  for (let s = 0; s < maxLen; s++) {
    let alive = 0;
    if (lens.maxGain > s) alive++;
    if (lens.fullUse > s) alive++;
    if (lens.beam    > s) alive++;
    const gap = totalAvail > 0 ? alive / totalAvail : 0;
    const rawSrc = (traces.beam && traces.beam[s])
                || (traces.fullUse && traces.fullUse[s])
                || (traces.maxGain && traces.maxGain[s]) || {};
    out.push({
      step: s,
      value: 1 - gap, // 0 = všichni žijí, 1 = nikdo (=stop)
      raw: { ...rawSrc, step: s, aliveCount: alive, totalAvail },
    });
  }
  return out;
}
function buildCurvesFromResult(r) {
  if (!r || !r.traces) return null;
  const primary = _pickPrimaryTrace(r.traces);
  if (!primary || !primary.length) return null;
  return {
    choice:    computeChoiceCurve(primary),
    pressure:  computePressureCurve(primary, r.BELT_CAP || 14),
    progress:  computeProgressCurve(primary),
    solverGap: computeSolverGapCurve(r.traces),
    maxStep: Math.max(
      primary.length,
      r.traces.maxGain ? r.traces.maxGain.length : 0,
      r.traces.fullUse ? r.traces.fullUse.length : 0,
      r.traces.beam    ? r.traces.beam.length    : 0,
    ) - 1,
    primaryStrategy: r.traces.beam && r.traces.beam.length ? 'beam'
                   : r.traces.fullUse && r.traces.fullUse.length ? 'fullUse'
                   : 'maxGain',
  };
}

// 2) SVG renderer — vrací HTML string s <svg> obsahujícím všechny visible curves +
//    pins + crosshair (pro hover tooltip). Multi-curve verze.
function _curveDimColor(dim) { return CURVE_DIM_COLORS[dim] || '#3b82f6'; }

// Přidá dashed overlay s křivkami mutation preview do hlavního SVG.
function _appendMutPreviewOverlay(previewCurves) {
  const svg = document.getElementById('cl-curve-svg');
  if (!svg || !previewCurves || !previewCurves.length) return;
  const W = +svg.dataset.w, H = +svg.dataset.h || 220, P = +svg.dataset.p;
  const ms = +svg.dataset.maxstep;
  const xs = step => P + (step / Math.max(1, ms)) * (W - 2 * P);
  const ys = v => H - P - Math.max(0, Math.min(1, v)) * (H - 2 * P);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'cl-mut-preview-overlay');

  const addLine = (dim, color) => {
    const pts = previewCurves.map(pt => {
      const v = dim === 'choice' ? pt.choice : dim === 'pressure' ? pt.pressure : pt.progress;
      return `${xs(pt.step).toFixed(1)},${ys(v).toFixed(1)}`;
    }).join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', color);
    poly.setAttribute('stroke-width', '2.5');
    poly.setAttribute('stroke-dasharray', '5,3');
    poly.setAttribute('opacity', '0.75');
    g.appendChild(poly);
  };

  if (_curvesUiState.visibleDims.choice)   addLine('choice',   CURVE_DIM_COLORS.choice);
  if (_curvesUiState.visibleDims.pressure) addLine('pressure', CURVE_DIM_COLORS.pressure);
  if (_curvesUiState.visibleDims.progress) addLine('progress', CURVE_DIM_COLORS.progress);

  // Vložit před piny group (aby piny byly nahoře)
  const pinsGroup = svg.querySelector('.cl-curve-pins');
  if (pinsGroup) svg.insertBefore(g, pinsGroup);
  else svg.appendChild(g);
}

function _buildCurveSvg(cache, visibleDims, maxStep) {
  const W = 520, H = 220, P = 32;
  if (!cache) {
    return '<div class="cl-curves-empty">Žádná data k vykreslení.</div>';
  }
  const visible = CURVE_DIMS.filter(d => visibleDims[d] && cache[d] && cache[d].length);
  if (!visible.length) {
    return '<div class="cl-curves-empty">Zaškrtni alespoň jednu dimenzi v ovladačích nahoře.</div>';
  }
  const ms = Math.max(1, maxStep || cache.maxStep || 0);
  const xs = step => P + (step / ms) * (W - 2 * P);
  const ys = v => H - P - Math.max(0, Math.min(1, v)) * (H - 2 * P);

  const parts = [];
  // Y grid + labels (0%, 25%, 50%, 75%, 100%)
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    const y = ys(v);
    parts.push(`<line class="cl-curve-grid" x1="${P}" y1="${y}" x2="${W - P}" y2="${y}"/>`);
    parts.push(`<text class="cl-curve-axis-label" x="${P - 4}" y="${y + 3}" text-anchor="end">${(v * 100).toFixed(0)}%</text>`);
  }
  // X ticks
  const xTickStep = ms <= 30 ? 5 : ms <= 80 ? 10 : 20;
  for (let s = xTickStep; s <= ms; s += xTickStep) {
    parts.push(`<line x1="${xs(s)}" y1="${H - P}" x2="${xs(s)}" y2="${H - P + 3}" stroke="rgba(255,255,255,0.2)"/>`);
    parts.push(`<text class="cl-curve-axis-label" x="${xs(s)}" y="${H - P + 13}" text-anchor="middle">${s}</text>`);
  }
  parts.push(`<line class="cl-curve-grid" x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}"/>`);

  // Per-dim path — tlustší pro lepší rozlišitelnost při překryvu
  for (const dim of visible) {
    const curve = cache[dim];
    const color = _curveDimColor(dim);
    const d = curve.map((p, i) => `${i ? 'L' : 'M'}${xs(p.step).toFixed(1)},${ys(p.value).toFixed(1)}`).join(' ');
    parts.push(`<path class="cl-curve-line" data-dim="${dim}" d="${d}" stroke="${color}" stroke-width="2" opacity="0.85"/>`);
    // Malé tečky jen na koncových bodech pro orientaci, ne na všech (jinak nepřehledné při překryvu)
    if (curve.length) {
      const last = curve[curve.length - 1];
      parts.push(`<circle cx="${xs(last.step)}" cy="${ys(last.value)}" r="3" fill="${color}" opacity="0.9"/>`);
    }
  }

  // Crosshair vertical line (default skrytý, ukáže se na hover)
  parts.push(`<line id="cl-curve-crosshair" class="cl-curve-crosshair" x1="0" y1="${P}" x2="0" y2="${H - P}" style="visibility:hidden"/>`);

  // Per-step hit areas — neviditelný overlay pro hover detection (vertikální pruh per step)
  if (ms > 0) {
    const stripW = (W - 2 * P) / Math.max(1, ms);
    for (let s = 0; s <= ms; s++) {
      const cx = xs(s);
      parts.push(`<rect class="cl-curve-hit" data-step="${s}" x="${cx - stripW / 2}" y="${P}" width="${stripW}" height="${H - 2 * P}" fill="transparent" pointer-events="all"/>`);
    }
  }

  // Pins group (renderuje se separátně přes _renderCurvePins)
  parts.push(`<g class="cl-curve-pins"></g>`);

  return `<svg id="cl-curve-svg" class="cl-curves-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" data-w="${W}" data-h="${H}" data-p="${P}" data-maxstep="${ms}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

// 3) Pin rendering uvnitř SVG — vykreslí všechny piny aktuální variantu.
//    Piny jsou cross-dimenzní (svislá čára přes celý graf), takže nepotřebují curve.
function _renderCurvePins(variant) {
  const svg = document.getElementById('cl-curve-svg');
  if (!svg) return;
  const pinsGroup = svg.querySelector('.cl-curve-pins');
  if (!pinsGroup) return;
  pinsGroup.innerHTML = '';
  const pins = (variant && Array.isArray(variant.curveAnnotations)) ? variant.curveAnnotations : [];
  if (!pins.length) return;

  const W = +svg.dataset.w, H = +svg.dataset.h, P = +svg.dataset.p;
  const ms = +svg.dataset.maxstep;
  const xs = step => P + (Math.min(step, ms) / Math.max(1, ms)) * (W - 2 * P);
  const ns = 'http://www.w3.org/2000/svg';

  for (const pin of pins) {
    const isExpanded = _curvesUiState.expandedPinId === pin.id && pin.stepEnd > pin.stepStart;
    const orphan = pin.stepStart > ms;
    const startVisX = orphan ? W - P + 4 : xs(pin.stepStart);
    const endVisX = orphan ? W - P + 4 : xs(Math.min(pin.stepEnd, ms));

    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'cl-curve-pin');
    g.setAttribute('data-pin-id', pin.id);

    // Range fill (jen v expand mode + ne orphan)
    if (isExpanded && !orphan) {
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'cl-curve-pin-range');
      rect.setAttribute('x', startVisX);
      rect.setAttribute('y', P);
      rect.setAttribute('width', Math.max(0, endVisX - startVisX));
      rect.setAttribute('height', H - 2 * P);
      g.appendChild(rect);
    }

    // Levá hrana (vždy)
    const lineL = document.createElementNS(ns, 'line');
    lineL.setAttribute('class', 'cl-curve-pin-line');
    lineL.setAttribute('x1', startVisX);
    lineL.setAttribute('y1', P);
    lineL.setAttribute('x2', startVisX);
    lineL.setAttribute('y2', H - P);
    g.appendChild(lineL);

    // Pravá hrana (jen expand)
    if (isExpanded && !orphan) {
      const lineR = document.createElementNS(ns, 'line');
      lineR.setAttribute('class', 'cl-curve-pin-line');
      lineR.setAttribute('x1', endVisX);
      lineR.setAttribute('y1', P);
      lineR.setAttribute('x2', endVisX);
      lineR.setAttribute('y2', H - P);
      g.appendChild(lineR);
    }

    // Drag handles (jen expand)
    if (isExpanded && !orphan) {
      const hL = document.createElementNS(ns, 'circle');
      hL.setAttribute('class', 'cl-curve-pin-handle');
      hL.setAttribute('data-handle', 'start');
      hL.setAttribute('cx', startVisX);
      hL.setAttribute('cy', H / 2);
      hL.setAttribute('r', 5);
      g.appendChild(hL);
      const hR = document.createElementNS(ns, 'circle');
      hR.setAttribute('class', 'cl-curve-pin-handle');
      hR.setAttribute('data-handle', 'end');
      hR.setAttribute('cx', endVisX);
      hR.setAttribute('cy', H / 2);
      hR.setAttribute('r', 5);
      g.appendChild(hR);
    }

    // Chip (klikatelný — otevře popover)
    const chipFO = document.createElementNS(ns, 'foreignObject');
    const chipW = orphan ? 26 : (pin.tag ? 90 : 30);
    chipFO.setAttribute('x', startVisX - chipW / 2);
    chipFO.setAttribute('y', P - 22);
    chipFO.setAttribute('width', chipW);
    chipFO.setAttribute('height', 20);
    chipFO.setAttribute('style', 'overflow:visible');
    const chip = document.createElement('div');
    chip.setAttribute('class', 'cl-curve-pin-chip' + (orphan ? ' cl-pin-orphan' : ''));
    chip.setAttribute('data-pin-id', pin.id);
    chip.setAttribute('data-action', 'open-popover');
    chip.title = orphan ? `Pin je za koncem aktuálního trace (step ${pin.stepStart}, max ${ms})` : '';
    chip.textContent = orphan ? '⚠' : (pin.tag || '📌');
    chipFO.appendChild(chip);
    g.appendChild(chipFO);

    pinsGroup.appendChild(g);
  }
}

// 4) Hlavní render — volá se z renderTesterResults + dim změna + variant switch
function renderCurvesPanel(lvl, variant) {
  const wrap = document.getElementById('cl-curves');
  if (!wrap) return;
  if (!variant) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const empty = document.getElementById('cl-curves-empty');
  const svgWrap = document.getElementById('cl-curves-svg-wrap');
  const status = document.getElementById('cl-curves-status');

  // Sync toggles → state (po prvním renderu, default je vše checked)
  document.querySelectorAll('#cl-curves [data-curve-dim]').forEach(cb => {
    if (typeof _curvesUiState.visibleDims[cb.dataset.curveDim] === 'boolean') {
      cb.checked = _curvesUiState.visibleDims[cb.dataset.curveDim];
    }
  });

  if (!_lastTesterResult) {
    if (svgWrap) svgWrap.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = 'Klikni <b>▶ Analyzovat</b> v sekci playtester pro zobrazení křivek obtížnosti.';
    }
    if (status) status.textContent = 'data nejsou';
    _hideCurvePopover();
    return;
  }
  if (!_curveCache) _curveCache = buildCurvesFromResult(_lastTesterResult);
  if (!_curveCache) {
    if (svgWrap) svgWrap.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'Level je nedohratelný — žádná data k vykreslení křivek.';
    }
    if (status) status.textContent = 'trace prázdné';
    return;
  }
  if (empty) empty.hidden = true;

  const html = _buildCurveSvg(_curveCache, _curvesUiState.visibleDims, _curveCache.maxStep);
  if (svgWrap) {
    svgWrap.innerHTML = html;
    // Preview overlay — pokud je aktivní suggestion preview, vykreslit jako dashed overlay
    if (_mutSuggestState.previewIdx !== null && svgWrap.dataset.mutPreview) {
      try {
        const previewCurves = JSON.parse(svgWrap.dataset.mutPreview);
        _appendMutPreviewOverlay(previewCurves);
      } catch (e) { /* ignore */ }
    }
  }

  if (status) {
    const strat = _curveCache.primaryStrategy === 'beam' ? 'beam search'
              : _curveCache.primaryStrategy === 'fullUse' ? 'full-use heuristik'
              : 'max-gain heuristik';
    const visCount = CURVE_DIMS.filter(d => _curvesUiState.visibleDims[d]).length;
    status.textContent = `${_curveCache.maxStep + 1} kroků · ${strat} · ${visCount}/4 dimenzí`;
  }

  // Piny (variant per-variant)
  if (!Array.isArray(variant.curveAnnotations)) variant.curveAnnotations = [];
  _renderCurvePins(variant);

  // Pokud je popover otevřený, znovu pozicovat (variant.curveAnnotations stále existuje)
  if (_curvesUiState.openPopoverId) {
    const stillExists = variant.curveAnnotations.find(p => p.id === _curvesUiState.openPopoverId);
    if (stillExists) _showCurvePopover(stillExists);
    else _hideCurvePopover();
  }
}

// 5) Tooltip + popover helpers
function _formatCurveTooltip(dim, raw) {
  if (!raw) return '';
  const parts = [`krok ${raw.step}`];
  if (typeof raw.activeCount === 'number')  parts.push(`active ${raw.activeCount}`);
  if (typeof raw.beneficial === 'number')   parts.push(`beneficial ${raw.beneficial}`);
  if (typeof raw.pickedGain === 'number')   parts.push(`gain ${raw.pickedGain}px`);
  if (typeof raw.beltLoad === 'number')     parts.push(`belt ${raw.beltLoad}/${(_lastTesterResult && _lastTesterResult.BELT_CAP) || 14}`);
  if (typeof raw.remainingPx === 'number')  parts.push(`zbývá ${raw.remainingPx}px`);
  if (dim === 'solverGap' && typeof raw.aliveCount === 'number') {
    parts.push(`${raw.aliveCount}/${raw.totalAvail} strategií`);
  }
  return parts.join(' • ');
}

// Multi-row tooltip — pro daný step ukáže hodnoty všech visible dimenzí + raw kontext.
function _showCurveMultiTooltip(step, mouseX, mouseY) {
  if (!_curveCache) return;
  const visible = CURVE_DIMS.filter(d => _curvesUiState.visibleDims[d] && _curveCache[d] && _curveCache[d].length);
  if (!visible.length) { _hideCurveTooltip(); return; }
  const rows = [];
  let rawCtx = null;
  for (const dim of visible) {
    const point = _curveCache[dim].find(p => p.step === step);
    if (!point) continue;
    if (!rawCtx) rawCtx = point.raw;
    const pct = Math.round(point.value * 100);
    const color = _curveDimColor(dim);
    const label = dim === 'solverGap' ? 'gap' : dim;
    rows.push(`<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:9px;height:9px;background:${color};border-radius:2px"></span><span style="min-width:54px">${label}</span><span style="font-weight:600">${pct}%</span></div>`);
  }
  const ctxParts = [`<b>krok ${step}</b>`];
  if (rawCtx) {
    if (typeof rawCtx.activeCount === 'number')  ctxParts.push(`active ${rawCtx.activeCount}`);
    if (typeof rawCtx.beneficial === 'number')   ctxParts.push(`benef ${rawCtx.beneficial}`);
    if (typeof rawCtx.pickedGain === 'number')   ctxParts.push(`gain ${rawCtx.pickedGain}px`);
    if (typeof rawCtx.beltLoad === 'number')     ctxParts.push(`belt ${rawCtx.beltLoad}/${(_lastTesterResult && _lastTesterResult.BELT_CAP) || 14}`);
    if (typeof rawCtx.remainingPx === 'number')  ctxParts.push(`zbývá ${rawCtx.remainingPx}px`);
  }
  const html = `<div style="margin-bottom:3px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:3px">${ctxParts.join(' • ')}</div>${rows.join('')}`;
  _showCurveTooltip(html, mouseX, mouseY);
}
function _showCurveTooltip(html, mouseX, mouseY) {
  let tip = document.querySelector('.cl-curve-tooltip');
  const wrap = document.getElementById('cl-curves-svg-wrap');
  if (!wrap) return;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'cl-curve-tooltip';
    wrap.appendChild(tip);
  }
  tip.hidden = false;
  tip.innerHTML = html;
  const rect = wrap.getBoundingClientRect();
  const x = mouseX - rect.left + 10;
  const y = mouseY - rect.top - 26;
  tip.style.left = Math.max(4, Math.min(rect.width - tip.offsetWidth - 4, x)) + 'px';
  tip.style.top = Math.max(0, y) + 'px';
}
function _hideCurveTooltip() {
  const tip = document.querySelector('.cl-curve-tooltip');
  if (tip) tip.hidden = true;
}

function _showCurvePopover(pin) {
  const pop = document.getElementById('cl-curves-pin-popover');
  const svg = document.getElementById('cl-curve-svg');
  if (!pop || !svg) return;
  _curvesUiState.openPopoverId = pin.id;
  const W = +svg.dataset.w, P = +svg.dataset.p, ms = +svg.dataset.maxstep;
  const stepClamp = Math.min(pin.stepStart, ms);
  const xs = P + (stepClamp / Math.max(1, ms)) * (W - 2 * P);
  const svgRect = svg.getBoundingClientRect();
  // Pozice je relativní k popover.parentElement (cl-curves-body, který má position:relative).
  // Bez tohoto by se popover umístil podle nejbližšího pozicovaného předka — což může být body
  // → popover skočí do levého horního rohu obrazovky.
  const refRect = (pop.offsetParent || pop.parentElement).getBoundingClientRect();
  const screenX = svgRect.left + (xs / W) * svgRect.width;
  const localX = screenX - refRect.left;
  const localY = svgRect.top + svgRect.height * 0.18 - refRect.top;

  const tagOptions = PIN_TAGS.map(t =>
    `<option value="${t}"${pin.tag === t ? ' selected' : ''}>${t}</option>`
  ).join('');
  const isOrphan = pin.stepStart > ms;
  const meta = pin.stepEnd > pin.stepStart
    ? `kroky ${pin.stepStart}–${pin.stepEnd}`
    : `krok ${pin.stepStart}`;
  pop.innerHTML = `
    <select class="cl-pin-tag" data-pin-id="${pin.id}">
      <option value="">— zvol tag —</option>${tagOptions}
    </select>
    <textarea class="cl-pin-note" data-pin-id="${pin.id}" rows="2" placeholder="poznámka…">${(pin.note || '').replace(/</g, '&lt;')}</textarea>
    <div class="cl-pin-popover-meta">${meta}${isOrphan ? ' <span class="cl-curves-warn">⚠ za koncem trace</span>' : ''}</div>
    <div class="cl-pin-actions">
      <button type="button" class="cl-pin-delete" data-pin-id="${pin.id}">✕ smazat</button>
      ${isOrphan ? `<button type="button" class="cl-pin-snap" data-pin-id="${pin.id}">↩ posun na konec</button>` : ''}
      ${_lastTesterResult && pin.tag ? `
        <label class="cl-pin-suggest-mode" title="beam = přesnější eval (~10–30 s s progress barem), greedy = rychlé (~250 ms)">
          <input type="checkbox" class="cl-pin-suggest-beam"${_mutSuggestState.evalModePref === 'beam' ? ' checked' : ''}> beam
        </label>
        <button type="button" class="cl-pin-suggest" data-pin-id="${pin.id}">⚙ Suggest</button>
      ` : ''}
      <button type="button" class="cl-pin-close">hotovo</button>
    </div>`;
  pop.style.left = Math.max(4, Math.min(refRect.width - 200, localX)) + 'px';
  pop.style.top = Math.max(0, localY) + 'px';
  pop.hidden = false;
}
function _hideCurvePopover() {
  const pop = document.getElementById('cl-curves-pin-popover');
  if (pop) { pop.hidden = true; pop.innerHTML = ''; }
  _curvesUiState.openPopoverId = null;
}

// ── Mutation Designer (Fáze 2) ─────────────────────────────────────────────

// Aplikuje mutaci na variant.grid (transponované indexy: grid[row][col]).
function applyMutationToVariant(variant, mut) {
  if (!variant || !Array.isArray(variant.grid)) return;
  const g = variant.grid;
  const getCell = ({col, row}) => (g[row] && g[row][col] !== undefined ? g[row][col] : undefined);
  const setCell = ({col, row}, val) => { if (g[row]) g[row][col] = val; };
  switch (mut.type) {
    case 'SWAP_CELLS': {
      const tmp = getCell(mut.a);
      setCell(mut.a, getCell(mut.b));
      setCell(mut.b, tmp);
      break;
    }
    case 'SWAP_COLORS': {
      const sA = getCell(mut.a), sB = getCell(mut.b);
      if (!sA || !sB) break;
      const cA = sA.color;
      setCell(mut.a, {...sA, color: sB.color});
      setCell(mut.b, {...sB, color: cA});
      break;
    }
    case 'INSERT_WALL':
      setCell(mut.a, {type: 'wall'});
      break;
    case 'REMOVE_WALL':
      setCell(mut.a, null);
      break;
    case 'TOGGLE_HIDDEN': {
      const s = getCell(mut.a);
      if (s) setCell(mut.a, {...s, hidden: !s.hidden});
      break;
    }
  }
}

// Renderuje mini SVG overlay pro suggestion kartu (choice=modrá, pressure=červená).
function _buildMutMiniSvg(baseCurves, newCurves) {
  const W = 200, H = 50, P = 4;
  if (!baseCurves || !baseCurves.length) return '';
  const maxStep = Math.max(baseCurves[baseCurves.length - 1].step, 1);
  const px = step => P + (step / maxStep) * (W - 2 * P);
  const py = val => H - P - Math.min(1, Math.max(0, val)) * (H - 2 * P);

  const line = (curves, dim, color, dash) => {
    if (!curves || !curves.length) return '';
    const pts = curves.map(pt => {
      const v = dim === 'choice' ? pt.choice : pt.pressure;
      return `${px(pt.step).toFixed(1)},${py(v).toFixed(1)}`;
    }).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="3,2"' : ''}/>`;
  };

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="cl-mut-mini-svg">
    <rect width="${W}" height="${H}" rx="3" fill="#1a1a2e" opacity="0.4"/>
    ${line(baseCurves, 'choice',   '#3b82f6', true)}
    ${line(baseCurves, 'pressure', '#ef4444', true)}
    ${line(newCurves,  'choice',   '#3b82f6', false)}
    ${line(newCurves,  'pressure', '#ef4444', false)}
    <text x="${P}" y="${H - 1}" font-size="7" fill="#888">— nový &nbsp; - - základ (choice=mod, press=čer)</text>
  </svg>`;
}

// Renderuje panel s výsledky mutací.
function renderMutSuggestPanel(lvl, variant) {
  const panel = document.getElementById('cl-mut-suggest-panel');
  if (!panel) return;

  if (_mutSuggestState.loading) {
    panel.hidden = false;
    const mode = _mutSuggestState.evalMode === 'beam' ? '🎯 beam' : 'greedy';
    const progress = _mutSuggestState.progress;
    let body;
    if (progress && progress.total > 0) {
      const pct = Math.round((progress.current / progress.total) * 100);
      body = `⏳ Hledám mutace (${mode})… <b>${progress.current} / ${progress.total}</b>
        <div class="cl-mut-progress-bar"><div class="cl-mut-progress-fill" style="width:${pct}%"></div></div>`;
    } else {
      body = `⏳ Hledám mutace (${mode})… (50 simulací)`;
    }
    panel.innerHTML = `<div class="cl-mut-loading">${body}</div>`;
    return;
  }

  const results = _mutSuggestState.results;
  if (!results || !results.length) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  panel.hidden = false;
  const DIM_LABELS = { choice: 'choice', pressure: 'pressure', progress: 'progress' };

  const cards = results.map((s, idx) => {
    const deltaSign = s.deltaClicks > 0 ? '+' : '';
    const solvedBadge = s.solved
      ? '<span class="cl-mut-badge cl-mut-badge-ok">✓ dohratelné</span>'
      : '<span class="cl-mut-badge cl-mut-badge-warn">⚠ neověřeno</span>';
    const previewActive = _mutSuggestState.previewIdx === idx;

    // Validační řádek — zkontroluj jestli každá dimenze šla správným směrem
    let dirHtml = '';
    if (s.dimDeltas) {
      const chips = Object.entries(s.dimDeltas).map(([dim, d]) => {
        const ok = d.wanted === d.got;
        const neutral = d.got === '=';
        const arrow = d.got === '+' ? '↑' : d.got === '-' ? '↓' : '—';
        const cls = neutral ? 'cl-mut-dir-neutral' : ok ? 'cl-mut-dir-ok' : 'cl-mut-dir-bad';
        const deltaStr = (d.delta >= 0 ? '+' : '') + (d.delta * 100).toFixed(1) + '%';
        const title = `${DIM_LABELS[dim] || dim}: chtěli jsme ${d.wanted === '+' ? 'zvýšit' : 'snížit'}, skutečná změna ${deltaStr}`;
        return `<span class="cl-mut-dir-chip ${cls}" title="${title}">${arrow}${DIM_LABELS[dim] || dim} ${deltaStr}</span>`;
      }).join('');
      dirHtml = `<div class="cl-mut-dir">${chips}</div>`;
    }

    return `<div class="cl-mut-card${previewActive ? ' cl-mut-card-preview' : ''}">
      <div class="cl-mut-card-head">
        <span class="cl-mut-desc">${s.desc}</span>
        ${solvedBadge}
      </div>
      ${_buildMutMiniSvg(s.baseCurves, s.newCurves)}
      ${dirHtml}
      <div class="cl-mut-diff">
        <span title="Změna počtu kliků">kliky: <b>${deltaSign}${s.deltaClicks}</b></span>
        <span title="Skóre = jak moc mutace tlačí křivku správným směrem">skóre: <b>${s.score > 0 ? '+' : ''}${s.score}</b></span>
      </div>
      <div class="cl-mut-actions">
        <button class="cl-mut-preview-btn${previewActive ? ' active' : ''}" data-mut-idx="${idx}">
          ${previewActive ? '◼ Skrýt' : '▷ Preview'}
        </button>
        <button class="cl-mut-apply-btn" data-mut-idx="${idx}">✓ Aplikovat</button>
      </div>
    </div>`;
  }).join('');

  panel.innerHTML = `<div class="cl-mut-header">
    <span>Navrhované mutace (top ${results.length})</span>
    <button class="cl-mut-close">✕</button>
  </div>
  <div class="cl-mut-cards">${cards}</div>`;
}

// 6) Step snap — z mouse X pozice nad SVG vypočte step (round-to-int)
function _snapMouseXToStep(svg, mouseClientX) {
  const W = +svg.dataset.w, P = +svg.dataset.p, ms = +svg.dataset.maxstep;
  const rect = svg.getBoundingClientRect();
  const localX = (mouseClientX - rect.left) * (W / rect.width);
  const stepFloat = ((localX - P) / (W - 2 * P)) * ms;
  return Math.max(0, Math.min(ms, Math.round(stepFloat)));
}

// 7) Event wiring — voláno jednou v init
function _wireCurvesPanelOnce() {
  const wrap = document.getElementById('cl-curves');
  const svgWrap = document.getElementById('cl-curves-svg-wrap');
  if (!wrap || !svgWrap) return;

  // Toggle dim checkboxes — přepne visibility, re-render
  document.querySelectorAll('#cl-curves [data-curve-dim]').forEach(cb => {
    cb.addEventListener('change', () => {
      _curvesUiState.visibleDims[cb.dataset.curveDim] = cb.checked;
      renderCurvesPanel(beCurrentLvl(), clActiveVariant(beCurrentLvl()));
    });
  });

  // Toggle re-render po expand panelu (race condition safety)
  wrap.addEventListener('toggle', () => {
    if (wrap.open) {
      renderCurvesPanel(beCurrentLvl(), clActiveVariant(beCurrentLvl()));
    } else {
      _hideCurvePopover();
    }
  });

  // SVG event delegation — klik
  svgWrap.addEventListener('click', (ev) => {
    const svg = document.getElementById('cl-curve-svg');
    if (!svg || ev.target.closest('.cl-curve-pin-popover')) return;

    const lvl = beCurrentLvl();
    const variant = clActiveVariant(lvl);
    if (!variant) return;
    if (!Array.isArray(variant.curveAnnotations)) variant.curveAnnotations = [];

    // Klik na chip → otevři popover
    const chip = ev.target.closest('[data-action="open-popover"]');
    if (chip) {
      const pinId = chip.dataset.pinId;
      const pin = variant.curveAnnotations.find(p => p.id === pinId);
      if (pin) _showCurvePopover(pin);
      return;
    }
    // Klik na handle → ignoruj (drag handler řeší)
    if (ev.target.classList.contains('cl-curve-pin-handle')) return;

    // Klik na pin čáru → toggle expand mode
    const pinLine = ev.target.closest('.cl-curve-pin-line');
    if (pinLine) {
      const pinG = pinLine.closest('.cl-curve-pin');
      if (!pinG) return;
      const pinId = pinG.dataset.pinId;
      const pin = variant.curveAnnotations.find(p => p.id === pinId);
      if (!pin) return;
      if (_curvesUiState.expandedPinId === pinId) {
        pin.stepEnd = pin.stepStart;
        _curvesUiState.expandedPinId = null;
      } else {
        const ms = +svg.dataset.maxstep;
        pin.stepEnd = Math.min(ms, pin.stepStart + Math.max(1, Math.floor(ms * 0.1)));
        _curvesUiState.expandedPinId = pinId;
      }
      markDirty();
      _renderCurvePins(variant);
      return;
    }
    // Klik na range fill → ignoruj (chápeme jako neutral plochu pinu)
    if (ev.target.classList.contains('cl-curve-pin-range')) return;

    // Klik kdekoli jinde v SVG (hit-rect nebo background) → vytvoř nový pin
    if (ev.target.closest('#cl-curve-svg')) {
      // Snap to step: pokud klik byl na hit-rect, použij dataset.step (přesné),
      // jinak vypočítej z pozice myši.
      const hitRect = ev.target.classList.contains('cl-curve-hit') ? ev.target : null;
      const step = hitRect ? +hitRect.dataset.step : _snapMouseXToStep(svg, ev.clientX);
      const pin = {
        id: 'pin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        stepStart: step,
        stepEnd: step,
        tag: '',
        note: '',
      };
      variant.curveAnnotations.push(pin);
      _curvesUiState.expandedPinId = null;
      markDirty();
      _renderCurvePins(variant);
      _showCurvePopover(pin);
    }
  });

  // Hover — vertikální crosshair + multi-row tooltip přes všechny visible dimenze
  svgWrap.addEventListener('mousemove', (ev) => {
    const hitRect = ev.target.classList.contains('cl-curve-hit') ? ev.target : null;
    const svg = document.getElementById('cl-curve-svg');
    const crosshair = document.getElementById('cl-curve-crosshair');
    if (!hitRect || !svg || !_curveCache) {
      _hideCurveTooltip();
      if (crosshair) crosshair.style.visibility = 'hidden';
      return;
    }
    const step = +hitRect.dataset.step;
    const W = +svg.dataset.w, P = +svg.dataset.p, ms = +svg.dataset.maxstep;
    const xs = P + (step / Math.max(1, ms)) * (W - 2 * P);
    if (crosshair) {
      crosshair.setAttribute('x1', xs);
      crosshair.setAttribute('x2', xs);
      crosshair.style.visibility = 'visible';
    }
    _showCurveMultiTooltip(step, ev.clientX, ev.clientY);
  });
  svgWrap.addEventListener('mouseleave', () => {
    _hideCurveTooltip();
    const crosshair = document.getElementById('cl-curve-crosshair');
    if (crosshair) crosshair.style.visibility = 'hidden';
  });

  // Drag handles — mousedown na handle → start drag, document mousemove → update, mouseup → end
  svgWrap.addEventListener('mousedown', (ev) => {
    if (!ev.target.classList.contains('cl-curve-pin-handle')) return;
    const pinG = ev.target.closest('.cl-curve-pin');
    if (!pinG) return;
    _curvesUiState.dragHandle = {
      pinId: pinG.dataset.pinId,
      side: ev.target.dataset.handle, // 'start' | 'end'
    };
    ev.preventDefault();
  });
  document.addEventListener('mousemove', (ev) => {
    const drag = _curvesUiState.dragHandle;
    if (!drag) return;
    const svg = document.getElementById('cl-curve-svg');
    if (!svg) return;
    const lvl = beCurrentLvl();
    const variant = clActiveVariant(lvl);
    if (!variant || !Array.isArray(variant.curveAnnotations)) return;
    const pin = variant.curveAnnotations.find(p => p.id === drag.pinId);
    if (!pin) return;
    const step = _snapMouseXToStep(svg, ev.clientX);
    if (drag.side === 'start') {
      pin.stepStart = Math.max(0, Math.min(pin.stepEnd - 1, step));
    } else {
      pin.stepEnd = Math.max(pin.stepStart + 1, Math.min(+svg.dataset.maxstep, step));
    }
    _renderCurvePins(variant);
  });
  document.addEventListener('mouseup', () => {
    if (_curvesUiState.dragHandle) {
      _curvesUiState.dragHandle = null;
      markDirty();
    }
  });

  // Popover form events (delegated)
  const pop = document.getElementById('cl-curves-pin-popover');
  if (pop) {
    pop.addEventListener('change', (ev) => {
      const lvl = beCurrentLvl();
      const variant = clActiveVariant(lvl);
      if (!variant) return;
      if (ev.target.classList.contains('cl-pin-tag')) {
        const pin = variant.curveAnnotations.find(p => p.id === ev.target.dataset.pinId);
        if (pin) {
          pin.tag = ev.target.value;
          markDirty();
          _renderCurvePins(variant);
        }
        return;
      }
      // Beam toggle — uložit preferenci pro příští otevření popoverkobce
      if (ev.target.classList.contains('cl-pin-suggest-beam')) {
        _mutSuggestState.evalModePref = ev.target.checked ? 'beam' : 'greedy';
      }
    });
    let noteTimer = null;
    pop.addEventListener('input', (ev) => {
      if (!ev.target.classList.contains('cl-pin-note')) return;
      const lvl = beCurrentLvl();
      const variant = clActiveVariant(lvl);
      if (!variant) return;
      const pin = variant.curveAnnotations.find(p => p.id === ev.target.dataset.pinId);
      if (!pin) return;
      pin.note = ev.target.value;
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => markDirty(), 300);
    });
    pop.addEventListener('click', (ev) => {
      const lvl = beCurrentLvl();
      const variant = clActiveVariant(lvl);
      if (!variant) return;
      if (ev.target.classList.contains('cl-pin-delete')) {
        const idx = variant.curveAnnotations.findIndex(p => p.id === ev.target.dataset.pinId);
        if (idx >= 0) {
          variant.curveAnnotations.splice(idx, 1);
          _curvesUiState.expandedPinId = null;
          _hideCurvePopover();
          markDirty();
          _renderCurvePins(variant);
        }
        return;
      }
      if (ev.target.classList.contains('cl-pin-snap')) {
        const pin = variant.curveAnnotations.find(p => p.id === ev.target.dataset.pinId);
        if (pin && _curveCache) {
          pin.stepStart = _curveCache.maxStep;
          pin.stepEnd = _curveCache.maxStep;
          markDirty();
          _renderCurvePins(variant);
          _showCurvePopover(pin); // re-pozicovat
        }
        return;
      }
      if (ev.target.classList.contains('cl-pin-close')) {
        _hideCurvePopover();
        return;
      }
      // ⚙ Suggest — odešle pin do game.js, spustí mutation search
      if (ev.target.classList.contains('cl-pin-suggest')) {
        const pin = variant.curveAnnotations.find(p => p.id === ev.target.dataset.pinId);
        if (!pin) return;
        const frame = document.getElementById('preview-frame');
        if (!frame || !frame.contentWindow) return;
        // Eval mode přečteme z checkboxu v popoverkobce a zapamatujeme preferenci.
        const popBeamCb = pop.querySelector('.cl-pin-suggest-beam');
        const evalMode = (popBeamCb && popBeamCb.checked) ? 'beam' : 'greedy';
        _mutSuggestState.evalModePref = evalMode;
        _mutSuggestState.loading = true;
        _mutSuggestState.pinId = pin.id;
        _mutSuggestState.results = [];
        _mutSuggestState.previewIdx = null;
        _mutSuggestState.progress = null;
        _mutSuggestState.evalMode = evalMode;
        renderMutSuggestPanel(null, null);
        _hideCurvePopover();
        frame.contentWindow.postMessage({ type: 'balloonbelt:suggest-mutations', pin, evalMode }, '*');
        return;
      }
    });
  }

  // Mutation suggest panel — delegovaný handler
  const mutPanel = document.getElementById('cl-mut-suggest-panel');
  if (mutPanel) {
    mutPanel.addEventListener('click', (ev) => {
      // Zavřít panel
      if (ev.target.classList.contains('cl-mut-close')) {
        _mutSuggestState.results = [];
        _mutSuggestState.previewIdx = null;
        renderMutSuggestPanel(null, null);
        return;
      }
      const lvl = beCurrentLvl();
      const variant = clActiveVariant(lvl);
      if (!variant) return;

      // Preview — toggle overlay křivky na hlavním SVG
      if (ev.target.classList.contains('cl-mut-preview-btn')) {
        const idx = +ev.target.dataset.mutIdx;
        _mutSuggestState.previewIdx = _mutSuggestState.previewIdx === idx ? null : idx;
        renderMutSuggestPanel(lvl, variant);
        // Overlay preview křivky na hlavní SVG (přidat data-attr na svgWrap)
        const svgWrapEl = document.getElementById('cl-curves-svg-wrap');
        if (svgWrapEl) {
          if (_mutSuggestState.previewIdx !== null) {
            const sug = _mutSuggestState.results[_mutSuggestState.previewIdx];
            svgWrapEl.dataset.mutPreview = JSON.stringify(sug ? sug.newCurves : []);
          } else {
            delete svgWrapEl.dataset.mutPreview;
          }
          renderCurvesPanel(lvl, variant);
        }
        return;
      }

      // Apply — zapíše mutaci do variant.grid
      if (ev.target.classList.contains('cl-mut-apply-btn')) {
        const idx = +ev.target.dataset.mutIdx;
        const sug = _mutSuggestState.results[idx];
        if (!sug) return;
        // Snapshot PŘED mutací — Cmd+Z ji vrátí (unikátní actionKey = nekoalescuje)
        histPush(lvl, 'cl-mut-apply-' + Date.now());
        applyMutationToVariant(variant, sug.mutation);
        markDirty();
        clRenderGrid(variant);
        // Resetovat suggest panel + spustit novou analýzu
        _mutSuggestState.results = [];
        _mutSuggestState.previewIdx = null;
        const svgWrapEl = document.getElementById('cl-curves-svg-wrap');
        if (svgWrapEl) delete svgWrapEl.dataset.mutPreview;
        renderMutSuggestPanel(lvl, variant);
        // Trigger re-analýzy
        const frame = document.getElementById('preview-frame');
        if (frame && frame.contentWindow) {
          const farSighted = !!(document.getElementById('cl-far-sighted') && document.getElementById('cl-far-sighted').checked);
          frame.contentWindow.postMessage({ type: 'balloonbelt:analyze-level', farSighted }, '*');
        }
        return;
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Replay & Scrub (Úr. 1.5) — mini canvas přehrávač průchodu solverem
// ═══════════════════════════════════════════════════════════════════════
let _replayState = {
  strategy: 'beam',     // 'beam' | 'fullUse' | 'maxGain'
  step: 0,
  isPlaying: false,
  speed: 200,           // ms per krok
  rafTimer: null,
  // Cached při Analyzovat / strategy switch:
  history: null,        // [{step, c, r, color, gain, proj, beltLoad, clearedPixels}]
  initGrid: null,       // 2D pixel grid (deep copy)
  initColumns: null,    // compact carrier columns snapshot
  // Per-step prebuilt pixel grid (lazy)
  gridCache: null,      // index = step (po N kliků), value = 2D grid
};

function _replayBuildGridCache() {
  // Postaví pole gridů: gridCache[0] = init, gridCache[N] = po N kliků.
  if (!_replayState.initGrid || !_replayState.history) return null;
  const cache = [];
  let g = _replayState.initGrid.map(r => r.slice());
  cache.push(g.map(r => r.slice()));
  for (const ev of _replayState.history) {
    g = g.map(r => r.slice());
    if (Array.isArray(ev.clearedPixels)) {
      for (const px of ev.clearedPixels) {
        if (g[px.y]) g[px.y][px.x] = -1;
      }
    }
    cache.push(g);
  }
  _replayState.gridCache = cache;
  return cache;
}

function _replayLoadFromResult(r) {
  if (!r || !r.histories || !r.initGrid || !r.initColumns) {
    _replayState.history = null;
    _replayState.initGrid = null;
    _replayState.initColumns = null;
    _replayState.initBlocks = null;
    _replayState.gridCache = null;
    return false;
  }
  _replayState.initGrid = r.initGrid;
  _replayState.initColumns = r.initColumns;
  _replayState.initBlocks = r.initBlocks || [];
  _replayState.GW = r.GW || 36;
  _replayState.IMG_GH = r.IMG_GH || 27;
  _replayState.COLS = r.COLS || 7;
  _replaySetStrategy(_replayState.strategy, r);
  return true;
}

// Reconstruuj stav bloků (HP) po N kroků: aplikuj postupně blockHits na clone _ptInitBlocks.
// Vrátí pole {kind, x, y, w, h, color, hp, maxHp, _mask} (mask spočítán lokálně z shape).
function _replayBuildBlocksAt(step) {
  if (!_replayState.initBlocks) return [];
  const blocks = _replayState.initBlocks.map(b => ({ ...b, _mask: beBlockMask(b.shape || 'rect', b.w, b.h, 0) }));
  if (!_replayState.history) return blocks;
  for (let i = 0; i < step && i < _replayState.history.length; i++) {
    const ev = _replayState.history[i];
    if (!Array.isArray(ev.blockHits)) continue;
    for (const bh of ev.blockHits) {
      // Najdi blok podle pozice (x, y) — initBlocks indexy nejsou stable, ale pozice jsou unique
      const target = blocks.find(b => b.x === bh.x && b.y === bh.y && b.color === bh.color);
      if (!target) continue;
      target.hp = bh.hpAfter;
    }
  }
  return blocks;
}

function _replaySetStrategy(strategy, result) {
  const r = result || _lastTesterResult;
  if (!r || !r.histories) return;
  const hist = r.histories[strategy] || r.histories.beam || r.histories.fullUse || r.histories.maxGain;
  if (!hist) return;
  _replayState.strategy = strategy;
  _replayState.history = hist;
  // Initial dispense events (před prvním klikem) — per strategie, fallback na cokoliv
  const initDisp = r.initialDispenses || {};
  _replayState.initialDispenses = initDisp[strategy] || initDisp.beam || initDisp.fullUse || initDisp.maxGain || [];
  _replayState.gridCache = null; // lazy rebuild
  _replayState.step = 0;
}

// Reconstruuj stav carrier columns po N kroků (s dispense events).
// Začneme initColumns + initialDispenses, pak postupně history events do step.
function _replayBuildColsAt(step) {
  if (!_replayState.initColumns) return null;
  // Deep clone (garáže mají mutable queue)
  const C = _replayState.initColumns.map(col => col.map(s => {
    if (!s) return null;
    if (s.type === 'garage') return { ...s, queueLen: s.queueLen || 0 };
    return { ...s };
  }));

  const applyDispenses = (dispenses) => {
    for (const d of dispenses) {
      if (d.emptied) {
        // Garáž došla a vydala se → null
        if (C[d.from.c]) C[d.from.c][d.from.r] = null;
        continue;
      }
      if (!d.to) continue;
      // Garáž vydala carrier do d.to, sníží queueLen
      const gar = C[d.from.c] && C[d.from.c][d.from.r];
      if (gar && gar.type === 'garage') {
        gar.queueLen = Math.max(0, (gar.queueLen || 0) - 1);
      }
      if (C[d.to.c]) {
        C[d.to.c][d.to.r] = { color: d.color, projectiles: d.projectiles || 0 };
      }
    }
  };

  // Initial dispenses (před prvním klikem)
  if (_replayState.initialDispenses && _replayState.initialDispenses.length) {
    applyDispenses(_replayState.initialDispenses);
  }

  if (_replayState.history) {
    for (let i = 0; i < step && i < _replayState.history.length; i++) {
      const ev = _replayState.history[i];
      // Pop carrier
      if (typeof ev.c === 'number' && typeof ev.r === 'number') {
        if (C[ev.c]) C[ev.c][ev.r] = null;
      }
      // Dispenses po kliku
      if (Array.isArray(ev.dispenses)) applyDispenses(ev.dispenses);
    }
  }
  return C;
}

function _replayDrawCarrier(step) {
  const canvas = document.getElementById('cl-replay-carrier');
  if (!canvas || !_replayState.initColumns) return;
  const cols = _replayBuildColsAt(step);
  if (!cols) return;
  const COLS = cols.length;
  const rows = Math.max(1, ...cols.map(c => c.length));
  // Aspect-fit do canvas 200×160
  const cellSize = Math.min(Math.floor(200 / COLS), Math.floor(160 / rows));
  const offX = Math.floor((200 - cellSize * COLS) / 2);
  const offY = Math.floor((160 - cellSize * rows) / 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 200, 160);

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < cols[c].length; r++) {
      const slot = cols[c][r];
      const x = offX + c * cellSize;
      const y = offY + r * cellSize;
      const w = cellSize - 1, h = cellSize - 1;
      if (slot === null) {
        // Null = tunel (popnutý / dispensovaný / původně null)
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x, y, w, h);
        continue;
      }
      if (slot.wall) {
        ctx.fillStyle = '#444';
        ctx.fillRect(x, y, w, h);
        continue;
      }
      if (slot.type === 'garage') {
        ctx.fillStyle = '#7c4a1a';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = Math.max(8, Math.floor(cellSize * 0.5)) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🏠', x + w / 2, y + h / 2 - 2);
        // Queue length badge
        if (slot.queueLen > 0) {
          ctx.fillStyle = '#fff';
          ctx.font = Math.max(7, Math.floor(cellSize * 0.3)) + 'px ui-monospace, monospace';
          ctx.fillText(String(slot.queueLen), x + w / 2, y + h - 5);
        }
        continue;
      }
      if (slot.type === 'rocket') {
        ctx.fillStyle = BE_COLORS[slot.color] || '#888';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = Math.max(8, Math.floor(cellSize * 0.5)) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚀', x + w / 2, y + h / 2);
        continue;
      }
      // Carrier
      ctx.fillStyle = BE_COLORS[slot.color] || '#888';
      ctx.fillRect(x, y, w, h);
      if (slot.hidden) {
        ctx.fillStyle = '#000';
        ctx.font = Math.max(8, Math.floor(cellSize * 0.5)) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x + w / 2, y + h / 2);
      }
    }
  }

  // Aktivní pop highlight: ev na step (= příští klik) rámuj
  if (_replayState.history && step < _replayState.history.length) {
    const ev = _replayState.history[step];
    if (typeof ev.c === 'number' && typeof ev.r === 'number') {
      const x = offX + ev.c * cellSize;
      const y = offY + ev.r * cellSize;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cellSize - 3, cellSize - 3);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellSize - 1, cellSize - 1);
    }
  }

  // Highlight dispense events právě v tomto kroku (step-1 → step)
  if (step > 0 && _replayState.history && step <= _replayState.history.length) {
    const prev = _replayState.history[step - 1];
    if (prev && Array.isArray(prev.dispenses)) {
      ctx.lineWidth = 2;
      for (const d of prev.dispenses) {
        if (!d.to) continue;
        const x = offX + d.to.c * cellSize;
        const y = offY + d.to.r * cellSize;
        ctx.strokeStyle = '#10b981'; // zelená pro dispense
        ctx.strokeRect(x + 1, y + 1, cellSize - 3, cellSize - 3);
      }
    }
  }
}

function _replayDrawImage(step) {
  const canvas = document.getElementById('cl-replay-image');
  if (!canvas || !_replayState.initGrid) return;
  if (!_replayState.gridCache) _replayBuildGridCache();
  const cache = _replayState.gridCache;
  if (!cache) return;
  const idx = Math.max(0, Math.min(cache.length - 1, step));
  const grid = cache[idx];
  const GH = grid.length;
  const GW = grid[0] ? grid[0].length : 36;
  // Canvas 288×216 → 8 px per cell na 36×27
  const cellPx = Math.min(Math.floor(288 / GW), Math.floor(216 / GH));
  const offX = Math.floor((288 - cellPx * GW) / 2);
  const offY = Math.floor((216 - cellPx * GH) / 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 288, 216);
  // 1) Pixely
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const v = grid[y][x];
      if (v < 0) continue;
      ctx.fillStyle = BE_COLORS[v] || '#888';
      ctx.fillRect(offX + x * cellPx, offY + y * cellPx, cellPx, cellPx);
    }
  }
  // 2) Bloky (s HP labelem) — překryjí pixely podobně jako v reálné hře
  const blocks = _replayBuildBlocksAt(step);
  for (const b of blocks) {
    if (b.hp <= 0) continue;
    const m = b._mask;
    if (!m) continue;
    // Vykresli pouze buňky uvnitř shape mask
    const baseColor = b.kind === 'mystery' ? '#444' : (BE_COLORS[b.color] || '#888');
    ctx.fillStyle = baseColor;
    for (let dy = 0; dy < b.h; dy++) {
      const row = m[dy];
      if (!row) continue;
      for (let dx = 0; dx < b.w; dx++) {
        if (!row[dx]) continue;
        ctx.fillRect(offX + (b.x + dx) * cellPx, offY + (b.y + dy) * cellPx, cellPx, cellPx);
      }
    }
    // Tmavší okraj kolem celého bbox bloku — odliší od solid pixel oblasti
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offX + b.x * cellPx + 0.5, offY + b.y * cellPx + 0.5, b.w * cellPx - 1, b.h * cellPx - 1);
    // HP label
    const cx = offX + (b.x + b.w / 2) * cellPx;
    const cy = offY + (b.y + b.h / 2) * cellPx;
    const fontSize = Math.max(7, Math.min(13, Math.floor(Math.min(b.w, b.h) * cellPx * 0.4)));
    ctx.font = `bold ${fontSize}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    const label = `${b.hp}/${b.maxHp}`;
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, cx, cy);
  }
  // 3) Highlight pixely + bloky právě hit v tomto kroku (step-1 → step)
  if (step > 0 && step <= _replayState.history.length) {
    const ev = _replayState.history[step - 1];
    if (Array.isArray(ev.clearedPixels)) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      for (const px of ev.clearedPixels) {
        ctx.strokeRect(offX + px.x * cellPx + 0.5, offY + px.y * cellPx + 0.5, cellPx - 1, cellPx - 1);
      }
    }
    if (Array.isArray(ev.blockHits)) {
      ctx.lineWidth = 2;
      for (const bh of ev.blockHits) {
        ctx.strokeStyle = bh.destroyed ? '#10b981' : '#f59e0b';
        ctx.strokeRect(offX + bh.x * cellPx - 0.5, offY + bh.y * cellPx - 0.5, bh.w * cellPx + 1, bh.h * cellPx + 1);
      }
    }
  }
}

function _replayUpdateInfo(step) {
  const info = document.getElementById('cl-replay-info');
  const stepLabel = document.getElementById('cl-replay-step-label');
  const stepNum = document.getElementById('cl-replay-step-num');
  if (!_replayState.history) return;
  const total = _replayState.history.length;
  if (stepLabel) stepLabel.textContent = `(krok ${step} / ${total})`;
  if (stepNum) stepNum.textContent = `${step} / ${total}`;
  if (!info) return;
  if (step === 0) {
    info.textContent = 'začátek — žádné kliky.';
    return;
  }
  const ev = _replayState.history[step - 1];
  if (!ev) { info.textContent = ''; return; }
  const colorSwatch = `<span style="display:inline-block;width:9px;height:9px;background:${BE_COLORS[ev.color] || '#888'};border-radius:2px;vertical-align:middle"></span>`;
  const cleared = (ev.clearedPixels || []).length;
  let html = `klik (${ev.c},${ev.r}) ${colorSwatch} barva ${ev.color} · ${ev.proj} proj · gain ${ev.gain}px · belt ${ev.beltLoad} · zničil ${cleared} px${ev.funnelRejected ? ' · ⚠ funnel rejected' : ''}`;
  if (Array.isArray(ev.blockHits) && ev.blockHits.length) {
    const hits = ev.blockHits.map(bh => {
      const sw = `<span style="display:inline-block;width:8px;height:8px;background:${bh.kind === 'mystery' ? '#444' : (BE_COLORS[bh.color] || '#888')};border-radius:2px;vertical-align:middle"></span>`;
      const symbol = bh.destroyed ? '💥' : '🔨';
      return `${symbol}${sw}(${bh.x},${bh.y}) ${bh.hpBefore}→${bh.hpAfter}`;
    }).join(', ');
    html += `<br><span style="color:#f59e0b">↳ blok hit: ${hits}</span>`;
  }
  if (Array.isArray(ev.dispenses) && ev.dispenses.length) {
    const disp = ev.dispenses.map(d => {
      if (d.emptied) return `🏠(${d.from.c},${d.from.r})→prázdná`;
      const sw = `<span style="display:inline-block;width:8px;height:8px;background:${BE_COLORS[d.color] || '#888'};border-radius:2px;vertical-align:middle"></span>`;
      return `🏠(${d.from.c},${d.from.r})→(${d.to.c},${d.to.r}) ${sw}`;
    }).join(', ');
    html += `<br><span style="color:#10b981">↳ garáž dispens: ${disp}</span>`;
  }
  info.innerHTML = html;
}

function _replayRender() {
  _replayDrawCarrier(_replayState.step);
  _replayDrawImage(_replayState.step);
  _replayUpdateInfo(_replayState.step);
  const scrub = document.getElementById('cl-replay-scrub');
  if (scrub) {
    scrub.max = String(_replayState.history ? _replayState.history.length : 0);
    if (+scrub.value !== _replayState.step) scrub.value = String(_replayState.step);
  }
}

function _replaySetStep(step) {
  if (!_replayState.history) return;
  const max = _replayState.history.length;
  _replayState.step = Math.max(0, Math.min(max, step));
  _replayRender();
}

function _replayPlay() {
  if (!_replayState.history) return;
  if (_replayState.isPlaying) { _replayPause(); return; }
  _replayState.isPlaying = true;
  const btn = document.getElementById('cl-replay-play');
  if (btn) { btn.textContent = '⏸'; btn.classList.add('is-playing'); }
  // Pokud jsme na konci, restart od začátku
  if (_replayState.step >= _replayState.history.length) _replayState.step = 0;
  const tick = () => {
    if (!_replayState.isPlaying) return;
    if (_replayState.step >= _replayState.history.length) {
      _replayPause();
      return;
    }
    _replayState.step++;
    _replayRender();
    _replayState.rafTimer = setTimeout(tick, _replayState.speed);
  };
  _replayState.rafTimer = setTimeout(tick, _replayState.speed);
}

function _replayPause() {
  _replayState.isPlaying = false;
  if (_replayState.rafTimer) { clearTimeout(_replayState.rafTimer); _replayState.rafTimer = null; }
  const btn = document.getElementById('cl-replay-play');
  if (btn) { btn.textContent = '▶'; btn.classList.remove('is-playing'); }
}

function renderReplayPanel() {
  const wrap = document.getElementById('cl-replay');
  if (!wrap) return;
  if (!_lastTesterResult || !_lastTesterResult.histories || !_lastTesterResult.initGrid) {
    wrap.hidden = true;
    return;
  }
  if (!_replayState.history || _replayState.history === null) {
    _replayLoadFromResult(_lastTesterResult);
  }
  if (!_replayState.history) { wrap.hidden = true; return; }
  wrap.hidden = false;
  // Sync strategy dropdown
  const stratSel = document.getElementById('cl-replay-strategy');
  if (stratSel && stratSel.value !== _replayState.strategy) stratSel.value = _replayState.strategy;
  const speedSel = document.getElementById('cl-replay-speed');
  if (speedSel) speedSel.value = String(_replayState.speed);
  _replayRender();
}

function _wireReplayPanelOnce() {
  const stratSel = document.getElementById('cl-replay-strategy');
  if (stratSel) stratSel.addEventListener('change', () => {
    _replayPause();
    _replaySetStrategy(stratSel.value);
    _replayRender();
  });
  const speedSel = document.getElementById('cl-replay-speed');
  if (speedSel) speedSel.addEventListener('change', () => {
    _replayState.speed = +speedSel.value || 200;
  });
  const playBtn = document.getElementById('cl-replay-play');
  if (playBtn) playBtn.addEventListener('click', _replayPlay);
  const firstBtn = document.getElementById('cl-replay-first');
  if (firstBtn) firstBtn.addEventListener('click', () => { _replayPause(); _replaySetStep(0); });
  const lastBtn = document.getElementById('cl-replay-last');
  if (lastBtn) lastBtn.addEventListener('click', () => {
    _replayPause();
    _replaySetStep(_replayState.history ? _replayState.history.length : 0);
  });
  const prevBtn = document.getElementById('cl-replay-prev');
  if (prevBtn) prevBtn.addEventListener('click', () => { _replayPause(); _replaySetStep(_replayState.step - 1); });
  const nextBtn = document.getElementById('cl-replay-next');
  if (nextBtn) nextBtn.addEventListener('click', () => { _replayPause(); _replaySetStep(_replayState.step + 1); });
  const scrub = document.getElementById('cl-replay-scrub');
  if (scrub) scrub.addEventListener('input', () => {
    _replayPause();
    _replaySetStep(+scrub.value);
  });
  // Klik do carrier canvasu = jump na ten krok (najdi nejbližší klik podle (c,r))
  const carrierCanvas = document.getElementById('cl-replay-carrier');
  if (carrierCanvas) carrierCanvas.addEventListener('click', (ev) => {
    if (!_replayState.history || !_replayState.initColumns) return;
    const cols = _replayState.initColumns;
    const COLS = cols.length;
    const rows = Math.max(1, ...cols.map(c => c.length));
    const cellSize = Math.min(Math.floor(200 / COLS), Math.floor(160 / rows));
    const offX = Math.floor((200 - cellSize * COLS) / 2);
    const offY = Math.floor((160 - cellSize * rows) / 2);
    const rect = carrierCanvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (carrierCanvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (carrierCanvas.height / rect.height);
    const cc = Math.floor((x - offX) / cellSize);
    const rr = Math.floor((y - offY) / cellSize);
    // Najdi v history step, kde se klikalo na (cc, rr)
    for (let i = 0; i < _replayState.history.length; i++) {
      const e = _replayState.history[i];
      if (e.c === cc && e.r === rr) {
        _replayPause();
        _replaySetStep(i + 1); // step = "po N kliků", takže +1
        return;
      }
    }
  });
}

// ─── Difficulty score — label klasifikace + expandable breakdown
// Mapuje 0–100 score na 6 kategorií (Relaxing/Easy/Medium/Hard/Hardcore/Broken).
// 100+ = ⚠ Broken — solver nedořešil + zbylo hodně grídu.
// Difficulty thresholdy. Nastaveny tak, aby:
//   - Levely solved všemi 3 solvery + balance ok → Relaxing/Easy (≤ 40)
//   - Levely vyžadující plán (jen beam) + ne-trivial random fail → Medium (40-60)
//   - Levely tight + dlouhé → Hard (60-80)
//   - Vyžadují perfektní plán → Hardcore (80-95)
//   - Solver fail + zbylé pixely → Broken (95+)
function _difficultyMeta(score) {
  if (score >= 95) return { key: 'broken', name: 'Broken?', icon: '⚠', cls: 'score-broken' };
  if (score >= 80) return { key: 'hardcore', name: 'Hardcore', icon: '🔴', cls: 'score-hardcore' };
  if (score >= 60) return { key: 'hard', name: 'Hard', icon: '🟠', cls: 'score-hard' };
  if (score >= 40) return { key: 'medium', name: 'Medium', icon: '🟡', cls: 'score-medium' };
  if (score >= 20) return { key: 'easy', name: 'Easy', icon: '🔵', cls: 'score-easy' };
  return { key: 'relax', name: 'Relaxing', icon: '🟢', cls: 'score-relax' };
}

function _renderDifficultyBreakdown(r) {
  if (!r.diffBreakdown || !r.diffInputs) return '';
  const b = r.diffBreakdown;
  const inp = r.diffInputs;
  const cap = inp.BELT_CAP || 14;
  const total = (b.length||0) + (b.risk||0) + (b.complexity||0) + (b.belt||0) + (b.solverNeed||0) + (b.solver||0);
  const solverResults = inp.solverResults || [];
  const solverResultsStr = solverResults.length
    ? solverResults.map(s => `${s.solved ? '✓' : '✗'} ${s.name}`).join(', ')
    : '—';
  const rows = [
    {
      key: 'length', label: 'Délka levelu',
      input: (inp.projectedClicks && inp.projectedClicks !== inp.clicks)
        ? `~${inp.projectedClicks} kliků (proj.: ${inp.clicks} done + odhad zbylých)`
        : `${inp.clicks} kliků`,
      formula: `min(1, ${inp.projectedClicks || inp.clicks}/40) × 20`,
      hint: 'Víc kliků = delší level = únavnější. Cap při 40 klicích. Pro nedořešené levely se projektuje skutečná délka (done clicks + remainPx ÷ avg gain), aby se nepenalizovalo „krátké" levely jen proto, že solver to v půlce vzdal kvůli overflow.',
      points: b.length || 0, max: 20,
    },
    {
      key: 'solverNeed', label: 'Plánování potřeba',
      input: `${inp.solversSolved || 0}/${inp.solversTotal || 3} solverů (${solverResultsStr})`,
      formula: `(${inp.solversTotal||3}-${inp.solversSolved||0})/${inp.solversTotal||3} × 25`,
      hint: 'Kolik ze 3 solverů (max-gain greedy, full-use greedy, beam search) level dořešilo. 3/3 = jakákoliv strategie projde (intuitivní level). 1/3 = jen chytrý solver (vyžaduje plán). 0/3 = ani plán nestačí (broken nebo extrémně tight).',
      points: b.solverNeed || 0, max: 25,
    },
    {
      key: 'risk', label: 'Riziko zaseknutí (random hráč)',
      input: `${inp.deadEndPct} % fail`,
      formula: `${(inp.deadEndPct/100).toFixed(2)} × 15`,
      hint: 'Z 50 NÁHODNÝCH průchodů (s preferencí beneficial carrierů) kolik končí zaseknutím. Měří jak je level náchylný na chyby v náhodném pořadí. POZOR: random simulace nemá plně lidskou intuici, takže může selhávat i na levelech, kde reálný hráč najde cestu.',
      points: b.risk || 0, max: 15,
    },
    {
      key: 'complexity', label: 'Složitost rozhodování',
      input: `${inp.decisionRichness.toFixed(1)} voleb/krok`,
      formula: `min(1, ${inp.decisionRichness.toFixed(1)}/5) × 15`,
      hint: 'Průměr smysluplných voleb per krok v greedy průchodu. 0 = lineární (jediná správná volba), vyšší = víc cest. Hodně voleb = víc šancí na chybu pro nováčka.',
      points: b.complexity || 0, max: 15,
    },
    {
      key: 'belt', label: 'Belt overflow risk',
      input: `${inp.peakBeltLoad}/${cap}`,
      formula: `${inp.peakBeltLoad}/${cap} × 15`,
      hint: 'Maximální zatížení pásu během solver run. >12 = funnel risk (klik na carrier odmítnut), >14 = game-over scénář.',
      points: b.belt || 0, max: 15,
    },
    {
      key: 'solver', label: 'Penalizace za nedořešení',
      input: inp.solved ? '✓ dořešil (žádná penalty)' : `✗ nedořešil, zbývá ${inp.remainingPx}/${inp.totalPx} px`,
      formula: inp.solved ? '0' : `(0.3 + ${inp.remainingPx}/${inp.totalPx} × 0.7) × 10`,
      hint: 'Trestné body pokud ani beam search level nedořeší. 0 = solver to zvládl (good). Plné body 10 = solver i s 8s budgetem to nedal a zbylo hodně pixelů (level je extrémně tight nebo broken).',
      points: b.solver || 0, max: 10,
    },
  ];
  // Verdikt: rozpoznej charakter levelu z kombinace metrik.
  // Pro nedořešené levely vždycky doporuč ruční ověření — solvery nezvládají všechny
  // chytré lidské tahy (timing, plánování dopředu), takže neúspěch ≠ jistá nedohratelnost.
  let verdict = '';
  const verifyHint = !inp.solved ? ' <b>Designer by měl level ručně přehrát v preview a ověřit dohratelnost</b> — solvery mohou uváznout tam, kde lidský hráč najde cestu.' : '';
  if (inp.solved && inp.deadEndPct >= 80 && inp.decisionRichness < 1.5) {
    verdict = '<div class="cl-db-verdict cl-db-verdict-linear">⚡ <b>Lineární puzzle:</b> solver dořešil, ale pro náhodného hráče je level neprůchozí. Existuje jediná správná posloupnost — pro experta easy, pro nováčka frustrující.</div>';
  } else if (inp.solved && inp.deadEndPct < 20) {
    verdict = '<div class="cl-db-verdict cl-db-verdict-easy">🟢 <b>Forgiving level:</b> solver dořešil, většina náhodných her taky. Hodně cest, level odpouští chyby.</div>';
  } else if (!inp.solved && b.solver >= 8) {
    verdict = `<div class="cl-db-verdict cl-db-verdict-broken">⚠ <b>Možná broken:</b> ani beam search level nedořešil v rozpočtu. Buď extrémně tight balance, nebo design issue (honeycomb dead-end / chybějící carriery).${verifyHint}</div>`;
  } else if (inp.peakBeltLoad > inp.BELT_CAP) {
    verdict = `<div class="cl-db-verdict cl-db-verdict-belt">🚫 <b>Belt overflow:</b> level vede k zablokování pásu. Hra by skončila game-overem.${verifyHint}</div>`;
  } else if (!inp.solved) {
    // Hraniční: solver nedokončil, ale not catastrophically — design může být OK,
    // jen tight nebo vyžaduje human-level plánování. Hlavní use case: tight Hardcore levely.
    verdict = `<div class="cl-db-verdict cl-db-verdict-borderline">🔬 <b>Hraniční level:</b> solver nedořešil, ale ne všechny pixely zbyly. Level je pravděpodobně dohratelný expertem (jen solver uvázl v lokálním optimu).${verifyHint}</div>`;
  }
  const rowsHtml = rows.map(row => `
    <tr>
      <td class="cl-db-label" title="${row.hint}">${row.label}</td>
      <td class="cl-db-input">${row.input}</td>
      <td class="cl-db-formula"><code>${row.formula}</code></td>
      <td class="cl-db-points">${row.points} <span class="cl-db-max">/ ${row.max}</span></td>
    </tr>
  `).join('');
  return `
    <details class="cl-diff-breakdown">
      <summary>Jak je obtížnost spočítána? <span class="cl-db-total">${total} / 100</span></summary>
      ${verdict}
      <table class="cl-db-table">
        <thead><tr><th>Faktor</th><th>Vstup</th><th>Vzorec</th><th>Body</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="cl-db-note">
        <b>Jak to číst:</b> každý faktor přispívá max počtem bodů (sloupec „Body"). Součet = celkové skóre 0–100.
        <b>Solver vs random hráč jsou nezávislé!</b> Solver = expert s plánem (beam search), random = 50 náhodných průchodů (nováček). Level může být současně „solver dořešil" + „100 % random fail" = lineární puzzle.
        Žádná auto-změna level.type — label vedle skóre je jen <i>doporučení</i>.
      </div>
    </details>`;
}

// ─── Trace chart (SVG) — průběh náročnosti per krok pro 3 strategie + envelope
// Kompozit per krok = (1−beneficial/active)*30 + max(0,beltLoad−8)*6 + (beltLoad>14 ? 60 : 0).
// Vyšší = horší krok (víc plýtvání, méně voleb, blízko belt overflow).
// Per-step intenzita kroku — kompozit ukazuje, jak "nervózní" byl daný klik.
// Phase 3: drop waste (balónky cyklují, nemizí). Místo toho belt-load ramping.
function _composite(p) {
  const choiceFactor = p.activeCount > 0 ? 1 - p.beneficial / p.activeCount : 0;
  const bl = p.beltLoad != null ? p.beltLoad : (p.beltLoadEst || 0);
  const beltRamp = Math.max(0, bl - 8) * 6; // belt > 50% kapacity = ramp
  const overflowPenalty = bl > 14 ? 60 : 0;
  return Math.max(0, choiceFactor * 30 + beltRamp + overflowPenalty);
}

function _renderTraceChart(traces, envelope) {
  if (!traces) return '';
  const haveAny = ['maxGain', 'fullUse', 'beam'].some(k => traces[k] && traces[k].length);
  if (!haveAny) return '';
  return `
    <div class="cl-tester-trace">
      <div class="cl-tt-controls">
        <span class="cl-tt-title" title="Graf 'intenzity per krok' pro každou strategii. POZOR: Y-osa NENÍ difficulty score (0-100). Je to per-step kompozit = (1−beneficial/active)*30 + max(0,beltLoad−8)*6 + (beltLoad>14 ? 60 : 0). Vyšší = nervóznější krok (málo voleb, vysoký belt-load). Hover nad bod = detaily kroku.">Intenzita per krok</span>
        <label title="MAX-GAIN GREEDY: V každém kroku vystřelí carrier, který má NEJVÍC vystavených pixelů své barvy v gridu (maximalizuje okamžitý progres). Žádný lookahead. Funguje dobře na volnějších levelech, ale tight levely s balance≈0 typicky selže — pálí carriery i když by se víc pixelů jejich barvy odhalilo později.">
          <input type="checkbox" data-trace="maxGain" ${_traceVisibility.maxGain ? 'checked' : ''}>
          <span class="cl-tt-sw" style="background:#3b82f6"></span> max-gain
        </label>
        <label title="FULL-USE GREEDY: Preferuje carriery, kde gain >= projectiles (žádné plýtvání municí). Když takový neexistuje, fallback na max-gain. Lepší pro tight levely, kde každá ztracená střela = neřešitelné.">
          <input type="checkbox" data-trace="fullUse" ${_traceVisibility.fullUse ? 'checked' : ''}>
          <span class="cl-tt-sw" style="background:#10b981"></span> full-use
        </label>
        <label title="BEAM SEARCH: Drží 8 nejlepších stavů (clicks + waste*10 + remainingPx*0.1) a v každé hloubce expanduje všechny aktivní carriery → znovu ořeže na 8. Time budget 2 s. Najde nejlepší cestu, kterou greedy nevidí. Když ⏱ vyprší, vrátí best-so-far. Pozn.: na grafu může vykazovat vyšší end-game peak než kratší greedy strategie — protože se dostala dál a end-game je přirozeně náročnější (málo voleb, vyšší belt load).">
          <input type="checkbox" data-trace="beam"    ${_traceVisibility.beam ? 'checked' : ''}>
          <span class="cl-tt-sw" style="background:#a855f7"></span> beam
        </label>
        <label title="50× RANDOM SPREAD: Spustí 50 náhodných průchodů (volí carriery náhodně z 'beneficial' poolu). Šedý envelope ukazuje rozsah obtížnosti per krok od 10. percentilu (= šťastný hráč) k 90. percentilu (= smolař). Tečkovaná čára = median (typický hráč). Široký spread = level je hodně závislý na pořadí; úzký = deterministický.">
          <input type="checkbox" data-trace="envelope" ${_traceVisibility.envelope ? 'checked' : ''}>
          <span class="cl-tt-sw cl-tt-sw-env"></span> 50× random spread
        </label>
      </div>
      <div id="cl-tt-svg-wrap">${_buildTraceSvg(traces, envelope)}</div>
    </div>`;
}

function _buildTraceSvg(traces, envelope) {
  const W = 460, H = 160, P = 28;
  // Sjednotit X-rozsah přes všechny trace-y a envelope.
  const allLens = [];
  ['maxGain', 'fullUse', 'beam'].forEach(k => { if (traces[k]) allLens.push(traces[k].length); });
  if (envelope && envelope.p50) allLens.push(envelope.p50.length);
  const maxStep = Math.max(1, ...allLens) - 1;
  // Sjednotit Y-rozsah: max kompozit.
  let maxScore = 10;
  const consider = arr => { for (const p of arr || []) maxScore = Math.max(maxScore, p.score != null ? p.score : _composite(p)); };
  ['maxGain', 'fullUse', 'beam'].forEach(k => consider(traces[k]));
  if (envelope) { consider(envelope.p10); consider(envelope.p50); consider(envelope.p90); }
  maxScore = Math.ceil(maxScore / 10) * 10;
  const xs = step => P + (step / Math.max(1, maxStep)) * (W - 2 * P);
  const ys = v => H - P - (Math.min(maxScore, v) / maxScore) * (H - 2 * P);
  // Axes + grid lines
  const axisLines = [];
  for (let i = 0; i <= 4; i++) {
    const v = (maxScore / 4) * i;
    const y = ys(v);
    axisLines.push(`<line class="cl-tt-grid" x1="${P}" y1="${y}" x2="${W - P}" y2="${y}"/>`);
    axisLines.push(`<text class="cl-tt-axis-label" x="${P - 4}" y="${y + 3}" text-anchor="end">${Math.round(v)}</text>`);
  }
  axisLines.push(`<line class="cl-tt-axis" x1="${P}" y1="${P}" x2="${P}" y2="${H - P}"/>`);
  axisLines.push(`<line class="cl-tt-axis" x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}"/>`);
  axisLines.push(`<text class="cl-tt-axis-label" x="${W / 2}" y="${H - 6}" text-anchor="middle">krok</text>`);
  axisLines.push(`<text class="cl-tt-axis-label" x="8" y="${H / 2}" text-anchor="middle" transform="rotate(-90 8 ${H / 2})">intenzita kroku</text>`);
  // X-axis tick labels every 5 / 10 / 20 steps (adaptive)
  const xTickStep = maxStep <= 50 ? 5 : maxStep <= 100 ? 10 : 20;
  for (let s = xTickStep; s <= maxStep; s += xTickStep) {
    const x = xs(s);
    axisLines.push(`<line x1="${x}" y1="${H - P}" x2="${x}" y2="${H - P + 3}" stroke="#666" stroke-width="1"/>`);
    axisLines.push(`<text class="cl-tt-axis-label" x="${x}" y="${H - P + 11}" text-anchor="middle">${s}</text>`);
  }
  // Envelope (p10–p90 area + p50 dashed line)
  let envSvg = '';
  if (envelope && envelope.p10 && envelope.p90 && _traceVisibility.envelope) {
    const top = envelope.p90.map((p, i) => `${xs(p.step)},${ys(p.score)}`).join(' ');
    const bot = envelope.p10.slice().reverse().map(p => `${xs(p.step)},${ys(p.score)}`).join(' ');
    envSvg += `<polygon class="cl-tt-envelope" points="${top} ${bot}"/>`;
    if (envelope.p50) {
      const med = envelope.p50.map((p, i) => `${i ? 'L' : 'M'}${xs(p.step)},${ys(p.score)}`).join(' ');
      envSvg += `<path class="cl-tt-median" d="${med}"/>`;
    }
  }
  // Strategy paths + hover dots
  const series = [
    { k: 'maxGain', cls: 'cl-tt-line-maxgain', label: 'max-gain' },
    { k: 'fullUse', cls: 'cl-tt-line-fulluse', label: 'full-use' },
    { k: 'beam',    cls: 'cl-tt-line-beam',    label: 'beam' },
  ];
  let stratSvg = '';
  for (const s of series) {
    if (!_traceVisibility[s.k] || !traces[s.k] || !traces[s.k].length) continue;
    const t = traces[s.k];
    const d = t.map((p, i) => `${i ? 'L' : 'M'}${xs(p.step)},${ys(_composite(p))}`).join(' ');
    stratSvg += `<path class="cl-tt-line ${s.cls}" d="${d}"/>`;
    // Hover dots — native SVG <title> tooltip, žádný JS.
    for (const p of t) {
      stratSvg += `<circle class="cl-tt-dot ${s.cls}" cx="${xs(p.step)}" cy="${ys(_composite(p))}" r="2.5"><title>${s.label} | krok ${p.step} | active ${p.activeCount} | beneficial ${p.beneficial} | gain ${p.pickedGain}/${p.pickedProj} | belt ${p.beltLoad != null ? p.beltLoad : (p.beltLoadEst || 0)}</title></circle>`;
    }
  }
  return `<svg id="cl-tt-svg" viewBox="0 0 ${W} ${H}">${axisLines.join('')}${envSvg}${stratSvg}</svg>`;
}

function _wireTraceCheckboxes() {
  const wrap = document.querySelector('.cl-tt-controls');
  if (!wrap) return;
  wrap.querySelectorAll('input[type="checkbox"][data-trace]').forEach(cb => {
    cb.addEventListener('change', () => {
      _traceVisibility[cb.dataset.trace] = cb.checked;
      const svgWrap = $('cl-tt-svg-wrap');
      if (svgWrap && _lastTesterResult) {
        svgWrap.innerHTML = _buildTraceSvg(_lastTesterResult.traces, _lastTesterResult.randomEnvelope);
      }
    });
  });
}

// ─── Heat-mapa zbytkových pixelů — když solver nedokončí, ukáže kde to drhne.
// Default mini-canvas v testeru, toggle přepne na overlay přes editor obraz canvas.
function _renderHeatmapPanel(remainingGrid, solved) {
  if (!remainingGrid || solved) return '';
  return `
    <div class="cl-tester-heatmap">
      <div class="cl-th-header">
        <span class="cl-th-label" title="Pixely, které solver nedokázal odstranit. Pomáhá vidět, kde se simulace zaseká — která barva zůstala buried v honeycombu.">Zbytkové pixely (solver nedokončil)</span>
        <button id="cl-th-toggle" class="btn btn-small" type="button">${_heatmapMode === 'overlay' ? '⤡ Skrýt overlay' : '⤢ Zobrazit přes obraz'}</button>
      </div>
      <canvas id="cl-th-mini" width="180" height="135" style="${_heatmapMode === 'overlay' ? 'display:none' : ''}"></canvas>
    </div>`;
}

function _drawRemainingHeatmap(remainingGrid, mode) {
  const targetId = mode === 'overlay' ? 'cl-th-overlay' : 'cl-th-mini';
  let cv = document.getElementById(targetId);
  if (mode === 'overlay' && !cv) {
    // Lazy-create overlay canvas přes editor obraz canvas (be-canvas).
    const beCanvas = $('be-canvas');
    if (!beCanvas) return;
    cv = document.createElement('canvas');
    cv.id = 'cl-th-overlay';
    cv.width = beCanvas.width;
    cv.height = beCanvas.height;
    cv.className = 'cl-th-overlay-canvas';
    // Pozice — připoj na parent element be-canvasu (oba absolute v jednom containeru).
    const parent = beCanvas.parentElement;
    if (parent) {
      parent.style.position = parent.style.position || 'relative';
      parent.appendChild(cv);
    } else {
      document.body.appendChild(cv);
    }
  }
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const S = mode === 'overlay' ? BE_SCALE : 5;
  const GW = 36; // BE_GW
  const GH = remainingGrid.length;
  if (mode === 'mini') {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, cv.width, cv.height);
  } else {
    ctx.globalAlpha = 0.7;
  }
  for (let y = 0; y < GH; y++) {
    const row = remainingGrid[y];
    if (!row) continue;
    for (let x = 0; x < GW; x++) {
      const v = row[x];
      if (v == null || v < 0) continue;
      ctx.fillStyle = BE_COLORS[v] || '#888';
      ctx.fillRect(x * S, y * S, S, S);
    }
  }
  ctx.globalAlpha = 1.0;
}

function _wireHeatmapToggle() {
  const btn = $('cl-th-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!_lastTesterResult || !_lastTesterResult.remainingGrid) return;
    if (_heatmapMode === 'mini') {
      _heatmapMode = 'overlay';
      const mini = $('cl-th-mini');
      if (mini) mini.style.display = 'none';
      _drawRemainingHeatmap(_lastTesterResult.remainingGrid, 'overlay');
      btn.textContent = '⤡ Skrýt overlay';
    } else {
      _heatmapMode = 'mini';
      const mini = $('cl-th-mini');
      if (mini) mini.style.display = '';
      const overlay = document.getElementById('cl-th-overlay');
      if (overlay) overlay.remove();
      btn.textContent = '⤢ Zobrazit přes obraz';
      _drawRemainingHeatmap(_lastTesterResult.remainingGrid, 'mini');
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

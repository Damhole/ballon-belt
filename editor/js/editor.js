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
const BE_COLORS = ['#3dd64a','#ff7a1a','#5bc8f5','#1b9aff','#ff4fa3','#f5d800','#8b4dff','#141414','#ffffff'];
const BE_SHAPES = ['rect','cross','L','T','circle'];

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
// type, imageDifficulty, image, blocks, rocketTargets, garage). NEsnapshotujeme
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
    imageDifficulty: lvl.imageDifficulty,
    image: lvl.image, blocks: lvl.blocks,
    rocketTargets: lvl.rocketTargets, garage: lvl.garage,
    carrierLayouts: lvl.carrierLayouts,
  }));
}
function histApplySnap(lvl, snap) {
  // Mutujeme stejnou level referenci (nevyměňujeme pole) aby index v state.levels
  // a WeakMap handle zůstal platný.
  lvl.label = snap.label;
  lvl.key = snap.key;
  lvl.type = snap.type;
  lvl.imageDifficulty = snap.imageDifficulty;
  lvl.image = snap.image;
  lvl.blocks = snap.blocks;
  lvl.rocketTargets = snap.rocketTargets;
  lvl.garage = snap.garage;
  lvl.carrierLayouts = snap.carrierLayouts;
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
    state.levels = await readLevelsJson();
    state.selectedIdx = -1;
    state.dirty = false;
    setLastAction('Loaded ' + state.levels.length + ' levels from editor/levels.json');
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
  const dupes = findDuplicateKeys(state.levels);
  try {
    await writeLevelsJson(state.levels);
    if (!dupes.length) {
      await writeGameLevelsJs(state.levels);
      setLastAction('💾 Autosaved (' + state.levels.length + ' levels) → editor/levels.json + gamee/js/levels.js');
      // Preview reload AŽ po dokončení zápisu. Jinak by iframe reload proběhl
      // s 150ms debouncem ještě PŘED tím, než autosave (300ms debounce) stihne
      // zapsat soubor → iframe by si natahoval starou verzi levels.js.
      // Navíc: server servíruje z /tmp/gamee (TCC blokuje ~/Documents), kam
      // běží rsync daemon v tight loop. FSA write proběhne do ~/Documents
      // instantně, ale do /tmp se mirror dostane za ~20-50ms. Dáme rsyncu
      // 250ms forku, aby reload iframe chytil aktuální verzi (bez téhle pauzy
      // viděl uživatel edit až po DALŠÍ akci, protože /tmp měl zpoždění).
      setTimeout(() => reloadPreview(), 250);
    } else {
      setLastAction('⚠ editor/levels.json saved, but gamee/js/levels.js skipped — duplicate keys: ' + dupes.join(', '));
    }
    state.dirty = false;
    $('dirty-status').hidden = true;
  } catch (e) {
    console.error(e);
    setLastAction('❌ Autosave failed: ' + e.message);
  }
}

// Manual "Publish" = force immediate save (same as autosave, but synchronous to the click).
async function publishToGame() {
  if (!state.rootHandle) return;
  if (!state.levels.length) { alert('No levels to publish.'); return; }
  const dupes = findDuplicateKeys(state.levels);
  if (dupes.length) { alert('Cannot publish — duplicate keys: ' + dupes.join(', ')); return; }
  if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
  try {
    await writeLevelsJson(state.levels);
    await writeGameLevelsJs(state.levels);
    state.dirty = false;
    setLastAction('🚀 Published ' + state.levels.length + ' levels to gamee/js/levels.js');
    schedulePreviewReload();
    updateUI();
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
function carrierDifficultyRank() { return 3; } // editor assumes "medium" as middle
function computeTotalDifficulty(imgDiff) {
  const total = imgDiff + carrierDifficultyRank(); // img + 3
  if (total <= 3) return { key: 'relaxing', label: 'Relaxing' };
  if (total <= 5) return { key: 'medium', label: 'Medium' };
  if (total <= 7) return { key: 'hard', label: 'Hard' };
  return { key: 'hardcore', label: 'Hard-core' };
}

// Model mutations -----------------------------------------------------------
function newLevel() {
  return {
    key: 'new-level-' + (state.levels.length + 1),
    label: 'Nový level',
    type: 'relaxing',
    imageDifficulty: 1,
    image: { source: 'smiley' },
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
  state.levels.splice(idx, 1);
  if (state.selectedIdx === idx) state.selectedIdx = -1;
  else if (state.selectedIdx > idx) state.selectedIdx -= 1;
  markDirty();
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
}

// Vyhodnotí status levelu napříč všemi 3 obtížnostmi. Vrací kind (ok/warn/bad),
// ikonu a důvod (tooltip). Použito v sidebaru za diff badge.
//
// Logika:
//   - "bad"  = nějaká obtížnost MÁ layout, ale ten spadl na auto-gen (layout-fallback
//              postMessage z hry) NEBO má unreachable carriers. Hra se nechová podle designu.
//   - "warn" = žádný layout pro některou obtížnost (hra použije auto-gen implicitně),
//              nebo layout pokrývá barvy jen částečně (kapacita nedostačuje podle pxCounts).
//   - "ok"   = pro každou obtížnost (kde máme pxCounts) existuje layout, BFS projde,
//              kapacita pokryje všechny potřebné barvy. Nebo: zatím neznáme pxCounts
//              (preview neběžel), ale layouty syntakticky OK — zobrazíme ? informativně.
function clComputeLevelStatus(lvl) {
  if (!lvl) return { kind: 'ok', icon: '·', reason: '' };
  const layouts = Array.isArray(lvl.carrierLayouts) ? lvl.carrierLayouts : [];
  const problems = [];
  const warnings = [];

  // 1) Statické kontroly (nezávislé na pxCounts z preview):
  for (const v of layouts) {
    if (!v || !Array.isArray(v.grid) || !v.grid.length) continue;
    const unreach = clCountUnreachable(v);
    if (unreach > 0) {
      problems.push('"' + (v.name || '?') + '" (' + (v.difficulty || '?') + '): ' + unreach + ' nedostupných nosičů');
    }
  }

  // 2) Kontrola pro každou obtížnost: existuje layout? Spadl při runu na auto-gen?
  //    Pokrývá požadované barvy?
  const diffs = ['easy', 'medium', 'hard'];
  const statusBag = state.layoutStatusByLevel[lvl.key] || {};
  const pxBag = state.pxCountsByLevel[lvl.key] || {};
  for (const d of diffs) {
    const hasLayout = layouts.some(v => v && v.difficulty === d);
    if (!hasLayout) {
      warnings.push(d + ': žádný layout (hra použije auto-gen)');
      continue;
    }
    // Pokud hra posílala fallback pro tuto obtížnost → bad.
    const st = statusBag[d];
    if (st && st.applied === false) {
      problems.push(d + ': layout spadl na auto-gen (' + (st.reason || 'neznámý důvod') + ')');
      continue;
    }
    // Kontrola kapacity (need slots per color ≤ layout slots per color).
    const px = pxBag[d] || pxBag.easy || pxBag.medium || pxBag.hard;
    if (px) {
      const v = layouts.find(vv => vv && vv.difficulty === d);
      if (v) {
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
  }

  if (problems.length) {
    return { kind: 'bad', icon: '✗', reason: 'Chyby:\n• ' + problems.join('\n• ') };
  }
  if (warnings.length) {
    return { kind: 'warn', icon: '⚠', reason: 'Upozornění:\n• ' + warnings.join('\n• ') };
  }
  return { kind: 'ok', icon: '✓', reason: 'Level je v pořádku napříč obtížnostmi.' };
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

    const diff = computeTotalDifficulty(lvl.imageDifficulty || 1);
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

    // Drag & drop
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drag-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to = idx;
      if (!Number.isNaN(from)) reorderLevel(from, to);
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
function renderEditor() {
  const form = $('edit-form');
  const empty = $('edit-empty');
  const idx = state.selectedIdx;
  if (idx < 0 || idx >= state.levels.length) {
    form.hidden = true;
    empty.hidden = false;
    if (_lastPreviewKey !== null) { _lastPreviewKey = null; schedulePreviewReload(); }
    return;
  }
  form.hidden = false;
  empty.hidden = true;
  const lvl = state.levels[idx];

  $('f-key').value = lvl.key || '';
  $('f-label').value = lvl.label || '';
  $('f-type').value = lvl.type || 'relaxing';
  $('f-image-source').value = (lvl.image && lvl.image.source) || 'smiley';
  $('f-img-diff').value = lvl.imageDifficulty || 1;
  $('f-img-diff-val').textContent = lvl.imageDifficulty || 1;

  $('f-gravity-on').checked = !!lvl.gravity;

  const rocketsOn = !!lvl.rocketTargets;
  $('f-rockets-on').checked = rocketsOn;
  $('f-rockets-fields').hidden = !rocketsOn;
  $('f-rocket-0').value = rocketsOn ? lvl.rocketTargets[0] : '';
  $('f-rocket-1').value = rocketsOn ? lvl.rocketTargets[1] : '';

  const garageOn = !!lvl.garage;
  $('f-garage-on').checked = garageOn;
  $('f-garage-fields').hidden = !garageOn;
  $('f-garage-col').value = garageOn ? lvl.garage.col : '';
  renderCarrierList(garageOn ? lvl.garage.carriers : []);

  // Block editor render (canvas + palette + selected-block panel).
  if (!Array.isArray(lvl.blocks)) lvl.blocks = [];
  beUpdatePixelToolbarVisibility();
  renderBlockCanvas();
  renderSelectedBlockPanel();

  // Carrier layout editor (Okruh XL) — per-difficulty variants.
  renderCarrierLayout(lvl);

  const diff = computeTotalDifficulty(lvl.imageDifficulty || 1);
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

function renderCarrierList(carriers) {
  const wrap = $('f-garage-carriers');
  wrap.innerHTML = '';
  carriers.forEach((c, i) => {
    const chip = document.createElement('div');
    chip.className = 'carrier-chip';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = 8;
    input.value = c.color;
    input.addEventListener('change', () => {
      const lvl = state.levels[state.selectedIdx];
      if (lvl && lvl.garage) {
        histPush(lvl, 'f-carrier-color-' + i);
        lvl.garage.carriers[i].color = parseInt(input.value, 10) || 0;
        markDirty();
      }
    });
    chip.appendChild(input);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'carrier-chip-remove';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      const lvl = state.levels[state.selectedIdx];
      if (lvl && lvl.garage) {
        histPush(lvl, 'f-carrier-del');
        lvl.garage.carriers.splice(i, 1);
        markDirty();
      }
    });
    chip.appendChild(rm);
    wrap.appendChild(chip);
  });
}

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
  // Diff tabs: highlight active.
  const tabs = document.querySelectorAll('.cl-diff-tab');
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.diff === state.clActiveDiff);
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

function clGetStatsForCurrent(lvl) {
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
    let status = 'ok';
    if (pxCounts) {
      if (need > 0 && has === 0) { status = 'bad'; problems.push('barva ' + c + ': chybí nosiče (' + need + ' px)'); }
      else if (need > 0 && has < needSlots) { status = 'bad'; problems.push('barva ' + c + ': málo slotů (' + has + '/' + needSlots + ')'); }
      else if (need === 0 && has > 0) { status = 'warn'; problems.push('barva ' + c + ': přebytečné sloty (' + has + ' bez pixelů)'); }
      else { status = 'ok'; }
    } else {
      // Bez stats jen ukaž sloty — neutral.
      status = 'idle';
    }
    if (status !== 'idle') bump(status);

    // Skryj čipy pro barvy, které jsou bezvýznamné (0 need && 0 slots) když máme stats.
    if (pxCounts && need === 0 && has === 0) continue;

    const chip = document.createElement('div');
    chip.className = 'cl-cap-chip chip-' + status;
    const sw = document.createElement('span');
    sw.className = 'cl-cap-sw';
    sw.style.background = BE_COLORS[c];
    chip.appendChild(sw);
    const nums = document.createElement('span');
    nums.className = 'cl-cap-nums';
    const main = document.createElement('span');
    main.className = 'cl-cap-need';
    if (pxCounts) {
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
      const perSlot = has > 0 ? Math.ceil(need / has) : 0;
      sub.textContent = need + ' px' + (has > 0 ? (' · ' + perSlot + '/nos') : '');
      nums.appendChild(sub);
    }
    chip.appendChild(nums);
    body.appendChild(chip);
  }

  // Layout applied/fallback banner — co hra doopravdy použila?
  const bannerEl = $('cl-layout-banner');
  if (bannerEl) {
    const stBag = state.layoutStatusByLevel[lvl && lvl.key];
    const st = stBag ? stBag[state.clActiveDiff] : null;
    if (st && st.applied === true) {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-ok';
      bannerEl.textContent = '✓ Hra používá tento layout (' + (st.layoutName || variant.name || '?') + ').';
    } else if (st && st.applied === false) {
      bannerEl.hidden = false;
      bannerEl.className = 'cl-layout-banner banner-bad';
      bannerEl.textContent = '⚠ Hra tento layout NEpoužila — spadla na auto-gen. Důvod: ' + (st.reason || 'neznámý') + '.';
    } else {
      bannerEl.hidden = true;
      bannerEl.textContent = '';
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

  // 7) Zapiš carriers do gridu.
  const placedKeys = new Set();
  for (const p of placements) {
    grid[p.pos.r][p.pos.c] = { type: 'carrier', color: p.color };
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

function clRenderPalette() {
  const pal = $('cl-palette');
  if (!pal) return;
  pal.innerHTML = '';
  const items = [];
  items.push({ kind: 'select', label: '◎' });
  items.push({ kind: 'wall', label: '▦' });     // zeď = default blank, blokuje aktivaci
  items.push({ kind: 'null', label: '∅' });      // tunel = propouští aktivaci (honeycomb)
  items.push({ kind: 'garage', label: '🏠' });
  items.push({ kind: 'hidden', label: '?' });
  for (let c = 0; c < BE_COLORS.length; c++) items.push({ kind: 'carrier', color: c });
  for (let c = 0; c < BE_COLORS.length; c++) items.push({ kind: 'rocket', color: c });

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
}

function wireCarrierLayout() {
  // Diff tabs
  document.querySelectorAll('.cl-diff-tab').forEach(tab => {
    tab.addEventListener('click', () => {
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
    if (idx >= 0) lvl.carrierLayouts.splice(idx, 1);
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
  const fontPx = Math.max(10, Math.min(22, Math.floor(Math.min(b.w, b.h) * BE_SCALE * 0.6)));
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
    ctx.restore();
  }
}

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
      histPush(lvl, 'block-color');
      b.color = i;
      renderSelectedBlockPanel();
      renderBlockCanvas();
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
  document.querySelectorAll('#pt-colors .be-color-dot').forEach((d, i) => {
    d.classList.toggle('selected', i === ci);
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
  // Color dots (9 barev)
  const wrap = $('pt-colors');
  if (wrap) {
    wrap.innerHTML = '';
    for (let i = 0; i < BE_COLORS.length; i++) {
      const d = document.createElement('div');
      d.className = 'be-color-dot' + (i === beState.pxColor ? ' selected' : '');
      d.style.background = BE_COLORS[i];
      d.title = 'color ' + i;
      d.addEventListener('click', () => beSetPxColor(i));
      wrap.appendChild(d);
    }
  }
  // Clear all
  const clr = $('pt-clear-all');
  if (clr) clr.addEventListener('click', beClearAllPixels);
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

  // Klik na plátno → hit-test; existující blok = select, jinak deselect.
  cvs.addEventListener('mousedown', (e) => {
    cvs.focus();
    const p = bePxFromEvent(e);
    const lvl = beCurrentLvl();
    const isCustom = lvl && lvl.image && lvl.image.source === 'custom';

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
    L.key = e.target.value.trim();
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
  });
  $('f-img-diff').addEventListener('input', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-imgdiff');
    const v = parseInt(e.target.value, 10);
    L.imageDifficulty = v;
    $('f-img-diff-val').textContent = v;
    markDirty();
    // update badge + list entry
    const diff = computeTotalDifficulty(v);
    const badge = $('summary-badge');
    badge.textContent = diff.label;
    badge.className = 'diff-badge diff-' + diff.key;
    renderList();
  });

  $('f-gravity-on').addEventListener('change', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-gravity-on');
    if (e.target.checked) L.gravity = true;
    else delete L.gravity;
    markDirty();
  });

  $('f-rockets-on').addEventListener('change', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-rockets-on');
    L.rocketTargets = e.target.checked ? [0, 0] : null;
    $('f-rockets-fields').hidden = !e.target.checked;
    if (e.target.checked) {
      $('f-rocket-0').value = 0;
      $('f-rocket-1').value = 0;
    }
    markDirty();
  });
  $('f-rocket-0').addEventListener('change', (e) => {
    const L = lvl(); if (!L || !L.rocketTargets) return;
    histPush(L, 'f-rocket-0');
    L.rocketTargets[0] = parseInt(e.target.value, 10) || 0;
    markDirty();
  });
  $('f-rocket-1').addEventListener('change', (e) => {
    const L = lvl(); if (!L || !L.rocketTargets) return;
    histPush(L, 'f-rocket-1');
    L.rocketTargets[1] = parseInt(e.target.value, 10) || 0;
    markDirty();
  });

  $('f-garage-on').addEventListener('change', (e) => {
    const L = lvl(); if (!L) return;
    histPush(L, 'f-garage-on');
    if (e.target.checked) {
      L.garage = { col: 3, carriers: [{ color: 0 }] };
    } else {
      L.garage = null;
    }
    renderEditor();
    markDirty();
  });
  $('f-garage-col').addEventListener('change', (e) => {
    const L = lvl(); if (!L || !L.garage) return;
    histPush(L, 'f-garage-col');
    L.garage.col = parseInt(e.target.value, 10) || 0;
    markDirty();
  });
  $('btn-add-carrier').addEventListener('click', () => {
    const L = lvl(); if (!L || !L.garage) return;
    histPush(L, 'f-carrier-add');
    L.garage.carriers.push({ color: 0 });
    renderCarrierList(L.garage.carriers);
    markDirty();
  });

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
  renderBlockPalette();
  updateUI();
  tryRestoreConnection();
}
boot();

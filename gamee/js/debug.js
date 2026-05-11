// debug.js — dev-only overlay, loaded only by index_local.html
//
// Layout: #game je flex-column. Volitelné elementy (.controls, #ammo-audit)
// dostávají CSS order:100/101 → vždy ZA herní plochou (image/belt/carriers).
// #dbg-settings-bar je order:200 → úplně poslední flex item.
// Žádný element hry se nepohybuje při zapínání/vypínání toggleů.
//
// Klávesa Shift+D otvírá/zavírá settings panel.
// URL param ?debug=1 auto-otevře panel.
(function () {
  'use strict';

  var BASE_W  = 460;
  var MIN_W   = 320;
  var MIN_H   = 568;
  var SAFE_TOP = 20;

  var panelOpen = false;
  var state     = { levelui: false, stats: false, safezone: false };

  var infoEl, markerEl, safeTopEl, overflowEl, settingsBar, panel;

  // ── Persist ──────────────────────────────────────────────────────────────

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem('bb-dbg') || '{}');
      Object.keys(state).forEach(function (k) {
        if (typeof s[k] === 'boolean') state[k] = s[k];
      });
    } catch (e) {}
  }

  function saveState() {
    try { localStorage.setItem('bb-dbg', JSON.stringify(state)); } catch (e) {}
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  function build() {
    loadState();

    var game = document.getElementById('game');
    if (!game) return;

    // Přesun volitelných elementů na spodek hry pomocí CSS order.
    // #game je display:flex flex-direction:column → order funguje na přímých dětech.
    var controls  = document.querySelector('.controls');
    var ammoAudit = document.getElementById('ammo-audit');

    if (controls) {
      controls.style.order   = '100';
      controls.style.display = 'none';   // skryto, dokud user nezapne Level UI
    }
    if (ammoAudit) {
      ammoAudit.removeAttribute('hidden'); // přebíráme ovládání přes display
      ammoAudit.style.order   = '101';
      ammoAudit.style.display = 'none';   // skryto, dokud user nezapne Stats
    }

    // Overlay elementy (position:absolute uvnitř #game, mimo flex flow)
    infoEl    = mkEl('pre', 'dbg-info',     game);
    markerEl  = mkEl('div', 'dbg-marker',   game);
    var span  = document.createElement('span');
    span.textContent = 'min screen ' + MIN_H + 'px ▼';
    markerEl.appendChild(span);
    safeTopEl  = mkEl('div', 'dbg-safe-top', game);
    safeTopEl.textContent = 'status bar ' + SAFE_TOP + 'px';
    overflowEl = mkEl('div', 'dbg-overflow', game);

    // Settings bar — order:200, vždy poslední flex item v #game
    settingsBar = mkEl('div', 'dbg-settings-bar', game);

    // Settings panel — otevírá se nad barem (position:absolute, bottom:100%)
    panel = mkEl('div', 'dbg-panel', settingsBar);

    var ITEMS = [
      { key: 'levelui',  label: 'Level UI' },
      { key: 'stats',    label: 'Stats' },
      { key: 'safezone', label: 'Safe zone' },
    ];

    ITEMS.forEach(function (item) {
      var pill = document.createElement('div');
      pill.className = 'dbg-pill' + (state[item.key] ? ' active' : '');
      pill.textContent = item.label;
      pill.addEventListener('click', function () {
        state[item.key] = !state[item.key];
        pill.classList.toggle('active', state[item.key]);
        applyKey(item.key);
        saveState();
      });
      panel.appendChild(pill);
    });

    // ⚙ button — vpravo v settings baru
    var btn = mkEl('div', 'dbg-btn', settingsBar);
    btn.textContent = '⚙';
    btn.title = 'Settings (Shift+D)';
    btn.addEventListener('click', togglePanel);

    document.addEventListener('keydown', function (e) {
      if (e.shiftKey && e.key === 'D') togglePanel();
    });

    // Aplikuj uložené stavy
    Object.keys(state).forEach(applyKey);

    // Pravidelná aktualizace safe zone readoutu
    setInterval(function () { if (state.safezone) refreshSafezone(); }, 500);
    window.addEventListener('resize', function () { if (state.safezone) refreshSafezone(); });

    // Auto-open přes ?debug
    if (new URLSearchParams(location.search).has('debug')) togglePanel();
  }

  function mkEl(tag, id, parent) {
    var el = document.createElement(tag);
    el.id  = id;
    parent.appendChild(el);
    return el;
  }

  // ── Toggle panel ──────────────────────────────────────────────────────────

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'flex' : 'none';
    var btn = document.getElementById('dbg-btn');
    if (btn) btn.classList.toggle('open', panelOpen);
  }

  // ── Apply individual toggle ───────────────────────────────────────────────

  function applyKey(key) {
    if (key === 'levelui') {
      var el = document.querySelector('.controls');
      if (el) el.style.display = state.levelui ? '' : 'none';
    }
    if (key === 'stats') {
      var el = document.getElementById('ammo-audit');
      if (el) el.style.display = state.stats ? '' : 'none';
    }
    if (key === 'safezone') {
      document.body.classList.toggle('dbg-active', state.safezone);
      if (state.safezone) refreshSafezone();
    }
  }

  // ── Safe zone overlay refresh ─────────────────────────────────────────────

  function refreshSafezone() {
    if (infoEl) infoEl.textContent = buildInfo();
    if (overflowEl) {
      var game = document.getElementById('game');
      if (game) {
        var overH = Math.max(0, game.scrollHeight - MIN_H);
        overflowEl.style.top    = MIN_H + 'px';
        overflowEl.style.height = overH + 'px';
      }
    }
  }

  function buildInfo() {
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var SECTIONS = [
      ['controls',      'ctrl'],
      ['status',        'stat'],
      ['image-area',    'img '],
      ['belt-wrap',     'belt'],
      ['pending-wrap',  'pend'],
      ['carriers-wrap', 'carr'],
    ];
    var total = 0, rows = [];
    SECTIONS.forEach(function (s) {
      var el = document.getElementById(s[0]);
      if (!el) return;
      var h = Math.round(el.getBoundingClientRect().height);
      total += h;
      rows.push(s[1] + ' ' + pad(h, 4) + ' Σ' + pad(total, 4) + (total > MIN_H ? ' ⚠' : ''));
    });
    var ov = total > MIN_H ? '+' + (total - MIN_H) + 'px ⚠' : 'fits ✓';
    return [
      'vp ' + vw + '×' + vh + ' px',
      'scl ' + (vw / BASE_W).toFixed(2) + '× (' + BASE_W + ')',
      'min ' + MIN_W + '×' + MIN_H,
      ov,
      '─────────────────',
    ].concat(rows).join('\n');
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = ' ' + s;
    return s;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();

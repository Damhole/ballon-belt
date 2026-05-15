// debug.js — dev-only overlay, loaded only by index_local.html
//
// v73.128: refactor — floating settings button (⚙) na pravé straně + popover
// overlay nad funnel area. Veškerá dev UI (level/complexity/theme/stats/safe zone)
// se ovládá uvnitř overlay. Verze a button se vždy zobrazují, ostatní UI je
// schované dokud user nezmáčkne ⚙.
//
// Architektura:
//   - #settings-toggle      = ⚙ floating button (fixed pos vpravo)
//   - #dev-overlay          = popover container nad funnel area (hidden by default)
//   - #version-badge        = top-left funnel area (vždy viditelný)
//   - .controls + #ammo-audit jsou JSem přesunuty do #dev-overlay
//   - Safe zone toggle = pill v overlay; aktivuje #dbg-info/marker/safe-top/overflow
//
// Otevírání: klik na ⚙ nebo Shift+D nebo ?debug=1
// Zavírání: klik na ⚙ znovu / klik mimo overlay / Shift+D
(function () {
  'use strict';

  var BASE_W       = 460;
  var MIN_W_PHYS   = 320;
  var MIN_H_PHYS   = 568;
  var SAFE_TOP_PHYS = 20;
  var SCALE        = BASE_W / MIN_W_PHYS;
  var MIN_H        = Math.round(MIN_H_PHYS * SCALE);
  var SAFE_TOP     = Math.round(SAFE_TOP_PHYS * SCALE);

  var panelOpen = false;
  var state     = { safezone: false };

  var overlay, settingsBtn, safezonePill;
  var infoEl, markerEl, safeTopEl, overflowEl;

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem('bb-dbg') || '{}');
      if (typeof s.safezone === 'boolean') state.safezone = s.safezone;
    } catch (e) {}
  }

  function saveState() {
    try { localStorage.setItem('bb-dbg', JSON.stringify(state)); } catch (e) {}
  }

  function mkEl(tag, id, parent) {
    var el = document.createElement(tag);
    el.id  = id;
    parent.appendChild(el);
    return el;
  }

  function build() {
    loadState();

    var game = document.getElementById('game');
    if (!game) return;

    // ── Floating ⚙ settings button — fixed position vpravo ─────────────
    settingsBtn = document.createElement('button');
    settingsBtn.id = 'settings-toggle';
    settingsBtn.type = 'button';
    settingsBtn.setAttribute('aria-label', 'Settings (Shift+D)');
    settingsBtn.textContent = '⚙';
    settingsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(settingsBtn);

    // ── Overlay container — nad funnel area, hidden by default ─────────
    overlay = document.createElement('div');
    overlay.id = 'dev-overlay';
    overlay.hidden = true;
    overlay.addEventListener('click', function (e) {
      e.stopPropagation(); // klik uvnitř nezavírá
    });
    document.body.appendChild(overlay);

    // ── Move .controls (level/complexity/theme) do overlay ─────────────
    var controls = document.querySelector('.controls');
    if (controls) {
      // Reset legacy styly z předchozího designu (order, display)
      controls.style.removeProperty('order');
      controls.style.removeProperty('display');
      overlay.appendChild(controls);
    }

    // ── Move #ammo-audit (stats chips) do overlay ──────────────────────
    var ammoAudit = document.getElementById('ammo-audit');
    if (ammoAudit) {
      ammoAudit.removeAttribute('hidden');
      ammoAudit.style.removeProperty('order');
      ammoAudit.style.removeProperty('display');
      overlay.appendChild(ammoAudit);
    }

    // ── Safe zone toggle pill ──────────────────────────────────────────
    safezonePill = document.createElement('button');
    safezonePill.type = 'button';
    safezonePill.className = 'dbg-pill' + (state.safezone ? ' active' : '');
    safezonePill.textContent = 'Safe zone';
    safezonePill.addEventListener('click', function () {
      state.safezone = !state.safezone;
      safezonePill.classList.toggle('active', state.safezone);
      applySafezone();
      saveState();
    });
    overlay.appendChild(safezonePill);

    // ── Move version-badge do body (out of #game flex) — vždy viditelný
    var versionBadge = document.getElementById('version-badge');
    if (versionBadge) {
      versionBadge.style.removeProperty('position');
      versionBadge.style.removeProperty('top');
      versionBadge.style.removeProperty('right');
      document.body.appendChild(versionBadge);
    }

    // ── Safe zone overlay markers (position:absolute uvnitř #game) ─────
    infoEl    = mkEl('pre', 'dbg-info',     game);
    markerEl  = mkEl('div', 'dbg-marker',   game);
    markerEl.style.top = MIN_H + 'px';
    var span  = document.createElement('span');
    span.textContent = 'min screen ' + MIN_H + 'px (= ' + MIN_H_PHYS + 'phys @ ' + MIN_W_PHYS + ') ▼';
    markerEl.appendChild(span);
    safeTopEl  = mkEl('div', 'dbg-safe-top', game);
    safeTopEl.style.height = SAFE_TOP + 'px';
    safeTopEl.textContent = 'status bar ' + SAFE_TOP + 'px (= ' + SAFE_TOP_PHYS + 'phys)';
    overflowEl = mkEl('div', 'dbg-overflow', game);

    // ── Click outside overlay → close ─────────────────────────────────
    document.addEventListener('click', function (e) {
      if (!panelOpen) return;
      if (overlay.contains(e.target)) return;
      if (e.target === settingsBtn) return;
      togglePanel();
    });

    // ── Shift+D shortcut ──────────────────────────────────────────────
    document.addEventListener('keydown', function (e) {
      if (e.shiftKey && e.key === 'D') togglePanel();
    });

    // Apply persisted safezone state
    applySafezone();

    // Periodic safe zone readout refresh
    setInterval(function () { if (state.safezone) refreshSafezone(); }, 500);
    window.addEventListener('resize', function () {
      if (state.safezone) refreshSafezone();
      positionFloatingElements();
    });

    // Reposition na load + průběžně (carriers/funnel layout se mění při level switch)
    positionFloatingElements();
    setInterval(positionFloatingElements, 250);

    // Auto-open ?debug
    if (new URLSearchParams(location.search).has('debug')) togglePanel();
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    overlay.hidden = !panelOpen;
    if (settingsBtn) settingsBtn.classList.toggle('open', panelOpen);
    if (panelOpen) positionFloatingElements();
  }

  function applySafezone() {
    document.body.classList.toggle('dbg-active', state.safezone);
    if (state.safezone) refreshSafezone();
  }

  // Dynamic positioning — všechno relativně k #game rect (ne k viewportu),
  // takže na širokém desktopu button neulítává mimo herní blok.
  function positionFloatingElements() {
    var game         = document.getElementById('game');
    var imageArea    = document.getElementById('image-area');
    var carriersGrid = document.getElementById('carriers-grid');
    if (!game || !imageArea || !carriersGrid) return;

    var gameRect     = game.getBoundingClientRect();
    var imageRect    = imageArea.getBoundingClientRect();
    var carriersRect = carriersGrid.getBoundingClientRect();
    var funnelTop    = imageRect.bottom;
    var funnelBot    = carriersRect.top;
    var funnelMid    = (funnelTop + funnelBot) / 2;
    var funnelHeight = Math.max(40, funnelBot - funnelTop);

    // Version badge — top-left funnel area (relativně k image left = deck left)
    var versionBadge = document.getElementById('version-badge');
    if (versionBadge) {
      versionBadge.style.position = 'fixed';
      versionBadge.style.top   = (funnelTop + 6) + 'px';
      versionBadge.style.left  = (imageRect.left + 8) + 'px';
      versionBadge.style.right = 'auto';
      versionBadge.style.zIndex = '160';
    }

    // Settings button — top-right rohu funnel area / kontejneru (zrcadlově
    // k version badge vlevo). Uvnitř funnel area, ne vedle frame.
    if (settingsBtn) {
      var btnSize = 22;
      settingsBtn.style.top  = (funnelTop + 4) + 'px';
      settingsBtn.style.left = (imageRect.right - btnSize - 8) + 'px';
    }

    // Overlay — zarovnaný s deckem (image-area X bounds), TOP nad funnel area.
    // BEZ max-height: kdyby content přerostl funnel area, ať se roztáhne dolů
    // (i přes carriers) místo aby scroll skryl level controls nahoře.
    if (overlay) {
      overlay.style.top    = (funnelTop + 4) + 'px';
      overlay.style.left   = imageRect.left + 'px';
      overlay.style.width  = imageRect.width + 'px';
      overlay.style.maxHeight = (window.innerHeight - funnelTop - 20) + 'px';  // jen viewport guard
    }
  }

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
      if (h === 0) return;
      total += h;
      rows.push(s[1] + ' ' + pad(h, 4) + ' Σ' + pad(total, 4) + (total > MIN_H ? ' ⚠' : ''));
    });
    var ov = total > MIN_H ? '+' + (total - MIN_H) + 'px ⚠' : 'fits ✓';
    return [
      'vp ' + vw + '×' + vh + ' px',
      'scl ' + (vw / BASE_W).toFixed(2) + '× (base ' + BASE_W + ')',
      'phys ' + MIN_W_PHYS + '×' + MIN_H_PHYS + ' (iPhone SE)',
      'css  ' + BASE_W + '×' + MIN_H + ' (× ' + SCALE.toFixed(3) + ')',
      ov,
      '─────────────────',
    ].concat(rows).join('\n');
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = ' ' + s;
    return s;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();

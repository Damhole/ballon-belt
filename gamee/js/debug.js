// debug.js — dev-only overlay, loaded only by index_local.html
// Toggle: click ⚙ button (bottom-right) or Shift+D
// URL param ?debug=1 auto-activates on load
(function () {
  'use strict';

  var MIN_W = 320;
  var MIN_H = 568;
  var SAFE_TOP = 20;   // status bar height
  var BASE_W  = 460;   // game design width

  var active = false;
  var infoEl, markerEl, safeTopEl, overflowEl, btn;

  function build() {
    // Toggle button — fixed bottom-right, always visible
    btn = document.createElement('div');
    btn.id = 'dbg-btn';
    btn.textContent = '⚙';
    btn.title = 'Debug overlay  (Shift+D)';
    document.body.appendChild(btn);

    var game = document.getElementById('game');
    if (!game) return;

    // Info panel — absolute inside #game, top-left corner
    infoEl = document.createElement('pre');
    infoEl.id = 'dbg-info';
    game.appendChild(infoEl);

    // Min-screen marker line at y=568px inside #game
    markerEl = document.createElement('div');
    markerEl.id = 'dbg-marker';
    var span = document.createElement('span');
    span.textContent = 'min screen ' + MIN_H + 'px ▼';
    markerEl.appendChild(span);
    game.appendChild(markerEl);

    // Safe area — status bar at top of game
    safeTopEl = document.createElement('div');
    safeTopEl.id = 'dbg-safe-top';
    safeTopEl.textContent = 'status bar ' + SAFE_TOP + 'px';
    game.appendChild(safeTopEl);

    // Overflow zone — red tint for everything below 568px
    overflowEl = document.createElement('div');
    overflowEl.id = 'dbg-overflow';
    game.appendChild(overflowEl);

    btn.addEventListener('click', toggle);
    document.addEventListener('keydown', function (e) {
      if (e.shiftKey && e.key === 'D') toggle();
    });
    window.addEventListener('resize', refresh);
    setInterval(refresh, 500);

    if (new URLSearchParams(location.search).has('debug')) toggle();
  }

  function toggle() {
    active = !active;
    document.body.classList.toggle('dbg-active', active);
    refresh();
  }

  function refresh() {
    if (!active) return;

    // Update info text
    if (infoEl) infoEl.textContent = buildInfo();

    // Update overflow zone: starts at MIN_H, height = game height - MIN_H
    if (overflowEl) {
      var game = document.getElementById('game');
      if (game) {
        var gameH = game.scrollHeight;  // unscaled layout height
        var overH = Math.max(0, gameH - MIN_H);
        overflowEl.style.top    = MIN_H + 'px';
        overflowEl.style.height = overH + 'px';
      }
    }
  }

  function buildInfo() {
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var scale = (vw / BASE_W).toFixed(3);

    var SECTIONS = [
      ['controls',      'ctrl'],
      ['status',        'stat'],
      ['image-area',    'img '],
      ['belt-wrap',     'belt'],
      ['pending-wrap',  'pend'],
      ['carriers-wrap', 'carr'],
    ];

    var total = 0, rows = [];
    for (var i = 0; i < SECTIONS.length; i++) {
      var el = document.getElementById(SECTIONS[i][0]);
      if (!el) continue;
      var h = Math.round(el.getBoundingClientRect().height);
      total += h;
      rows.push(SECTIONS[i][1] + ' ' + rpad(h, 4) + ' Σ' + rpad(total, 4) + (total > MIN_H ? ' ⚠' : ''));
    }

    var overflow = total > MIN_H
      ? '+' + (total - MIN_H) + 'px over ⚠'
      : 'fits in ' + MIN_H + 'px ✓';

    return [
      'vp  ' + vw + ' × ' + vh + ' px',
      'scl ' + scale + '× (base ' + BASE_W + ')',
      'min ' + MIN_W + ' × ' + MIN_H + ' px',
      overflow,
      '──────────────────',
    ].concat(rows).join('\n');
  }

  function rpad(n, len) {
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

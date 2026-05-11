// debug.js — dev-only overlay, loaded only by index_local.html
// Toggle: click ⚙ button (bottom-right) or Shift+D
// URL param ?debug=1 auto-activates on load
(function () {
  'use strict';

  var MIN_W = 320;
  var MIN_H = 568;
  var SAFE_TOP = 20;    // status bar
  var SAFE_BOT = 34;    // home indicator (iPhone without button)

  var els = {};

  function build() {
    // Toggle button
    var btn = document.createElement('div');
    btn.id = 'dbg-btn';
    btn.textContent = '⚙';
    btn.title = 'Debug overlay  (Shift+D)';
    document.body.appendChild(btn);

    // Min-screen frame (dashed border showing 320×568 boundary)
    var frame = document.createElement('div');
    frame.id = 'dbg-frame';

    var sTop = document.createElement('div');
    sTop.id = 'dbg-safe-top';
    sTop.textContent = 'status bar ' + SAFE_TOP + 'px';
    frame.appendChild(sTop);

    var sBot = document.createElement('div');
    sBot.id = 'dbg-safe-bot';
    sBot.textContent = 'home indicator ' + SAFE_BOT + 'px';
    frame.appendChild(sBot);

    document.body.appendChild(frame);

    // Info panel (top-left)
    var info = document.createElement('pre');
    info.id = 'dbg-info';
    document.body.appendChild(info);

    els = { btn: btn, frame: frame, info: info };

    btn.addEventListener('click', toggle);
    document.addEventListener('keydown', function (e) {
      if (e.shiftKey && e.key === 'D') toggle();
    });

    window.addEventListener('resize', refresh);

    // Auto-activate via ?debug param
    if (new URLSearchParams(location.search).has('debug')) toggle();
  }

  function toggle() {
    document.body.classList.toggle('dbg-active');
    refresh();
  }

  function refresh() {
    if (!document.body.classList.contains('dbg-active')) return;
    positionFrame();
    els.info.textContent = buildInfo();
  }

  function positionFrame() {
    var vw = document.documentElement.clientWidth;
    // Center the 320px frame horizontally; pin to top of viewport
    var left = Math.max(0, Math.round((vw - MIN_W) / 2));
    els.frame.style.left = left + 'px';
    els.frame.style.top = '0px';
    els.frame.style.width = MIN_W + 'px';
    els.frame.style.height = MIN_H + 'px';
  }

  function buildInfo() {
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var scaleStr = (vw / 460).toFixed(3);

    var SECTIONS = [
      { id: 'controls',      label: 'controls   ' },
      { id: 'status',        label: 'status     ' },
      { id: 'image-area',    label: 'image-area ' },
      { id: 'belt-wrap',     label: 'belt-wrap  ' },
      { id: 'pending-wrap',  label: 'pending    ' },
      { id: 'carriers-wrap', label: 'carriers   ' },
    ];

    var total = 0;
    var rows = [];
    for (var i = 0; i < SECTIONS.length; i++) {
      var s = SECTIONS[i];
      var el = document.getElementById(s.id);
      if (!el) continue;
      var h = Math.round(el.getBoundingClientRect().height);
      total += h;
      var flag = total > MIN_H ? ' ⚠' : '';
      rows.push(s.label + pad(h, 4) + 'px  Σ' + pad(total, 4) + 'px' + flag);
    }

    var overflowLine = total > MIN_H
      ? 'overflow  +' + (total - MIN_H) + 'px ⚠'
      : 'fits in ' + MIN_H + 'px ✓';

    return [
      'viewport  ' + vw + ' × ' + vh + ' px',
      'scale     ' + scaleStr + '× (base 460px)',
      'min screen ' + MIN_W + ' × ' + MIN_H + ' px',
      overflowLine,
      '──────────────────────────',
    ].concat(rows).join('\n');
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = ' ' + s;
    return s;
  }

  // Refresh info every 600ms while active (catches dynamic layout changes)
  setInterval(function () { refresh(); }, 600);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();

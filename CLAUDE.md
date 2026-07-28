# Balloon Belt — orientace pro Claude

Single-screen puzzle hra (canvas + DOM) zabalená pro Gamee platformu. Vše je vanilla JS, žádný build step.

## Backlog

**Na začátku session se vždy podívej do [BACKLOG.md](BACKLOG.md)** (root repa).
Je tam prioritizovaný seznam nápadů rozdělený do tabulek (Editor / Hra / Polish / Infra),
inbox pro neotříděné, a sekce „Aktuální okruh" — do té přesuneme to, na čem právě
pracujeme. Po dokončení přesuň záznam do sekce „Hotovo" s odkazem na commit.

Když uživatel řekne „co bude další okruh" nebo „na čem jsme skončili", **první krok**
je přečíst BACKLOG.md a navrhnout z něj. Při brainstormu nových nápadů je zapisuj
do inboxu, ne jen do konverzace — jinak se ztratí mezi session.

**⚠ Po každém commitu `vXX: ...` zapiš řádek do sekce „Hotovo" v BACKLOG.md.**
Dělá se to zapomínat — patří to k post-commit checklistu (viz níže) stejně
jako bump verze. Pokud dotyčný okruh byl v hlavní tabulce označený jako
`💡 idea` nebo `📋 planned`, přepiš ho tam rovnou na `✅ done` s odkazem na
commit. Uživatel se pak nemusí ptát „udělal jsi záznamy do backlogu?".

## Struktura

```
gamee/
├── index.html           prod entry (loads lib/gamee-js.min.js)
├── index_local.html     dev entry (loads lib/gamee-js-stub.js) ← otevřít v prohlížeči
├── css/game.css         stylování
├── js/game.js           ~90 KB, veškerá herní logika
└── lib/
    ├── gamee-js.min.js  reálný Gamee SDK (nedotýkat)
    └── gamee-js-stub.js stub auto-fires 'start' event pro lokální dev
server.py                dev server (alternativa k Ruby httpd)
balloon-belt-gamee.zip   prod bundle (git-ignored, regeneruje se)
```

**Typická změna:**
- herní logika → `gamee/js/game.js`
- styl/layout → `gamee/css/game.css`
- HTML shell → `gamee/index.html` + `gamee/index_local.html` — udržovat synchronní AŽ NA 4 povolené diff bloky (v75.23 stav):
  1. SDK script: `lib/gamee-js.min.js` (prod) vs `lib/gamee-js-stub.js` (dev)
  2. PWA meta blok (manifest, apple-touch-icon, theme-color) — jen dev; z prodí záměrně odstraněn
  3. Načítání skriptů: prod statické tagy s `?v=X`, dev `document.write` s `?t=` bustem
  4. Dev extras: debug.js, stats.js, SW registrace — jen index_local
  Cokoli jiného (canvasy, herní DOM, `_BB_SOUND_V`, verze) MUSÍ být v obou souborech stejné.

## Dev workflow

**Aktuální setup (v75.26, aktualizováno z reálné praxe — ŽÁDNÝ /tmp sync):**

1. Editace v jednom z těchto míst:
   - **Worktree milníkové větve** (běžný režim): `.claude/worktrees/<větev>/gamee/`
   - **Main repo** (jen čtení / uživatelovy věci): `/Users/denishrazdira/CodeProjects/ballon-belt/gamee/`
2. Server: `python3 server.py` z rootu main repa — port 8080, docroot = root repa,
   no-cache hlavičky. Servíruje repo PŘÍMO, včetně worktrees → žádný sync krok:
   - main repo: `http://localhost:8080/gamee/index_local.html`
   - worktree LIVE: `http://localhost:8080/.claude/worktrees/<větev>/gamee/index_local.html`
   (Historický Ruby WEBrick + /tmp sync setup je zrušený.)
3. Force refresh: Cmd+Shift+R. Vždy zkontroluj version badge — říká, na co se koukáš.
   - **Renderer mode** detekce v game.js: default je `3d`, `?renderer=2d` vynutí 2D fallback (pixel-canvas only). `?renderer=3d` je redundantní — neuvádět ho, plain URL stačí.

**Common bugs:**
- „Vidím starou verzi" → browser/SW cache. Force refresh + ověř version badge proti očekávané verzi.
- Preview Panel v Claude Code (Live Preview) neumí load Three.js ES modulů → 3D scéna nezobrazuje. **Test 3D vždy na `localhost:8080`**, ne v Preview panelu.

## Post-commit checklist (VŽDY po commitu bumpnout verzi + zápis do backlogu)

Po každém commitu `vXX: ...` **okamžitě**:

**A) Bump verze na `vYY` v těchto místech:**
1. `gamee/index.html` — `<title>Balloon Belt vYY</title>` + `<div id="version-badge">vYY</div>`
2. `gamee/index_local.html` — totéž
3. `gamee/js/game.js` — checksum string `'balloon-belt-vYY'` (4 výskyty, hledej `gamee.updateScore`) **+ `const BB_VERSION = 'vYY'`** (watchdog, řádek ~4)
4. `gamee/sw.js` — `_VERSION = 'vYY'` (PWA cache name → bump invaliduje starý cache + nový SW se aktivuje)
5. `gamee/index.html` — všechny `?v=YY` query stringy (css + 4 script tagy) + `window._BB_SOUND_V='YY'`; `gamee/index_local.html` — `window._BB_SOUND_V='YY'`
6. `gamee/js/render3d.js` — `window.BB_VERSION_R3D = 'vYY'`; `gamee/js/render3d_bottom.js` — `window.BB_VERSION_R3DB = 'vYY'` (watchdog je porovnává proti BB_VERSION)

**B) Zápis do [BACKLOG.md](BACKLOG.md):**
- Přidej řádek do tabulky `## ✅ Hotovo` s commit hashem + datem
- Pokud okruh byl v hlavní tabulce jako `💡 idea` / `📋 planned`, přepiš ho tam na `✅ done` s odkazem na commit
- Neskončí v konverzaci zapomenuté — backlog je zdroj pravdy o tom, co je hotové

Další akce podle typu změny:
- **Změna herní logiky nebo UI** → rebuild prod zip (viz níže)
- **Uploaded do Gamee admin** → push do GitHubu: `git push origin master`
- **Přidán nový level/speciality** → ověřit `GARAGE_DEFS`, `ROCKET_TARGETS`, `LEVELS` array konzistenci

## Gamee deployment

```bash
cd ~/CodeProjects/ballon-belt/gamee
rm -f ../balloon-belt-gamee.zip
zip -r ../balloon-belt-gamee.zip . -x "index_local.html" "lib/gamee-js-stub.js" "manifest.json" "sw.js" "assets/icon-*.svg" "assets/icons/*" "assets/icon-*.png" "js/.bak/*" "js/levels (1).js" "js/debug.js" "test_balloon.html" "utils/*" "*.DS_Store"
```

Upload `balloon-belt-gamee.zip` do Gamee admin (zip má `index.html` v rootu, to Gamee admin vyžaduje).

**Pozn. exclude list** (rozšířeno v75.05): manifest.json + sw.js + ikony jsou PWA-only
(install z `index_local.html`), Gamee iframe je nepoužívá. `js/.bak/` (~5 MB rotujících
záloh levels.js), `levels (1).js`, `debug.js`, `test_balloon.html` a `utils/` jsou
dev-only balast — bez exclude měl zip ~10 MB, s ním ~4 MB.

## Konvence

- **Jazyk komunikace**: česky (nikdy slovensky)
- **Commit message**: začíná `vXX: ...` (např. `v18: konsolidace do Gamee struktury`)
- **Game checksum**: `balloon-belt-vXX` — identifikuje verzi skóre v Gamee statistikách, bumpuje se s každým vydáním
- **Git režim (od 2026-07-28, viz memory collaboration-guide)**: NIKDY nepsat do `master`.
  Práce na milníkové větvi ve worktree (`git worktree add .claude/worktrees/<větev> -b <větev> master`),
  název = milník + pořadové číslo (např. `m14-stabilizace-01`), schvaluje uživatel.
  Commit průběžně; push/PR/merge jen na výslovný pokyn. Jedna dodávka = jeden PR.
- **Plan files**: `~/.claude/plans/` (historie architektonických rozhodnutí)

## Známé quirky

- Ruby WEBrick vrací HTTP 500 při servírování z `.claude/worktrees/...` (hidden path) nebo z `~/Documents/` (TCC). Proto server běží z `/tmp`.
- Gamee `beltLoop` smyčka MUSÍ startovat až ve `startLevel()` (ne v `initGame()`), jinak první frame běží na `undefined` stavových proměnných a loop umře. Fix: flag `beltLoopStarted`.
- `makeColumns` fallback přidá 2 extra nosiče na barvu když solvability check selže — opatrně s tím.
- Garáž: při použití NEsnižovat `pxCounts` před `makeColumns`, místo toho odebrat ekvivalentní nosiče z columns po generování (jinak vznikne drift pořadí a později chybí nosiče barvy).

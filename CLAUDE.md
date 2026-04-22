# Balloon Belt — orientace pro Claude

Single-screen puzzle hra (canvas + DOM) zabalená pro Gamee platformu. Vše je vanilla JS, žádný build step.

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
- HTML shell → `gamee/index.html` + `gamee/index_local.html` (udržovat oba stejné až na `src="./lib/..."` řádek)

## Dev workflow

1. Editace v `~/Documents/GitHub/ballon-belt/gamee/`
2. **Sync do /tmp** (Ruby WEBrick přes Claude Code sandbox nemá TCC přístup do `~/Documents/`):
   ```bash
   rm -rf /tmp/gamee && cp -r ~/Documents/GitHub/ballon-belt/gamee /tmp/gamee
   ```
3. Server: `preview_start` s konfigurací `Balloon Belt` (Ruby httpd na `/tmp` port 8080)
4. Browser: `http://localhost:8080/gamee/index_local.html`

Pokud Claude upraví soubor, **musí hned poté spustit sync krok (2)**, jinak prohlížeč uvidí starou verzi.

## Post-commit checklist (VŽDY po commitu bumpnout verzi)

Po každém commitu `vXX: ...` **okamžitě** zvýšit `XX` na další číslo v těchto místech:

1. `gamee/index.html` — `<title>Balloon Belt vYY</title>`
2. `gamee/index_local.html` — `<title>Balloon Belt vYY</title>`
3. `gamee/js/game.js` — checksum string `'balloon-belt-vYY'` (hledej `gamee.updateScore` + případně `balloon-belt-v`)

Další akce podle typu změny:
- **Změna herní logiky nebo UI** → rebuild prod zip (viz níže)
- **Uploaded do Gamee admin** → push do GitHubu: `git push origin master`
- **Přidán nový level/speciality** → ověřit `GARAGE_DEFS`, `ROCKET_TARGETS`, `LEVELS` array konzistenci

## Gamee deployment

```bash
cd ~/Documents/GitHub/ballon-belt/gamee
rm -f ../balloon-belt-gamee.zip
zip -r ../balloon-belt-gamee.zip . -x "index_local.html" "lib/gamee-js-stub.js"
```

Upload `balloon-belt-gamee.zip` do Gamee admin (zip má `index.html` v rootu, to Gamee admin vyžaduje).

## Konvence

- **Jazyk komunikace**: česky (nikdy slovensky)
- **Commit message**: začíná `vXX: ...` (např. `v18: konsolidace do Gamee struktury`)
- **Game checksum**: `balloon-belt-vXX` — identifikuje verzi skóre v Gamee statistikách, bumpuje se s každým vydáním
- **Git branch**: pracujeme přímo v `master`
- **Plan files**: `~/.claude/plans/` (historie architektonických rozhodnutí)

## Známé quirky

- Ruby WEBrick vrací HTTP 500 při servírování z `.claude/worktrees/...` (hidden path) nebo z `~/Documents/` (TCC). Proto server běží z `/tmp`.
- Gamee `beltLoop` smyčka MUSÍ startovat až ve `startLevel()` (ne v `initGame()`), jinak první frame běží na `undefined` stavových proměnných a loop umře. Fix: flag `beltLoopStarted`.
- `makeColumns` fallback přidá 2 extra nosiče na barvu když solvability check selže — opatrně s tím.
- Garáž: při použití NEsnižovat `pxCounts` před `makeColumns`, místo toho odebrat ekvivalentní nosiče z columns po generování (jinak vznikne drift pořadí a později chybí nosiče barvy).

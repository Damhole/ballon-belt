# Balloon Belt — Roadmap & Backlog

Single-screen puzzle hra pro Gamee platformu (vanilla JS, canvas). Hráč kliká na nosiče barevných koulí, ty padají na pás a kanón je vystřeluje na odpovídající pixely v obrazu. Hra má úroveň editoru (designer vytváří levely) i herní část (hráč hraje).

## Jak se v tom orientovat

**Na začátku každé session** přečti tento soubor → podívej se na `🚧 Aktuální sprint` → navrhni co dál.  
**Po každém commitu** `vXX:` → doplň řádek do `## ✅ Historie` + bump verze (viz CLAUDE.md).

**Prio:** P0 blokuje · P1 velký dopad · P2 polish · P3 experimentální  
**Stav:** `💡 idea` · `📋 planned` · `🚧 wip` · `✅ done`  
**Velikost:** XS <30min · S 30–90min · M ~2h · L ~4h · XL více session

---

## 🗺 Milestony — přehled

| # | Milestone | Verze | Stav | Klíčové věci |
|---|-----------|-------|------|--------------|
| M1 | Core game | v1–v21 | ✅ | Carrier grid, belt, cannon, scoring, honeycomb aktivace nosičů |
| M2 | Level editor | v22–v32 | ✅ | Editor UI, carrier layout editor, multi-variant, zdi, walls |
| M3 | Content tools | v33–v50 | ✅ | Foto import, block editor, generátory pixelů, cannon robustnost |
| M4 | AI tester | v51–v59 | ✅ | Solver hierarchy, difficulty score 0–100, heat-mapa |
| M5 | Curve editor | v60–v68 | ✅ | Křivky obtížnosti, mutation designer, simulated annealing auto-tune |
| M6 | 2.5D upgrade | v69–v70.11 | ✅ | Three.js, 3D pixely/bloky/projektily/carriers/belt, 10 témat |
| M7 | Responsive + rows | v71.x | 🚧 | Responsive scaling, 6 řad carriers, dynamic FUN.wideY |
| M8 | 3D carrier scene | v72+ | 📋 | 3D koule v carriers, 3D belt, falling animation při kliku |
| M9 | Replay & scrub | v73+ | 📋 | Curve editor Úr. 1.5 — timeline scrubber, mini canvas, .webm export |
| M10 | Editor polish | future | 💡 | Copy/paste bloků, multi-select, playtester mode, vizuální garáž |
| M11 | Gameplay | future | 💡 | Adaptivní obtížnost, procedurální levely |

---

## 🚧 Aktuální sprint — M7: Responsive + více řad (v71.x)

**Cíl:** Carriers a 3D scéna musí fungovat na všech mobilních velikostech a s více než 4 řadami.

### Co uděláme (v pořadí commitů)
1. **v71.0** ✅ — bump verze v70.11 → v71.0
2. **v71.1** ✅ — debug overlay (⚙ toggle, safe zone, markers)
3. **v71.2** ✅ — settings panel redesign: pill toggley, controls na spodek hry přes CSS order
4. **v71.3** ✅ — fix MIN_H scaling (568 phys × 460/320 = 817 css), hide #status, version badge do settings baru
5. **v71.4** — `ROW_COUNT_MAX 4 → 6` v `render3d_bottom.js`
6. **v71.5** — responsive scale: viewport meta `width=device-width`, `applyGameScale()` přes CSS `transform: scale()` na `#game`
7. **v71.6** — dynamic `FUN.wideY`: re-měřit carriers-wrap po `drawCarriers()`, volat `render3dBottom.canvasYtoFunY()`

### Otevřené po tomto sprintu
- Sizing pro <360 px (iPhone SE 320px) — test po v71.2
- Belt + funnel SVG scale podle viewportu
- Aspect ratio image area (zachovat 360×310 nebo měnit dle viewportu?)

---

## 📋 Plánováno

### M8: 3D carrier scene (v72+)

Carriers jsou teď CSS DOM boxy s `border-radius:50%` kouli. Cíl: sphere mesh per slot, při kliku koule vypadají z nosiče dolů (gravity) na pás. Belt = 3D (rollers + plane). Viz [deep dive →](#deep-dive-3d-koule-v-carriers--provizorní-3d-pás)

### M9: Replay & scrub — Curve editor Úr. 1.5 (v73+)

Nad existujícím Curve panelem (v63) přidat: `(c, r)` carrieru do history, pixel diff per krok, mini canvas gridy, timeline scrubber, play kontrolér, .webm export. Viz [deep dive →](#deep-dive-difficulty-curve-editor-úr-15-replay--scrub)

---

## 💡 Backlog — Editor

| Prio | Stav | Vel. | Nápad |
|------|------|------|-------|
| P1 | 💡 | S | **Copy/paste bloků** — `Cmd+C/V` bloku nebo multi-selection |
| P1 | 💡 | XS | **Duplicate level** — tlačítko, kopíruje s `-copy` suffixem |
| P1 | 💡 | S | **Multi-select bloků** — shift-click, pak šipky/Del/rotace na všech |
| P1 | 💡 | XS | **Pipette / eyedropper** — alt-click nasaje barvu v pixel editoru |
| P2 | 💡 | M | **Playtester mode** — tlačítko „Hrát tento level" v editoru, iframe bez restartu |
| P2 | 💡 | M | **Vizuální garage editor** — drag garáže na canvas místo čísla sloupce |
| P2 | 💡 | S | **Vizuální rocket-targets picker** — klikni na sloupec místo dvou čísel |
| P2 | 💡 | S | **Keyboard shortcuts HUD** — `?` zobrazí cheat sheet |
| P2 | 💡 | S | **Grid/snap helpery** — volitelný snap bloků na 3×3, pravítka |
| P3 | 💡 | M | **Export/Import JSON** jednoho levelu — sdílení mimo FSA |
| P3 | 💡 | S | **Pattern stamps** v pixel editoru — uložené stamp pixel arty |

**Follow-up po carrier layout editoru** (po praktickém použití):
- Solvability check + warning badge u variant
- Auto-generate template → uložit do gridu
- Drag-drop reorder queue v garage

---

## 💡 Backlog — Hra

| Prio | Stav | Vel. | Nápad |
|------|------|------|-------|
| P1 | 📋 | XL | **Difficulty Curve Editor Úr. 2+3** — mutation designer (Suggest na pinech), auto-tune SA (template shapes). Viz [deep dive →](#deep-dive-difficulty-curve-editor) |
| P1 | 💡 | XL | **Adaptivní obtížnost** — localStorage player history, rule-based next-level doporučovač. Viz [deep dive →](#deep-dive-adaptivní-obtížnost-podle-hráčova-progressu) |
| P2 | 💡 | XL | **Procedurální levely** — template/WFC přístup preferovaný. Viz [deep dive →](#deep-dive-level-generation--procedurální-levely) |
| P2 | 💡 | S | **Zvukové efekty** — pop, dopad projektilu, hotový level |
| P2 | 💡 | S | **Tutorial overlay** na prvním levelu — šipka + „klikni" popisek |
| P3 | 💡 | XS | **Skip animace konce levelu** — tap pro okamžitý přechod |

---

## 💡 Backlog — Infra

| Prio | Stav | Vel. | Nápad |
|------|------|------|-------|
| P3 | 💡 | M | **Nahradit rsync polling za fswatch** — CPU šetřejší |
| P3 | 💡 | S | **GitHub Actions** — auto-build zip při push, attach k release |
| P3 | 💡 | M | **Smoke test** — Puppeteer skript, ověří každý level v normálním čase |

---

## 📥 Inbox (nové nápady, neotříděno)

_Sem házej cokoliv co tě napadne. Při příští session to roztřídíme._

### 👀 Sleduj v provozu

- **Cannon vystřelí všech 40 projektilů i když je dostupných jen 20 pixelů** (v64 podezření) — `hasAnyTargetForColor(ci)` testuje zda existuje JAKÝKOLIV pixel barvy `ci` (i pod blokem), nikoli flood-fill reachable. Zbývající balls bouncují + expire. Možná správné chování (= designed). Před změnou ověřit dopad — `hasReachableTargetForColor(ci)` místo toho by mohlo rychleji zablokovat belt u uzamčených barev.

---

## ✅ Historie commitů

| Verze | Commit | Datum | Co |
|-------|--------|-------|----|
| v71.6 | `8582b30` | 2026-05-11 | Funnel půlka: pending-canvas 90→50, clip-path slope 88→44, padding 12→6, FUN.slopeEndY 88→44. Σ ~46 px |
| v71.5 | `45cbe22` | 2026-05-11 | Chrome cleanup: body margin 0, #game padding 16→8 + gap 10→6, image-area border 2→1. Σ ~48 px uvolněno pro 6. řadu carriers |
| v71.4 | `f47d735` | 2026-05-11 | Dev labely (#belt-label, #pending-label, #carriers-label) globálně `display:none` — sjednoceno z 3D-only scope, 0 px overhead v 3D bylo, 0 px i ve 2D teď |
| v71.3 | `7e1e78d` | 2026-05-11 | Fix MIN_H scaling (568 phys × 460/320 = 817 css), `#status` hidden (krade pixely), version badge přesunut do settings baru vlevo od ⚙ |
| v71.2 | `750d0f1` | 2026-05-11 | Settings panel: ⚙ button otevírá pill toggley (Level UI / Stats / Safe zone), controls a ammo-audit na spodek hry přes CSS order, layout se při togglech nehýbe |
| v71.1 | `a4290c7` | 2026-05-11 | Debug overlay: ⚙ toggle (Shift+D), min-screen 568px marker, overflow zóna, safe area, info panel, clean mode skryje controls |
| v71.0 | `ea33992` | 2026-05-11 | Version bump v70.11 → v71.0 |
| v70.11 | `ac4ea58` | 2026-05-11 | 2.5D carriers dokončeny: carrier.glb workflow, per-row InstancedMesh, pop + tilt ghost anim, pending balls spawnY clamp, canvas +80px, mobile viewport 460px |
| v70.10 | `c14cdde` | 2026-05-11 | clamp spawnY pro bottom row carriers (zachová 2×2 grid) |
| v70.9 | `5775be8` | 2026-05-11 | ghost balls fade 0.15s → 0.075s |
| v70.8 | `ee3fef1` | 2026-05-07 | frustum culling fix, R_PENDING→12, drop animace odstraněna |
| v70 batch 7 | `0e134c8` | 2026-05-07 | drop animation + dynamic Y-offset via getBoundingClientRect |
| v70 batch 6 | `f0411c9` | 2026-05-07 | render3d_bottom.js — 3D belt + pending + carrier balls |
| v70 batch 5 | `4957e73` | 2026-05-07 | pixel destruction efekty (shatter/collapse/combo) |
| v70 batch 4 | `eed1941` | 2026-05-07 | trychtýř funnel shape + carriers polish + theme system 10 variant |
| v70 batch 3 | `eed1941` | 2026-05-07 | témata 10 variant + UI switcher + inset panely |
| v70 batch 2 | `5850714` | 2026-05-07 | 3D bloky + 3D projektily + 6 style presets |
| v70 batch 1 | `d2f76d1` | 2026-05-07 | Three.js scaffolding + 3D pixely (M6 start) |
| v69 | `7c24b81` | 2026-04-30 | Auto-tune target difficulty + SA math relax |
| v68 | `3e566c0` | 2026-04-29 | Unified „Analyze & Tune" master panel + UI úklid |
| v67 | `b21a258` | 2026-04-28 | Curve editor Úr. 3a — Auto-tune + SA + live monitor |
| v66 | `d6a4863` | 2026-04-28 | Curve editor Úr. 2 — Mutation Designer + Suggest |
| v65 | `5d41ab8` | 2026-04-28 | Projectile distribution target 40 per carrier |
| v64 | `0375f24` | 2026-04-28 | Tester accuracy + replay panel + generator tuning |
| v63 | `154a95f` | 2026-04-27 | Curve editor Úr. 1 — 4 křivky, piny, persistence |
| v62 | `cd0f1dd` | 2026-04-27 | Garáže — accessibility check + zničitelná toggle |
| v60 | `be1d5b1` | 2026-04-27 | Editor UX — full-width canvas, column slider, drag&drop, rotace bloků |
| v59 | `27673e5` | 2026-04-26 | AI tester Phase 1+2+3 — solver hierarchy, difficulty score, heat-mapa |
| v57 | `17107f6` | 2026-04-26 | Editor viewport-lock — body 100vh, panely scrollují samostatně |
| v55 | `3b12bf0` | 2026-04-26 | FPS counter + per-frame profiler + cache dispatch 133ms→1ms |
| v54 | `cc799bc` | 2026-04-26 | Editor sync hardening + state cleanup |
| v53 | `3ad89e3` | 2026-04-26 | Block resize handles + generator overhaul |
| v51 | `4479840` | 2026-04-26 | Editor UI cleanup — 3 collapsible sekce |
| v50 | `25e1823` | 2026-04-26 | Bouncing-aware simulateShotReaches (cap 4 odrazy) |
| v49 | `d69bf60` | 2026-04-25 | Cannon dispatch refactor — strict belt-feed, force-fire fallback |
| v44 | `15cf547` | 2026-04-24 | Generátor XOR režim Pixely/Bloky |
| v39 | `af45bd8` | 2026-04-24 | Generátor levelů — 7 pixel stylů |
| v35 | `bceec76` | 2026-04-24 | 64-barevná master paleta + per-level activePalette |
| v33 | `8104f41` | 2026-04-24 | 📷 Import foto do pixel editoru (crop+zoom, kvantizace, dithering) |
| v32 | `abf5603` | 2026-04-23 | Level status ikona |
| v26 | `a1f9e0a` | 2026-04-23 | Carrier layout editor fáze 1–3 |
| v25 | `a71517c` | 2026-04-23 | Block editor + pixel editor + undo/redo |
| v23 | `79190b3` | 2026-04-23 | Editor pro správu levelů + live iframe preview |
| v22 | `4014b5f` | 2026-04-23 | Modulární level systém + dvouosá obtížnost |
| v21 | `a33ca23` | 2026-04-23 | Honeycomb aktivace nosičů, hard levely |

_(starší v `git log --oneline`)_

---

## 📖 Deep dives — detailní specifikace

<details>
<summary><strong>M8: 3D koule v carriers + provizorní 3D pás</strong></summary>

**Kontext:** 2.5D upgrade má hotové 3D pixely, bloky, projektily, destruction efekty, témata. Carriers jsou CSS DOM (4 balls v gridu) a belt je SVG. Cíl: plně 3D.

**Carriers:** sphere mesh per slot. Při kliku koule vypadají z nosiče dolů (gravity-driven 3D animace) a přistávají na pásu.
- `state.carrierBallMesh` InstancedMesh nebo per-slot sphere instances
- Carriers DOM zůstává pro layout/clicks, jen vizuál balls přejde do 3D
- Falling: drop s gravitou + roll sideways na belt pozici
- Challenge: carriers jsou v DOM → overlay 3D canvas NEBO přesunout carriers do Three.js

**Belt:** 3D mesh — 2× CylinderGeometry (rollers) + connecting plane. UV-scroll texture nebo kinematic plane. Balls scrollují zleva doprava v sync s `belt[]` array v game.js.

**Otevřené otázky:**
- Click handling v 3D: raycaster, nebo DOM carriers zůstanou jako hit-area?
- Ball physics: Cannon.js mini, nebo kinematic (interpolate position)?
- Canvas: existující bottom3d nebo nový?

**Předpoklady:** Tohle je pre-cannon work. Až user dodá `cannon.glb`, integrujeme do unified 3D scény.

</details>

<details>
<summary><strong>M9: Curve editor Úr. 1.5 — Replay & Scrub</strong></summary>

**Kontext:** Úroveň 1 hotová (v63): 4 křivky + piny + tooltip. Chybí: vidět CO solver klikl a JAK grid vypadal v daném kroku.

**Co přidat do testeru (game.js):**
- `(c, r)` carrieru klik per krok do `history.push` (3 call sites, ~15 min, XS)
- Pixel diff per krok — `clearedPixels: [{x,y,color}]` v `_ptSimulateClick` (S, 60 min)

**UI — timeline scrubber + mini gridy + play kontrolér:**
```
┌─ Replay  step 12 / 24 ──────────────────────────────────
│  Carrier grid (mini)         Image grid (mini)
│  ┌──────────────┐            ┌──────────────────────┐
│  │ . . ✸ . .   │ ← klik(3,1)│ ░░░▓▓▓▓░░░           │
│  │ . . ⊙ . .   │            │ ░░▓▓▓░▓▓▓░░ ← ✦ právě│
│  └──────────────┘            └──────────────────────┘
│  [⏮][◀][▶][⏭]  0.5× 1× 2×  [⬇ .webm]
│  ├─●─●──●──●─●●●●●●●─●●─●──●──●─●─┤
│  0    5   10  ↑12   15   20   24
└──────────────────────────────────────────────────────────
```

**Velikost práce:** ~5–6 h celkem (7 kroků XS–M, vanilla JS, nové dependencies žádné)

| Krok | Co | Vel. |
|------|----|------|
| #1 | `(c, r)` v history (3 push call sites) | XS |
| #2 | Pixel diff v `_ptSimulateClick` | S |
| #3 | Replay state machine (currentStep, isPlaying, speed) | S |
| #4 | Mini canvas renderery (carrier grid + image grid) | M |
| #5 | Timeline scrubber UI | S |
| #6 | Play kontrolér (rAF loop) + sync s curve hover | S |
| #7 | Export .webm (MediaRecorder) | XS |

</details>

<details>
<summary><strong>Difficulty Curve Editor — Úr. 2+3 (Mutation Designer + Auto-tune)</strong></summary>

**Předpoklady:** Úroveň 1 hotová (v63). Infrastruktura mutation pool sdílená pro Úr. 2 i 3.

**Úroveň 2 — Mutation Designer (L, ~5 h):**
Designer má pin s tagem → stiskne `⚙ Suggest` → systém zkusí 50 mutací v pinnutém rozsahu kroků → vrátí top 3 kandidáty (popis + diff metrik + mini-overlay křivky). `▷ Preview` / `✓ Apply`.

**8 atomických mutací:** SWAP_CELLS · TOGGLE_HIDDEN · MOVE_GARAGE · REORDER_GARAGE_QUEUE · INSERT_WALL · REMOVE_WALL · ADD_ROCKET · SWAP_COLORS

**Úroveň 3 — Auto-tune SA (XL, ~10 h):**
Designer vybere shape template (FLAT / WARMUP-CLIMAX-COOLDOWN / STAIRCASE / EARLY HOOK / ENDGAME PUZZLE / DOUBLE PEAK / CUSTOM drag handles) → `▶ AUTO-TUNE` → simulated annealing (T=1.0, cooling 0.997) → live monitor křivky → Apply all / Try again.

**Compute:** 30s budget × 100ms/simulace ≈ 250 iterací. `shapeMatchScore` = vážená L2 distance normalizovaných křivek.

</details>

<details>
<summary><strong>Adaptivní obtížnost podle hráčova progressu</strong></summary>

**Co potřebujeme:** Instrumentace hráče (localStorage: čas, zbývající nosiče, restarty) → skill profile (rolovací průměr 5 levelů) → next-level doporučovač.

**MVP: rule-based** — pevné thresholdy, bez API. Pokud ≥3 nosiče zbylé za ≤30s → o stupeň těžší; 3× restart → o stupeň lehčí.

**+1: LLM call** — JSON profil → Claude API → `{level, difficulty, rationale}`.

**Otevřené:** Gamee platforma dovoluje persistovat player state? Backend pro API klíč?

</details>

<details>
<summary><strong>Level generation / procedurální levely</strong></summary>

**Tři přístupy:**

**(a) Čistě náhodné (S)** — pro endless mode, ne pro main progresi. Levely působí stejně.

**(b) Template/WFC (XL, doporučeno)** — 20–30 ručních kostrů, algoritmus doplní barvy/bloky. Nejlepší poměr kvalita/úsilí v puzzle žánru.

**(c) LLM pixel art (M, experimentální)** — Claude generuje 36×27 pixel art. Wow faktor, ale nepřesné + solvability nezaručena. Spíš jako demo feature.

**Doporučení:** začít s (b) template-based.

</details>

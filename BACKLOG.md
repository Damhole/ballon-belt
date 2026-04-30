# Balloon Belt — Backlog

Seznam všech nápadů, co chceme vyzkoušet, s prioritou a stavem. Na začátku každé session se na tenhle dokument koukneme a společně vybereme „další okruh".

## Jak se v tom orientovat

**Priorita** (ortogonální k obtížnosti implementace):
- **P0** — musíme, blokuje něco jiného
- **P1** — měli bychom, velký UX/gameplay dopad
- **P2** — nice-to-have, polish
- **P3** — experimentální, možná někdy

**Stav**:
- `💡 idea` — nápad, ještě neupřesněno
- `📋 planned` — sepsaný plán v `~/.claude/plans/` nebo v komentáři níže
- `🚧 wip` — právě se na tom pracuje
- `✅ done` — odkaz na commit

**Velikost** (hrubý odhad):
- `XS` do 30 min
- `S` 30–90 min
- `M` půl session (~2 h)
- `L` jedna session (~4 h)
- `XL` víc session, nutný plán

Úkol vytáhneme přetažením do sekce `## 🚧 Aktuální okruh` dole. Po dokončení přesuneme do `## ✅ Hotovo` s odkazem na commit.

---

## Editor levelů

| Prio | Stav | Velikost | Nápad |
|------|------|----------|-------|
| P1 | ✅ done | L | **Carrier layout editor** — drag-drop grid nosičů/zdí/speciálů, multi-variant × per-difficulty, pin na default complexity, status ikona. Commits `a1f9e0a` → `abf5603` (v26–v32). |
| P1 | 💡 idea | S | **Copy/paste bloků** — `Cmd+C` / `Cmd+V` vybraného bloku nebo multi-selection |
| P1 | 💡 idea | XS | **Duplicate level** — tlačítko v listě, kopíruje s `-copy` suffixem |
| P1 | 💡 idea | S | **Multi-select bloků** — shift-click, pak šipky/Del/rotace na všech najednou |
| P1 | 💡 idea | XS | **Pipette / eyedropper** v pixel editoru — alt-click nasaje barvu |
| P2 | 💡 idea | S | **Keyboard shortcuts HUD** — `?` zobrazí cheat sheet |
| P2 | 💡 idea | M | **Playtester mode** — tlačítko „Hrát tento level" v editoru, interaktivní iframe bez restartu |
| P2 | 💡 idea | M | **Vizuální garage editor** — drag garáže na canvas místo čísla sloupce |
| P2 | 💡 idea | S | **Vizuální rocket-targets picker** — místo dvou čísel klikni na sloupec |
| P2 | 💡 idea | S | **Grid/snap helpery** — volitelný snap bloku na 3×3, pravítka na okrajích |
| P2 | ✅ done | M | **Foto → pixel art import** — tlačítko v pixel toolbaru, crop+pan+zoom modal, kvantizace na herní paletu + Floyd–Steinberg dithering. Commit `8104f41` (v33). |
| P2 | ✅ done | XL | **AI level tester** — Phase 1+2+3 hotovo (v59): 3-tier solver hierarchy (random/heuristik/beam), belt-queue model, waste-aware beam, funnel friction, SOLVED_TOLERANCE_PX=40, 6-faktor difficulty score, 6 labels, verdict chips, per-color cleared/stuckPx, SVG trace chart, heat-mapa. Phase 4 (LLM analýza obrazu + recommendations) v inboxu. |
| P1 | 📋 planned | XL | **Difficulty Curve Editor** — propojení testeru + generátoru. 3 úrovně: (1) curve panel (4 normalizované křivky choice/pressure/progress/solver-gap z trace), (2) mutace návrhář (designer pinem označí rozsah kroků + tag, system vrátí top 3 atomické mutace ze 50 zkoušených), (3) curve template + auto-tune (simulated annealing nad mutation poolem k cílové shape). Bez AI, čistě algoritmicky. Deep dive ↓. |
| P3 | 💡 idea | M | **Export/Import JSON** jednoho levelu — sdílení mezi větvemi/lidmi mimo FSA |
| P3 | 💡 idea | S | **Pattern stamps** v pixel editoru — uložené „stamp" pixel arty (koule, srdce, hvězda) |

## Hra — mechaniky

| Prio | Stav | Velikost | Nápad |
|------|------|----------|-------|
| P1 | ✅ done | L | **Honeycomb nosiče** — prokopávání gridu, ortogonální sousedi, zamčená garáž. Commit `a33ca23` (v21). Plan: `~/.claude/plans/nice-a-ted-bychom-fizzy-mitten.md` |
| P1 | 💡 idea | XL | **Adaptivní obtížnost podle hráčova progressu** — ukládat historii hráče (čas per level, počet neúspěchů, zbývající nosiče), po každém dokončeném levelu algoritmus/LLM doporučí obtížnost dalšího. Klíčové design otázky níže ⬇ |
| P2 | 💡 idea | L | **Level generation / procedurální levely** — tři varianty k diskuzi: (a) čistě náhodné, (b) template-based / WaveFunctionCollapse s ručně připravenými „kostrami", (c) LLM-generované pixel arty + layout. Detailní srovnání níže ⬇ |

### Deep dive: Carrier layout editor

**Proč:** Dnes se grid nosičů (7 sloupců × N řad, kde `COLS=7, MAX_ROWS=7`) generuje
automaticky v `makeColumns` podle `pxCounts` z obrazu + obtížnosti. Ruční level
designer ani budoucí procgen nemají jak zafixovat konkrétní uspořádání.

**Zdi už v hře jsou** — sentinel `{wall:true}` v `game.js` existuje, používá se
v honeycomb aktivaci jako blocker (pasivní dlaždice, nic nedělá, brání aktivaci
sousedů). Editor ji jen neumí umístit. Tedy to NENÍ nová herní mechanika — je to
pouze nový UI affordance.

**Co to umí:**
1. **Grid editor v editoru** — vedle block editoru další canvas 7×N buněk. Paleta:
   nosič (s výběrem barvy), garáž (s queue), raketa, zeď, „empty" (null).
2. **Drag-drop z palety na grid** — stejný UX jako block editor (Phase A). Kliknutím na
   buňku se otevře sidebar s propertami (barva nosiče, queue garáže, …).
3. **Více variant per level** — `level.carrierLayouts: [{name, grid}, …]`. Přepínač
   v editoru (stepper „výchozí" / „sparse-bottom" / …). Tlačítko „+ varianta" duplikuje
   aktuální, přejmenuje. Tlačítko „🗑" smaže.
4. **Extensibilní tile type** — každá buňka je diskriminovaný union:
   `{type: 'carrier', color: 0}`, `{type: 'wall'}`, `{type: 'garage', queue: [...]}`, …
   Přidání nové jednotky v budoucnu = nový `type` + handler, nic se nelámá.

**Co to znamená pro hru (game.js):**
- `makeColumns` dostane novou větev: pokud `level.carrierLayouts` existuje a má
  `activeLayout`, použije uložený layout místo auto-generace. Levely bez layoutu
  (včetně budoucí procgen) poběží jako dnes.
- **Zdi** — žádná nová game-side práce. Sentinel `{wall:true}` už `makeColumns`,
  honeycomb aktivace a BFS solvability znají; editor bude jen ukládat `{type:'wall'}`
  do layoutu a generátor je přemapuje na herní sentinel.
- **Solvability check** — po uložení layoutu ověřit, že `pxCounts` jsou pokryté
  (dostatek nosičů správných barev + honeycomb dosažitelnost z top row). Pokud ne,
  červený badge „varianta nesolvable" v UI. Nebude blokovat publish (dev flexibilita),
  jen varování.

**Datový model:**
```js
level.carrierLayouts = [
  {
    name: "default",
    rows: 5,                // volitelné, jinak z délky gridu
    grid: [                 // [col][row]
      [{type:'carrier',color:0}, {type:'carrier',color:1}, null, ...],
      [{type:'wall'}, {type:'carrier',color:2}, ...],
      [...], [...], [...], [...], [...]
    ]
  },
  { name: "sparse-bottom", grid: [...] }
]
level.activeLayout = "default"  // default při startu levelu
```

**Vyřešeno (rozhodnuto s uživatelem 2026-04-23):**
- ✅ **Zdi** = pasivní `{wall:true}` dlaždice, nic nedělají. Už v hře implementované.
- ✅ **Grid** fixní 7×7 max, prázdná buňka = null.
- ✅ **Fallback** — bez `carrierLayouts` auto-generace jako dnes.
- ✅ **Per-difficulty variants** — varianta je taggovaná `{difficulty: 'easy'|'medium'|'hard'}`.
- ✅ **Random výběr** — když má level víc variant pro aktuální obtížnost, vybere se náhodně.
  Pokud pro danou obtížnost NENÍ žádná varianta, **auto-generace** vyplní chybějící
  (stejně jako dnes pro level bez layoutu).
- ✅ **Garáž queue editor** — sidebar panel, konzistence s block editorem.
- ✅ **Raketa barva per tile** — `{type:'rocket', color: 3}` přímo v dlaždici.
  `level.rocketTargets` se pro layout-based levely **ignoruje** (auto-gen levely ho dál
  používají, žádný breaking change).
- ✅ **Undo scope** — přepnutí aktivní varianty = view selector, NE undo step.
  Editace obsahu / přidání / mazání / přejmenování varianty = ano.
- ✅ **Pojmenování variant** — volný text, unikátnost per level × difficulty.
  (Default name pattern: `{levelkey}-{difficulty}-v{N}`.)

**MVP scope** — hned od začátku podpora multi-variant × per-difficulty (nemá smysl to
stavět v monolitu napůl a později přepisovat data model). Tile types: `carrier`
(s výběrem barvy), `garage` (s queue v sidebaru), `rocket` (s výběrem barvy), `wall`,
`null`. Auto-generate fallback per difficulty.

**Otevřené pro budoucí okruh (ne teď):**
- Integrace s level generation (až se to začne dělat) — generátor ukládá do
  `carrierLayouts` nebo jen flag „auto-generate"? _Pragmatický tip později: uložit,
  aby výsledek byl reprodukovatelný._

### Deep dive: Foto → pixel art import

**Proč:** Ručně kreslit 36×27 pixelů je zdlouhavé. Pokud hráč/designer chce level
„kočka" nebo „auto", je mnohem rychlejší nahrát fotku a nechat ji zpracovat než
kreslit od nuly. Funguje 100% v klientovi — žádný server, žádné API.

**Jak by to technicky fungovalo (vše vanilla JS):**
1. `<input type="file" accept="image/*">` v pixel toolbar → uživatel vybere foto/PNG/JPEG.
2. `FileReader.readAsDataURL()` → vložit do `new Image()`.
3. Nakreslit na skrytý `<canvas>` s rozlišením 36×27 (nebo aktuální rozměry levelu).
   Prohlížeč udělá bilineární scale-down zadarmo (`ctx.drawImage`).
4. `ctx.getImageData(0,0,36,27)` → pole RGBA hodnot (36×27×4 bajtů).
5. **Kvantizace na herní paletu** — pro každý pixel najít nejbližší barvu z `BALL_COLORS`
   (9 barev) pomocí Euklidovské vzdálenosti v RGB prostoru. Volitelně vážit luminance
   složku víc (lidské oko je citlivější na jas). Jednoduché, bez knihoven, ~20 řádků JS.
6. Výsledek zapsat do `lvl.image.pixels[][]` a překreslit pixel canvas.

**Volitelná vylepšení:**
- **Dithering (Floyd–Steinberg)** — rozptýlí kvantizační chybu do sousedních pixelů,
  fotky pak vypadají přirozeněji (přechody, stíny). ~40 extra řádků, velký vizuální dopad.
- **Výběr palety z obrázku (K-means)** — místo fixní herní palety extrahovat K barev z fotky
  a namapovat je na nejbližší herní barvy. Lepší výsledek u fotek s dominantními barvami.
- **Crop + zoom** náhled před potvrzením — UI preview s tlačítkem „Potvrdit" / „Zrušit".

**Proč je to možné:** Hra používá jen 9 barev, to je extrémně omezená paleta — kvantizace
funguje dobře i bez sofistikovaných algoritmů. Selfies a jednoduché fotky/ilustrace
s kontrastem budou vypadat dobře. Realistické fotky se složitými přechody potřebují
dithering pro uspokojivý výsledek.

**Scope MVP:** tlačítko „📷 Import foto" v pixel toolbaru, bez crop UI, bez ditheringu.
Jen scale + nearest-color. Pokud výsledek nevyhovuje, hráč doladí ručně.
**Scope +1:** Floyd–Steinberg dithering jako checkbox vedle tlačítka.

### Deep dive: AI level tester

**Proč:** Designér dnes musí ručně hrát každý level × každou obtížnost, aby odhadl, jestli
je správně těžký, zábavný a průchodný. S AI testerem dostane okamžitou zpětnou vazbu přímo
v editoru — bez spuštění hry, bez opakovaného hraní.

#### Co tester simuluje

Čtyři typy hráčů se spustí na aktuální layout/difficulty kombinaci:

| Hráč | Strategie | Co odhalí |
|------|-----------|-----------|
| **Optimal** | BFS/A* — nejkratší sekvence kliků | Absolutní minimum kliků k dokončení |
| **Greedy** | Vždy dostupný nosič nejpotřebnější barvy | Průměrný „rozumný" průchod |
| **Random** | Náhodný výběr z dostupných, 100× opakování | Úspěšnost bez strategie (% dokončení) |
| **Worst-case** | Vždy nejméně potřebná dostupná barva | Resilience — lze se i záměrně zaseknout? |

#### Metriky výstupu

- **Minimální kliknutí** (optimal solver)
- **Průměrná kliknutí** (greedy průchod)
- **Dead-end rate** — jak % náhodných průchodů skončí v unsolvable stavu (čím vyšší, tím
  „tricky" / riskantnější pro začátečníky)
- **Decision richness** — počet kol kde má hráč ≥2 smysluplné volby (= záživnost,
  více = zajímavější; příliš málo = level je „railroaded")
- **Bottleneck color** — barva s nejdelší honeycomb cestou (= ta která hráče zdržuje nejvíc)
- **Garage utilization** — % potřebných míčků pokrytých garáží (0 % = garáž je zbytečná
  dekorace; >60 % = hráč na garáži závisí)
- **Rocket impact** — o kolik kliků zkrátí optimal path použití raket (0 = rakety
  k ničemu; záporné = rakety jsou nutné)
- **Difficulty score 0–100** — složená metrika kalibrovaná na existující levely; cíl:
  easy ≈ 20–35, medium ≈ 45–60, hard ≈ 70–90

#### LLM vrstva — doporučení v přirozené češtině

JSON levelu + metriky se pošlou do Claude API. Odpověď = konkrétní, akční rady:

- *„Barva 3 je dostupná až po 5 odebraných nosičích — pro medium je příliš zakopána.
  Posuň jeden nosič barvy 3 do horní řady."*
- *„Garáž přispívá 0 % míčků — hráč ji celý level ignoruje. Přidej rare barvu do queue
  nebo garáž z levelu odstraň."*
- *„Dead-end rate 38 % na easy je vysoký — hráč se snadno zasekne. Posuň barvu 5
  z řady 4 do řady 1."*
- *„Tento level je o 2σ lehčí než ostatní hard levely (skóre 21, průměr hard = 74).
  Přidej vrstvu hidden nosičů nebo zeď kolem bottleneck barvy."*
- *„Decision richness = 2 (velmi nízká) — level je lineární, hráč nemá co řešit.
  Zkus přidat druhý přístupový koridor nebo zamíchej barvy v horní řadě."*

#### Vizualizace v editoru

- **Heat-mapa přes carrier grid** — overlay barevnosti: červená = nosič přístupný
  až po N+ odebraných, zelená = přístupný hned. Ukazuje „kritickou cestu" a sleepy uličky.
- **Spider chart** v panelu — srovnání aktuálního levelu s ostatními stejné obtížnosti:
  osy = difficulty score × dead-end risk × decision richness × délka × garage utilization.
  Outlier pozice = vizuální signál „tenhle level sem nepatří".

#### Automatické návrhy (opt-in)

Tlačítka v editor sidebaru (nikdy neprovádí změnu bez potvrzení):
- **„Vyváž obtížnost"** — tester navrhne swap 2–3 nosičů tak, aby difficulty score
  odpovídalo zvolenému pásmu. Designér vidí diff (před/po) a potvrdí.
- **„Udělej zajímavější"** — zvýší decision richness: navrhne přidání zdi nebo přeskupení
  vzácných barev tak, aby vznikly 2 alternativní cesty.
- **„Najdi dead-ends"** — zvýrazní v gridu nosič/y jejichž odebrání nejčastěji vede
  k zaseknutí (worst-case analýza).

#### Technická realizace

Dvě oddělené fáze, fáze 1 dává hodnotu i bez API:

**Fáze 1 — Algoritmus (vanilla JS, bez backendu):**
- BFS optimal solver (rozšíření existujícího solvability checku v `makeColumns`)
- Greedy + random simulace (stav = klon `columns[][]`, iterativní)
- Výpočet všech metrik lokálně v editoru
- Zobrazení v info panelu vedle carrier grid editoru
- Scope: **M, ~3 h**

**Fáze 2 — LLM doporučení (Claude API, potřebuje backend/proxy):**
- Metriky z fáze 1 + level JSON → HTTP POST na proxy → Claude API → JSON doporučení
- Proxy = jednoduchý Python server nebo Cloudflare Worker (API klíč nesmí do klient JS)
- Zobrazení jako „Zpráva testera" panel v editoru s konkrétními radami
- Scope: **L, ~4 h** (+ infrastruktura backendu)

**Fáze 3 — Vizualizace (navazuje na fázi 1):**
- Heat-mapa = canvas overlay přes carrier grid, počítá se z BFS vzdáleností
- Spider chart = SVG/canvas v sidebaru, normalizovaný na existující levely
- Scope: **M, ~2 h**

**Otevřené otázky:**
- Backend na fázi 2: server.py rozšíření (lokálně), nebo Cloudflare Worker (sdílené)?
- Kalibrační set pro difficulty score: použít existující levely jako ground truth
  (easy=1–5, medium=6–10, hard=11–14)?
- Má tester běžet automaticky po každé editaci (live), nebo jen na tlačítko „Analyzovat"?
  Live = příjemné, ale BFS na 7×7 je O(N!) v worst case; tlačítko = explicitní.
- Má tester vidět i pixel art (obraz) a navrhovat úpravy konzistence barev v obraze
  vs. počtu nosičů? (Pokud obraz má 40 % modré ale nosičů modré je jen 5 % → disproperce.)

**MVP scope:** Fáze 1 (algoritmus) — tlačítko „Analyzovat" v carrier editoru, výstup:
minimální kliknutí, difficulty score, dead-end rate, bottleneck color, garage/rocket utilization.
Žádný LLM, žádná heat-mapa. Jen čísla v panelu.

### Deep dive: Difficulty Curve Editor

**Proč je to zajímavé:** Tester v59 vrací jen agregované metriky (difficulty score 0–100,
verdict chip). Designer ale chce vědět **kdy** během levelu se obtížnost láme — jestli
je level moc lehký první 1/3 a moc těžký poslední 1/3, nebo má plochou křivku, nebo
spike v polovině. Tester už `trace[]` zaznamenává per-step (`activeCount, beneficial,
pickedGain, beltLoad, remainingPx`) — máme všechna data pro shape-aware tuning.
Cíl: dát designeru nástroj, který data **zobrazí jako křivku** a pak nabídne **algoritmické
mutace** layoutu k tvarování křivky podle záměru.

#### Vstupní data (z testeru, dnes existující)

Per-step `trace[]` z `ptRunGreedy` / `ptRunBeamSearch`:
- `step`, `activeCount` (kolik nosičů aktivních)
- `beneficial` (z toho kolik dává smysl — match s pixely)
- `pickedGain` (px vyčištěno tímto krokem), `pickedProj` (vystřelených projektilů)
- `beltLoad` (zaplnění pásu), `remainingPx` (zbývá celkem)

Summary: `decisionRichness, bottleneckColor, peakBeltLoad, beltOverflow, funnelRejectedCount,
per-color {cleared, stuckPx}, remainingGrid` (heat-mapa).

#### Odvozené křivky (4 dimenze)

1. **Choice curve** = `beneficial / activeCount` per step → šíře smysluplného rozhodování
2. **Pressure curve** = `beltLoad / BELT_CAP` per step → tlak pásu
3. **Progress curve** = `pickedGain / remainingPx` per step → tempo úklidu
4. **Solver gap curve** = kolik z 3 strategií (random/heuristik/beam) zvládá až do daného
   kroku → kde se začínají rozcházet = tam jsou tricky rozhodnutí

#### Úroveň 1 — Curve panel (M, ~3 h)

- 4 SVG grafy pod existujícím Analyzátor blokem, x = kroky 0–N, y = normalizované 0–1
- Per-step tooltip (krok, active, beneficial, gain, belt, remain)
- Shift-klik → přidá pin (rozsah kroků + tag z palety: `harder` / `easier` /
  `more decisions` / `less decisions` / `less belt pressure` + volný text note)
- Piny se ukládají do `lvl.curveAnnotations: [{stepRange, tag, note}]`
- Žádné automatické změny — designer jen vidí shape + dělá poznámky

**Hodnota i samostatně:** dnes tester říká "skóre 47", curve panel řekne *"krok
6–12 je flat choice = 0.3, ale pak skok na 0.9 v krocích 13–18"*. Designer ví,
co se s levelem děje.

#### Úroveň 2 — Mutace návrhář (L, ~5 h)

Předpokládá Úroveň 1 + společnou **mutation pool** infrastrukturu (sdílí s Úr. 3).

**Workflow:**
1. Designer má pin (z Úr. 1) s tagem `harder` v rozsahu 6–12
2. Stiskne `⚙ Suggest` → spustí 50 mutací zaměřených na buňky aktivní v daném
   step rozsahu (z `history[step].active`)
3. UI vrátí **top 3 kandidáty** seřazené podle shape match score:
   - Popis mutace (1–2 atomické změny)
   - Diff metrik (clicks, peak choice, belt risk, difficulty score)
   - Mini-overlay křivky (current vs proposed)
4. `▷ Preview` overlayne křivku nad stávající, `✓ Apply` zapíše do layoutu
5. Apply prochází `clRepairUnreachable` + `clRepairPostGarageUnreachable` validací

**Mutation pool (8 atomických typů):**
- `SWAP_CELLS(a, b)` — prohození 2 buněk
- `TOGGLE_HIDDEN(cell)` — `?` flag toggle
- `MOVE_GARAGE(from, to)` — přesun garáže o 1 buňku
- `REORDER_GARAGE_QUEUE(garage)` — permutace queue
- `INSERT_WALL(cell)` / `REMOVE_WALL(cell)`
- `ADD_ROCKET(cell, color)` / `REMOVE_ROCKET(cell)`
- `SWAP_COLORS(a, b)` — jen výměna barev (zachová pozice)

**Compute:** 50× `ptRunGreedy('max-gain')` heuristik ≈ 250 ms. Realtime feel.

**Klíč:** mapování krok → buňka v gridu. Tester zaznamenává `act[]` per step,
takže můžeme cílit mutace jen na carriers potenciálně aktivní v pinned rozsahu
+ jejich ortogonální sousedi. Tím zkracujeme search space z O(N²) na O(K²),
kde K je velikost lokální oblasti.

#### Úroveň 3 — Curve template + auto-tune (XL, ~10 h)

Předpokládá Úroveň 1 + 2.

**Workflow:**
1. Designer vybere shape z **template galerie**:
   - `FLAT` — konstantní obtížnost
   - `WARMUP-CLIMAX-COOLDOWN` — `╱─╲` křivka
   - `STAIRCASE` — postupný nárůst
   - `EARLY HOOK` — strmý začátek, plateau
   - `ENDGAME PUZZLE` — easy → spike na konci
   - `DOUBLE PEAK` — `╱╲╱╲`
   - `CUSTOM` — drag handle body do své shape
2. Apply target: `CHOICE` / `PRESSURE` / `PROGRESS` / `ALL` (weighted)
3. Intensity slider (mild ↔ aggressive — kolik mutací max akceptovat)
4. Time budget (10 s / 30 s / 2 min / 10 min)
5. `▶ AUTO-TUNE` spustí simulated annealing nad mutation poolem
6. Live monitor: target curve | current best curve | delta | accepted mutations log
7. Po doběhnutí: final summary + diff grid (před/po) + `Apply all` / `Try again` / `Discard`

**Algoritmus (simulated annealing, vanilla JS):**
```
T = 1.0
while elapsed < budget:
  mutation = pickRandomMutation(weighted)
  candidate = repair(apply(current, mutation))
  score = shapeMatchScore(simulate(candidate).trace, target)
  delta = score - bestScore
  accept = delta < 0 || random() < exp(-delta / T)
  if accept: current = candidate; emit(...)
  T *= 0.997  // pomalé chladnutí
return best
```

**Compute:** 30 s budget × 100 ms na simulaci = ~250 iterací. Heuristik (ne beam)
pro fitness, beam jen 1× na konci pro confirmation.

**Klíčová metrika `shapeMatchScore`:** vážená L2 distance mezi normalizovanými
křivkami. DTW (dynamic time warping) ne — trace mají často podobnou délku, L2 stačí.

#### Sdílená infrastruktura (úroveň 2 + 3)

- `mutationPool` — 8 atomických mutací s factory funkcemi
- `applyMutation(layout, mutation) → layout` (immutable, vrací kopii)
- `repairLayout(layout) → layout` (volá existující `clRepairUnreachable` + post-garage)
- `simulateLayout(layout) → trace` (wrapper nad `ptRunGreedy('max-gain')`)
- `shapeMatchScore(trace, targetCurve) → number` (L2 distance, váhovaná dimenze)
- `pickRandomMutation(layout, opts: {focusRegion, weights})` — váhovaný výběr,
  volitelně omezený na region (pro Úr. 2)

#### Riziko & otevřené otázky

- **Krok ↔ buňka mapping:** tester dnes zaznamenává `act[]` per step? Ověřit, jinak
  doplnit do trace (low-cost change v `ptRunGreedy`).
- **Repair pipeline kompletnost:** po atomické mutaci může vzniknout layout, který
  fail-uje silně — Úr. 2 musí umět *odmítnout* mutaci, ne jen repair. Threshold:
  pokud repair otevře >3 walls, mutaci dropnout.
- **Overfitting v Úr. 3:** SA může konvergovat ke křivce, ale level je nehratelný
  (např. všechny mutace toggle hidden = level je samé `?`). Mitigation: zachovat
  validaci `decisionRichness > 1.5` jako hard constraint v fitness.
- **UI density:** 4 grafy + piny + suggest panel je hodně. Možná tabové view
  (Choice / Pressure / Progress / Solver Gap) místo side-by-side.

#### Pořadí implementace (návrh)

1. **Úr. 1** — vykreslit křivky z trace, pin UI, persistence (1–2 dny)
2. **Mutation pool + repair pipeline** — sdílený pro 2 i 3 (1 den)
3. **Úr. 2** — pin → suggest → top 3 → apply (3–5 dní)
4. **Úr. 3** — template galerie + SA + monitor (5–10 dní)

Mezi 2 a 3 je rozdíl hlavně v **search strategy** (random sampling vs SA) a **UI**.
Compute backend je z 80 % sdílený.

**MVP scope (Úr. 1):** 4 SVG křivky pod Analyzátor blokem, per-step tooltip,
shift-klik pro piny, persistence v `lvl.curveAnnotations`. Žádné mutace, žádné
auto-tune. Jen vidět shape + anotovat.

#### Doplnění Úr. 1: Replay & Scrub (Úr. 1.5)

Designer chce nejen vidět *graf* obtížnosti, ale i *konkrétní moment v gridu* — co
solver v daném kroku klikl + jak vypadal grid + jak ubývaly pixely. Hover step
v křivce → mini canvas vykreslí stav v ten okamžik. Plus timeline scrubber:
designer může táhnout přes celý průchod a sledovat replay.

**Co dnes chybí v testeru pro plný replay:**

| Datum | Stav | Co s tím |
|-------|------|----------|
| `(c, r)` carrieru klik per krok | ❌ history má jen `color` | Přidat 2 čísla do `history.push` (game.js:2360, 2427, 2562). Náklad: ~50 čísel per run. |
| Pixel diff per krok (které pixely mizí v grid) | ❌ jen finální `remainingGrid` | V `_ptSimulateClick` shromáždit `clearedPixels: [{x, y, color}]` a vrátit ven. Náklad: 5–20 záznamů per krok ≈ pár KB. |
| Initial grid snapshot pro reconstrukci | ✅ máme `_ptInitGrid` | Stačí poslat 1× při Analyzovat. |

S tím trojím má editor vše pro reconstrukci stavu v každém kroku:
`gridAt(step) = initGrid + sum(clearedPixels[0..step])`.

**UI: timeline scrubber + mini gridy + play kontrolér**

```
┌─ Replay  step 12 / 24 ─────────────────────────────────────────
│
│   Carrier grid (mini)              Image grid (mini)
│   ┌──────────────────┐              ┌──────────────────────┐
│   │ . . ✸ . .        │  ← klik (3,1)│ ░░░▓▓▓▓░░░           │
│   │ . . ⊙ . .        │              │ ░░▓▓▓░▓▓▓░░ ← ✦ právě│
│   │ . . . . .        │              │ ░░░░░░░░░░░  zničené │
│   └──────────────────┘              └──────────────────────┘
│
│  [⏮][◀][▶][⏭]  rychlost ●─○ 0.5×  ○ 1×  ○ 2×  [⬇ export .webm]
│
│  Timeline (drag to scrub):
│  ├─●─●──●──●─●●●●●●●─●●─●──●──●─●─┤
│  0    5    10  ↑12   15   20   24
│         (currently here)
└──────────────────────────────────────────────────────────────────
```

- **Hover step v křivce nad replay** → highlight kroku v timeline + sync mini gridů
- **Drag scrubber** → real-time scrub, mini gridy se aktualizují (snap-to-step, ~25 fps)
- **Play tlačítko** → auto-replay s rychlostí 0.5×/1×/2× (200/100/50 ms per krok)
- **Pin v křivce** koreluje s timeline: hover pin = highlight rozsahu kroků v timeline
- **Export .webm** — `MediaRecorder` API na canvas, ~5s clip, download. Zero dependencies.

**Use cases pro designera:**

1. **„Co solver v 8. kroku klikl?"** — hover step na křivce → mini grid ukáže.
2. **„Jak vypadal pás na vrcholu pressure?"** — najdi vrchol Pressure curve, scrub k němu, vidíš `beltLoad: 11/14` + grid ve 12. kroku.
3. **„Tenhle level vypadá monotónně"** → play replay → vidíš 24 kroků zpopu carrierů, většina je pop-and-clear bez zajímavé strategie. Subjektivní pocit potvrzený.
4. **Sdílení mezi designery** — export .webm, hodit do Slack: „heleď, tohle je broken — beam search se 5× zasekne na barvě 6".

**Velikost práce:**

| Krok | Co | Velikost |
|------|-----|----------|
| #1 | `(c, r)` v history (game.js, 3 push call sites) | XS, 15 min |
| #2 | Pixel diff v `_ptSimulateClick` + history field | S, 60 min |
| #3 | Replay state machine v editoru (currentStep, isPlaying, speed) | S, 60 min |
| #4 | Mini canvas renderery (carrier grid + image grid, scaled down) | M, 90 min |
| #5 | Timeline scrubber UI (range input + custom track + step markers) | S, 60 min |
| #6 | Play kontrolér (▶/⏮/⏭, rAF loop) + sync s curve hover | S, 60 min |
| #7 | Export .webm (MediaRecorder) | XS, 30 min |

**Celkem: ~5–6 h.** Bez AI, vanilla JS, žádné nové dependencies.

**Otevřené otázky:**

- **Které trace replay-ovat** — primary (beam) nebo nechat designera vybrat (3 strategie)? MVP: primary. Pokud bude potřeba, doplníme dropdown „replay strategie".
- **Persistence replay state** — žádná. Replay je „live tooling", po reload editoru se vrací default na step 0.
- **Performance scrubu** — full grid re-render @ 60 fps na 36×27 canvas s 972 px je triviální (~0.1ms). Žádný worry.
- **Belt animace?** — pro Úr. 1.5 vynechat (`beltLoad` je už jasný z curve panelu). Pokud budeš chtít, doplníme jako třetí mini canvas.

### Deep dive: Adaptivní obtížnost podle hráčova progressu

**Proč je to zajímavé:** Balloon Belt má momentálně fixní 14 levelů × 3 obtížnosti. Hráč, co
je v puzzlech silný, se nudí na snadných; začátečník se frustruje na hard. Gamee platforma
má retention metriky — adaptivní křivka = delší hra = lepší scoring.

**Co bychom potřebovali:**
1. **Instrumentace hráče** — po každém dokončeném levelu uložit do localStorage:
   - čas (ms), zbývající nosiče, kolikrát hráč restartoval, vzor kliknutí (např. moc
     pingaly do špatného cíle → „zmatek z barev").
2. **Skill profile** — rolovací průměr 5 posledních levelů, rozlišit: rychlost (čas) vs
   přesnost (zbytky) vs strategie (použití raket/garáže).
3. **Next-level doporučovač**. Dva směry:
   - **(a) Rule-based** — pevné thresholdy („pokud zbylo ≥3 nosiče za ≤30s, další o 1 stupeň
     těžší; pokud restartoval 3×, další o 1 snadnější"). Jednoduché, bez API, deterministické.
   - **(b) LLM call** — poslat 5-řádkový profil do Claude API, dostat zpět JSON
     `{level: "frog", difficulty: "hard", rationale: "hráč zvládá barevnou diskriminaci
     ale selhává na timing, dej mu frog který má méně barev ale víc raket"}`. Drahé, ale
     chytřejší v rozpoznávání vzorců.
4. **Integrace** — přepsat level-ending obrazovku tak, aby místo „další level" nabídla
   „doporučeno pro tebe" s vysvětlením. Opt-in, aby zkušený hráč mohl zvolit ručně.

**Otevřené otázky:**
- Gamee platforma dovoluje persistovat player state mezi hrami? (Jinak localStorage funguje
  per prohlížeč, hráč na jiném zařízení začíná od nuly.)
- LLM call potřebuje backend (API klíč neschováme do klient JS). Máme host?
- Kolik dat je potřeba, než doporučovač dává smysl? (MVP s rule-based funguje hned,
  LLM by potřeboval ~10+ levelů historie.)

**MVP návrh:** (a) rule-based doporučovač, lokální state, bez API. Pokud se chytne,
přidáme (b) nad ním — profil zůstává stejný, jen jiný rozhoduje.

### Deep dive: Level generation / procedurální levely

Tři přístupy, rozhodujeme se mezi kvalitou × scope × novostí:

**(a) Čistě náhodné** (S, ~2 h)
- Algoritmus: X bloků × Y pixelů náhodně rozsypat v koridoru difficulty.
- **Plus:** nejjednodušší, ověřené (`makeColumns` už má solvability check).
- **Minus:** levely působí stejně, žádná „duše". Pro puzzle hru je to málo — hráč po 3
  náhodných levelech vidí vzorec.
- **Kdy dává smysl:** jen jako endless mode mimo main progresi, ne jako náhrada ručních.

**(b) Template / WaveFunctionCollapse** (XL, ~1–2 session)
- Ruční knihovna „kostrů" (20–30 částečných layoutů — půl pixel artu, anchor body pro
  bloky). Algoritmus vybere kostru podle difficulty, doplní barvy / rozmístí bloky podle
  pravidel. WFC umí garantovat konzistenci (žádné nesousedící „díry" v obrazu).
- **Plus:** v puzzle žánru má nejlepší poměr kvalita/úsilí (Into the Breach, Mini Metro,
  roguelite dungeony toto dělají). Levely působí ručně designované, ale jsou různé.
- **Minus:** musíš nejdřív nakreslit knihovnu kostrů (čas) a naformulovat pravidla.
- **Kdy dává smysl:** když chceš replayability + nekonečný content s dobrou kvalitou.

**(c) LLM pixel art + layout** (M, ~3 h MVP; experimentální)
- Prompt Claude: „Vygeneruj 36×27 pixel art kočky, použij barvy 0-8, vrat 2D pole".
  Obdobně pro bloky.
- **Plus:** zero content authoring, téma na požádání („vygeneruj cestovní level")
- **Minus:** současné LLM (GPT-4o, Claude) kreslí pixel art nepřesně, obrázek vypadá
  „divně". Kvalita nesrovnatelná s ručně nakreslenou. Navíc solvability není garantovaná
  → potřebuješ post-processing.
- **Kdy dává smysl:** jako „wow" feature pro demo / novinku, ne jako páteř progrese.

**Moje doporučení:** začít s **(b) template-based** — v puzzle žánru to aktuálně dává
nejlepší UX. (a) nebo (c) jako doplněk. Ale prvně mít hotový (b), jinak se utopíme
v tuning hyperparametrů.

**Otevřené otázky:**
- Kolik kostrů potřebujeme? (WFC typicky 15–30 stačí pro dojem různorodosti.)
- Generátor běží runtime (při spuštění hry) nebo offline (pregenerovat 100 levelů,
  uložit jako `levels.js`)?
- Jak balancovat: generátor vyrobí → solvability check → obtížnost skóre → ok / zamítnout?

---

## Hra — polish

| Prio | Stav | Velikost | Nápad |
|------|------|----------|-------|
| P2 | 💡 idea | S | **Zvukové efekty** — poppnutí balonu, dopad projektilu, hotový level |
| P2 | 💡 idea | S | **Tutorial overlay** na prvním levelu — šipka na nosič, „klikni" popisek |
| P3 | 💡 idea | XS | **Skip animace konce levelu** — tap pro okamžitý přechod |

## Infra & dev tooling

| Prio | Stav | Velikost | Nápad |
|------|------|----------|-------|
| P3 | 💡 idea | M | **Nahradit rsync polling za fswatch** — `brew install fswatch`, CPU šetřejší. Zatím tight loop funguje. |
| P3 | 💡 idea | S | **GitHub Actions** — automaticky buildnout zip při push, attach k release |
| P3 | 💡 idea | M | **Smoke test** ve formě Puppeteer skriptu — spustí každý level, ověří že hráč dokončí v normálním čase |

---

## 📥 Inbox (nové nápady, neotříděno)

_Sem házej všechno, co tě napadne. Při příští session to společně roztřídíme do tabulek výše._

- _(prázdné — přidej cokoliv hnedka)_

### 👀 Sleduj v provozu

- **Bouncing-aware `simulateShotReaches` (v50 dev)** — simulate teď modeluje odraz od wrong-color pixelů, wrong-color bloků a non-target mystery (`BOUNCE_CAP=4`). Cannon detekuje cesty přes 1-4 odrazy. Riziko: false positives (simulate.true ale particle nedoletí) kvůli numerické divergenci vůči `±0.06 rad` spread na fire angle. **Když uvidíš, že cannon vystřelí a koule nedorazí na cíl** (zamrzne, popne se naprázdno) → snížit cap na 2-3 nebo doladit physics. Nezatím necommitováno do verze.
- **Cannon vystřelí všech 40 projektilů i když je dostupných jen 20 pixelů** (v64 podezření) — `hasAnyTargetForColor(ci)` v real-game cannon dispatch (game.js:421) testuje, zda existuje **JAKÝKOLIV** pixel barvy `ci` v gridu (i pod blokem) NEBO živý blok. Tj. cannon palí všechny projektily i když jen část je reachable přes flood-fill. Zbývající balls bouncují, expire po 4 odrazech (visible: hodně balónků létá v gridu). **Možná správné chování** (= designed), ale user pozoroval ne-očekávané. Možná oprava: použít `hasReachableTargetForColor(ci)` (game.js:435) místo, který bere jen flood-fill exposed. Trade-off: ale strict reachable check by mohl rychleji zablokovat belt u uzamčených barev (real-game: cannon by tiše čekal). Před změnou ověřit dopad na existing levely.

---

## 🚧 Aktuální okruh

_(přesuň sem to, co jsme si vybrali — ať se nehádáme, co právě děláme)_

- **Difficulty Curve Editor — Úroveň 1.5 (Replay & Scrub)** — Úr. 1 hotová (v63):
  multi-curve panel + piny + crosshair tooltip. Teď přidáme: `(c, r)` carrieru +
  pixel diff per krok do testeru, mini canvas (carrier grid + image grid) pod
  křivkou, timeline scrubber, play/pause, rychlost, export .webm. Hover step
  v křivce sync s mini gridy. Deep dive: viz [Difficulty Curve Editor](#deep-dive-difficulty-curve-editor) → *Doplnění Úr. 1: Replay & Scrub*.

**Follow-up okruhy po carrier layout editoru** (až si ho zkusíme v praxi):
- Solvability check + warning badge u variant — počet slotů per barvu vs. obraz
- Auto-generate template pro layout (tlačítko „vyplň auto-gen výsledek do gridu")
- Drag-drop reorder queue v garage (dnes je jen add/remove)
- Pipette tool (Alt+klik vezme barvu z buňky) — nice parity s block editorem

---

## ✅ Hotovo

| Okruh | Commit | Datum |
|-------|--------|-------|
| v69: Auto-tune target difficulty + math relax + diff-aware fitness — UI input „Cíl obtížnosti" 0–100 v auto-tune panelu + diff badge `current/target` v progress monitoru s 🔥/❄ flagem. SA fitness rozšířen o **kvadratickou symetrickou diffPenalty** (`gap² × 0.01`) — tlačí stejně silně oběma směry (snižuje když diff > target, zvyšuje když < target). Anti-cooling guard: T se chladí jen když gap ≤ 10, mimo tento pás SA drží T=1.0 a explorát mutace. `_ptDiffProxy(r, totalPx)` cheap odhad difficulty z greedy trace (max 100, matches analyze diffScore škálu — pokrývá length/complexity/belt/solver natívně + risk/solverNeed aproximováno přes belt headroom + r.solved). complexity-tab-aware factor v `_ptSolvabilityPenalty` (easy=1.0, medium=0.3, hard=0.0) — Hard tab nyní necítí penalty za hardcore feel. Math test relaxován z `solved && remainPx===0 && remainBlockHp===0` na `carriersExhausted` — pokud carriery dojdou s ∞ pásem, level matematicky končí. Regenerate hard hidden rate 0.80 → 0.65 (80% byly nedohratelné). Bug fix: `bestImproved=true` na startu SA → první progress emit posílá baseline snapshot, live carrier canvas se nezablokuje na černé. Sync daemon hardening: stale daemon detekce a restart skript s explicitní cestou. | `7c24b81` | 2026-04-30 |
| v68: Unified „Analyze & Tune" master panel + UI úklid — sloučení tří oddělených panelů (cl-tester, cl-curves, cl-auto-tune) do jednoho master cl-analyze-tune se 3 collapsible sub-sekcemi (📊 Výsledky / 📈 Křivky / 🎯 Ladění), Ladění dostalo radio toggle Detailní (per-pin Suggest, hint + výsledky karty) ↔ Větší (template SA — současný auto-tune UI), mode preference v localStorage, Suggest btn auto-otevře Ladění + přepne na Detailní (no friction). Kapacita panel přesunut nad editor nosičů (designer kontroluje sloty hned před úpravou). Cache-busting inline loader pro editor.js (browser cachoval starou verzi přes reload(), inline `<script>` s `?v=Date.now()` vynutí fresh fetch). Žádná logic-side změna — všechny render funkce + DOM IDs zachované, jen reorganizace. | `3e566c0` | 2026-04-29 |
| v67: Difficulty Curve Editor Úr. 3a (Auto-tune Template Gallery + SA) + safety net + hidden flag UX — 6 preset target shapes (FLAT/STAIRCASE/WARMUP-CLIMAX-COOLDOWN/EARLY HOOK/ENDGAME PUZZLE/DOUBLE PEAK), ptAutoTuneAsync s simulated annealing (T=1.0, cooling 0.997, abort signal), live monitor (progress bar, target+best curve overlay, **live carrier grid canvas** snapshot při bestScore zlepšení), Apply pipeline s histPush + clRepair + auto-cleanup ineffective `?` flagů, score regression warning, stale baseline alert. SA non-destructive mode: SWAP_CELLS pool rozšířen o zdi (skutečný layout reshuffle), INSERT_WALL pouze na null tunely, TOGGLE_HIDDEN váha 0 (řeší noop=>always-accept bug). Hidden flag UX: TOGGLE_HIDDEN cílí jen na inactive cells (zrcadlí game's isCarrierActive), editor render `?` vždy z dat flag, ale ineffective dostane opacity 0.35 + dashed underline + tooltip, 🧹 manual cleanup tlačítko. Safety net: `_backupExisting` před každým autosave/publish (timestamped snapshots v editor/.bak/ + gamee/js/.bak/, rotate 20), empty-levels guard v doAutosave (nezapisovat když pole prázdné), .gitignore pro stray duplicate naming patterns. | `b21a258` | 2026-04-28 |
| v66: Difficulty Curve Editor Úr. 2 (Mutation Designer) + Far-sighted Beam (Fáze 2.5) + stricter diff scoring — ⚙ Suggest na pinech navrhuje top 3 mutace (5 typů: SWAP_CELLS/SWAP_COLORS/REMOVE_WALL/INSERT_WALL/TOGGLE_HIDDEN), tag-directed scoring (harder→choice−1+pressure+1, easier opačně, atd.), validační chips ukazující skutečný směr per dimenzi vs záměr, deduplikace, async eval s progress barem (greedy ~250 ms / beam ~10–30 s toggle v popoveru), Apply integrovaný s histPush (Cmd+Z funguje). Far-sighted beam: investiční expansion (breaksBarrier + unblocksGarage, top-K cap 6), block-kill reward (−4 per destroyed) + blockHp×0.8, _ptExposedDeltaIfBroken cascade s decay 0.7^clicksToBreak, opts.farSighted flag (default false) + bumped beamWidth 12, UI 🔭 toggle. Length projection pro nedořešené levely (doneClicks + remainPx/avgGain místo useknutých kliků), nový 🔬 Hraniční verdikt + „designer by měl ručně přehrát" hint na všech unsolved verdiktech. | `d6a4863` | 2026-04-28 |
| v65: projectile distribution — target 40 per carrier + outlier (240/4 → [40,40,40,120] místo [60,60,60,60]). Drží konzistentní 40-baseline, designer při přidání carrieru vidí 40 + posunutý outlier místo přepočtu celé řady. Underprovisioned fallback na rovnoměrný split. Editor _clBuildProjMap aproximace zrcadlí: většina 40, poslední row-major carrier = rest. | `5d41ab8` | 2026-04-28 |
| v64: tester accuracy + replay panel + generator tuning — block awareness (_ptInitBlocks, HP draining), bottom-row exposure flood-fill (varianta A) + adaptive jitter wide/narrow + burst column, dynamic garage update s dispense events, belt overflow halt, carriersExhausted = solved + bloky-aware strict/tolerance, replay & scrub panel (mini canvas + timeline + play kontrolér), editor carrier grid s projectile count, destroyable garage toggle, easy label do TYPE_META, hard generator: bottom-heavy weights + frequent v garage queue, numGar přesně podle slideru | `0375f24` | 2026-04-28 |
| v63: Difficulty Curve Editor Úr. 1 — multi-curve panel (4 normalizované křivky choice/pressure/progress/solverGap z trace), collapsibilní pod KAPACITA, 4 toggle checkboxy (multi-curve overlay), crosshair tooltip s multi-row breakdown, piny na klik (point + expand mode s drag handles), popover s tag/note, persistence per-variant (variant.curveAnnotations[]), out-of-range orphan badge s "posun na konec" | `154a95f` | 2026-04-27 |
| v62: garáže — accessibility check (clGarageBlocksCarriers + clRepairPostGarageUnreachable: simulace post-empty stavu, garáž = permanentní zeď, pre-check kandidátů + tunel-around / odstranění blokující garáže), 💥 zničitelná toggle v inspectoru (oranžový outline + badge ve hře, click → garáž zmizí, queue propadne), validator false-positive fix (preferuj game-truth projCounts z preview, fallback 2× buffer, hardcore přidán do diffs), preview variant force (?variant=NAME v URL, sync preview-diff dropdown na pinnutou complexity po loadu) | `cd0f1dd` | 2026-04-27 |
| v60: editor UX — full-width canvas + carrier grid (aspect-ratio škálování), column slider (liché 1–7, symetrický resize), drag&drop swap buněk v gridu (s undo), matematická rotace bloků (_rotateMaskCW, b.rot 0–3), L/T tetris tvar (kratší nožka), color picker jen activePalette, pinned complexity při přepnutí levelu, mystery block fix (explicit hidden:false), game.js COLS dynamic (set z layout.cols → grid se centruje dle skutečného počtu sl.) | `be1d5b1` | 2026-04-27 |
| v59: AI level tester Phase 1+2+3 — playtester panel s 3-tier solver hierarchy (random/heuristik/beam), belt-queue model (balónky cyklují místo "ztrácí"), waste-aware beam search (8 šíře, 8s budget, expansion pruning), funnel friction tracking, SOLVED_TOLERANCE_PX=40 (1 carrier worth), 6-faktor difficulty score 0–100 s expandable breakdown panel + 6 labels (Relaxing/Easy/Medium/Hard/Hardcore/⚠Broken), verdict chips (lineární puzzle / forgiving / belt overflow / broken), per-color cleared/stuckPx diagnostika, SVG trace chart pro 3 strategie + 50× random envelope s 4 toggle filtry, heat-mapa zbytkových pixelů (mini-canvas + toggle overlay přes obraz), belt overflow badge rozlišený od regular fail, snapshot pxCounts při startLevel (fix mutated block HP) | `27673e5` | 2026-04-26 |
| v57: editor viewport-lock — body/app height:100vh + overflow:hidden, panely scrollují samostatně, preview je vždy v zorném poli při scroll v Edit panelu (mobile stack ≤1100px zachován) | `17107f6` | 2026-04-26 |
| v56: FPS counter klikatelný — toggle [BB-FPS] console logů (Shift+P nefungoval kvůli DevTools autocomplete focus) | `5a7b34d` | 2026-04-26 |
| v55: FPS counter + per-frame profiler v rohu canvasu (šedá/žlutá/červená podle fps), per-frame cache pro pickCannonShot a hasAnyTargetForColor → dispatch ze 133ms na 1-2ms, fps ze 7 na 120 stable | `3b12bf0` | 2026-04-26 |
| v54: editor revize — sync hardening (auto-rename dup keys, orphan stats cleanup, sync health check), state cleanup (transient beState reset on level switch, _lastPreviewKey on rename), URL ?level priority over saveState v gamee (_levelFromUrl flag), drop indikátor při drag-reorder, overall health badge v hlavičce, section collapse persistence | `cc799bc` | 2026-04-26 |
| v53: editor — block resize handles (8 corners/edges, drag), generator overhaul (kaleido-only blocks, max-rect-extraction, mirror pairing, HP tiers 40/80/120, area-based ratio, min 4×6), banner data-driven (detekce pin bez varianty, multi-variant note, prázdná varianta) | `3ad89e3` | 2026-04-26 |
| v52: editor capacity chip — color index 0–11 ve swatch (match s cl-cell), designer hned vidí která barva je která | `3b7096f` | 2026-04-26 |
| v51: editor UI cleanup — 3 collapsible sekce (Informace/Obraz/Grid), Rockets+Garage toggles odstraněny (drag tile do gridu), paleta unifikována s pixel painterem, drag-resize panely Levels/Edit/Preview s localStorage perzistencí | `4479840` | 2026-04-26 |
| v50: bouncing-aware `simulateShotReaches` — odraz od wrong-color pixelů/bloků/non-target mystery (cap 4 odrazy), cannon detekuje cíle dosažitelné přes bounce | `25e1823` | 2026-04-26 |
| v49: cannon dispatch refactor (Option D) — strict belt-feed, ball atomic consume, force-fire fallback, pop u hlavně při zero-target, pickCannonShot aim na edge cells bloku (vyčuhující pixel detekován) | `d69bf60` | 2026-04-25 |
| v48: cannon LoS robustness + solid bloky se stínem — mystery opaque v simulate, cannonLock s LoS revalidací, partial ball consume (ppu decrement), drawBlocks bez proužků + shadow pod spodní hranu | `3fda598` | 2026-04-25 |
| v47: hasLineOfSight corner-cut — diagonální paprsek neprojde mezi dvěma blokovanými rohy, projektily už nemíří na cíle schované za štěrbinou | `0104bf3` | 2026-04-24 |
| v46: projektily — swept collision (corner-cut jen při obou blokovaných rozích) + bezpečný nudge + steerAfterBounce řídí jen když je LoS na barvu, jinak volné poletování s ±16° rozptylem | `996865a` | 2026-04-24 |
| v45: carrier layout banner — vyčistit stale fallback hlášku při editu gridu (byl zmatený ~1s gap po autosave) | `dbb8c52` | 2026-04-24 |
| v44: generátor XOR režim Pixely/Bloky — bloky z rect sekcí (flood-fill + bbox check), slider % bloků, HP 40+, rozloučení s Tetris/Grid/Mirror/Pack | `15cf547` | 2026-04-24 |
| v43: block styly Tetris/Mřížka/Zrcadlo/Scatter — oddělený výběr od pixel stylu; tetris packing seshora, grid symetrická mřížka, mirror 2/4-fold | `ee30af2` | 2026-04-24 |
| v42: bloky z pixelových regionů (flood-fill + best-fit tvar), mandala 5 sub-stylů (ring/star/flower/wave/spiral) | `3df628f` | 2026-04-24 |
| v41: generátor bloků — packing z palety tvarů (rect/L/T/cross/circle), barva z pixelu pod blokem, fix mazání při off | `74cc0f9` | 2026-04-24 |
| v40: generátor — plná randomizace všech 7 stylů (typy pruhů, střed kruhů, velikost buněk, sektory, šířka koridoru…) | `9cb7af1` | 2026-04-24 |
| v39: generátor levelů — 7 pixel stylů (Pruhy/Kruhy/Šum/Šachy/Mandala/Kaleido/Koridor), bloky, checkboxy | `af45bd8` | 2026-04-24 |
| v38: preset Pop art (primárky + cyan + magenta) | `0c44c8a` | 2026-04-24 |
| v37: foto import — fix layout (modal nepřetéká), slider max = reálný počet barev v obrazu | `50a75e3` | 2026-04-24 |
| v36: foto import Auto profil — nejlepší barvy z 64, při potvrzení zapíše activePalette, slider max dle profilu | `3de5954` | 2026-04-24 |
| v35: 64-barevná master paleta + per-level activePalette — 12 presetů, sekce Paleta v editoru, pixel editor zobrazuje jen aktivní paletu, foto import respektuje profil | `bceec76` | 2026-04-24 |
| v34: rozšíření palety na 12 barev + slider počtu barev v importu fotky | `4e60131` | 2026-04-24 |
| v33: editor — 📷 Import foto do pixel editoru (crop+zoom modal, kvantizace, dithering) | `8104f41` | 2026-04-24 |
| v32: level status ikona — ✓ done = pin + obrázek, ⚠ = chybí, ✗ = error | `abf5603` | 2026-04-23 |
| v31: default complexity pin — designer ozbačí výchozí při načtení (📍 v tabu) | `6c41fd9` | 2026-04-23 |
| v30: přejmenování na Complexity — Type badge čte `lvl.type` napřímo, img-diff pryč | `5259628` | 2026-04-23 |
| v29: fix garáž — queue carriers teď přispívají do plánovaného počtu projektilů | `c97c466` | 2026-04-23 |
| editor: generátor označí hidden carriers v hard/medium deterministicky | `f795e44` | 2026-04-23 |
| backlog: foto → pixel art import nápad + deep dive | `214fd6d` | 2026-04-23 |
| v28: UI cleanup + honeycomb editor vylepšení (walls flat, gravity v editoru) | `e580c2d` | 2026-04-23 |
| v26: carrier layout editor (fáze 1–3) — data model, grid editor, garage queue | `a1f9e0a` | 2026-04-23 |
| v25: editor — block editor, pixel editor, undo/redo | `a71517c` | 2026-04-23 |
| v23: editor pro správu levelů + live iframe preview | `79190b3` | 2026-04-23 |
| v22: modulární level systém + dvouosá obtížnost | `4014b5f` | 2026-04-23 |
| v21: honeycomb aktivace nosičů v1, progression hard levely, hard-block trychtýře | `a33ca23` | 2026-04-23 |

_(starší v git logu — `git log --oneline`)_

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
| P1 | 💡 idea | S | **Copy/paste bloků** — `Cmd+C` / `Cmd+V` vybraného bloku nebo multi-selection |
| P1 | 💡 idea | XS | **Duplicate level** — tlačítko v listě, kopíruje s `-copy` suffixem |
| P1 | 💡 idea | S | **Multi-select bloků** — shift-click, pak šipky/Del/rotace na všech najednou |
| P1 | 💡 idea | XS | **Pipette / eyedropper** v pixel editoru — alt-click nasaje barvu |
| P2 | 💡 idea | S | **Keyboard shortcuts HUD** — `?` zobrazí cheat sheet |
| P2 | 💡 idea | M | **Playtester mode** — tlačítko „Hrát tento level" v editoru, interaktivní iframe bez restartu |
| P2 | 💡 idea | M | **Vizuální garage editor** — drag garáže na canvas místo čísla sloupce |
| P2 | 💡 idea | S | **Vizuální rocket-targets picker** — místo dvou čísel klikni na sloupec |
| P2 | 💡 idea | S | **Grid/snap helpery** — volitelný snap bloku na 3×3, pravítka na okrajích |
| P3 | 💡 idea | M | **Export/Import JSON** jednoho levelu — sdílení mezi větvemi/lidmi mimo FSA |
| P3 | 💡 idea | S | **Pattern stamps** v pixel editoru — uložené „stamp" pixel arty (koule, srdce, hvězda) |

## Hra — mechaniky

| Prio | Stav | Velikost | Nápad |
|------|------|----------|-------|
| P1 | 📋 planned | L | **Honeycomb nosiče** — prokopávání gridu, ortogonální sousedi, zamčená garáž. Plan: `~/.claude/plans/nice-a-ted-bychom-fizzy-mitten.md` |
| P1 | 💡 idea | XL | **Adaptivní obtížnost podle hráčova progressu** — ukládat historii hráče (čas per level, počet neúspěchů, zbývající nosiče), po každém dokončeném levelu algoritmus/LLM doporučí obtížnost dalšího. Klíčové design otázky níže ⬇ |
| P2 | 💡 idea | L | **Level generation / procedurální levely** — tři varianty k diskuzi: (a) čistě náhodné, (b) template-based / WaveFunctionCollapse s ručně připravenými „kostrami", (c) LLM-generované pixel arty + layout. Detailní srovnání níže ⬇ |

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

---

## 🚧 Aktuální okruh

_(přesuň sem to, co jsme si vybrali — ať se nehádáme, co právě děláme)_

- _(nic aktivního)_

---

## ✅ Hotovo

| Okruh | Commit | Datum |
|-------|--------|-------|
| v25: editor — block editor, pixel editor, undo/redo | `a71517c` | 2026-04-23 |
| v23: editor pro správu levelů + live iframe preview | `79190b3` | 2026-04-22 |
| v22: modulární level systém + dvouosá obtížnost | `4014b5f` | 2026-04-20 |
| v21: honeycomb aktivace nosičů v1, progression hard levely | `a33ca23` | 2026-04-19 |

_(starší v git logu — `git log --oneline`)_

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
| P2 | 💡 idea | ? | **Level generation / procedurální levely** — _dohoda: upřesnit co přesně (fully random? template-based? difficulty-targeted?)_ |
| P3 | 💡 idea | ? | **AI před připojením** — _dohoda: upřesnit scope (AI vysvětluje hru v intro obrazovce? AI generuje level pro hráče?)_ |

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

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
| M7 | Responsive + rows | v71.0–21 | ✅ | Adaptive carriers (38–54 px), 7 řad, 3D mesh sync s 2D, iOS safe area, PWA, touch fix |
| M8 | Sjednocený 3D grid | v72.0–82 | ✅ | Carrier inner depth, 3D walls (monolith ExtrudeGeometry, rounded corners, outline), 3D mystery carriers (animovaná ? texture, circular wipe reveal), cascade pop, denial shake. Empty slot 3D + Garage/Rocket 3D + falling animation **deferred**. |
| M9 | 3D vizuál: image + BG + funnel | v73+ | 🚧 | Finální 3D vizuální polish — pixel image area depth/highlights, background atmosphere/depth, jeden trvalý tvar funnelu (FUNNEL_3D z v71.22). |
| M10 | Replay & scrub | v74+ | 📋 | Curve editor Úr. 1.5 — timeline scrubber, mini canvas, .webm export |
| M11 | Editor polish | future | 💡 | Copy/paste bloků, multi-select, playtester mode, vizuální garáž |
| M12 | Gameplay | future | 💡 | Adaptivní obtížnost, procedurální levely |
| M13 | Variable image grid | future | 💡 | Zjemnění sítě obrázku — variabilní pixel resolution, sub-pixel detail, mid-game refinement |

---

## ✅ Dokončený sprint — M7: Responsive + více řad (v71.0–21)

**Cíl:** Carriers a 3D scéna musí fungovat na všech mobilních velikostech a s více než 4 řadami. → **Splněno.**

### Hlavní výsledky
- **Adaptive carrier sizing** (CSS vars `--carrier-size/-ball-size/-row-gap`) podle viewportu — 38 → 54 px
- **7 řad** (`ROW_COUNT_MAX 4 → 7`, rowSlotIdx/rowBallIdx arrays 6→7)
- **3D mesh** responsivně škáluje k DOM cbox velikosti (`slotScale × cr.width/SLOT_SIZE`)
- **iOS safe area** (home indicator) + visualViewport (URL bar dynamics)
- **Production-equivalent sizing** — dev UI (Level UI / Stats / settings bar) se ignoruje
- **Adaptive top padding** — komfort od horní hrany když je dost místa (min(72, leftover/2))
- **Mobile touch fix** — 300ms click delay + tap highlight overlay
- **PWA setup** (manifest.json + apple-mobile-web-app-*) — Add to Home Screen = fullscreen
- **Default render** flipped 2D → 3D
- **Funnel zone** ½ shrink (pending-canvas 90→50, FUN.slopeEndY 88→44)
- **Chrome cleanup** (body margin, #game padding/gap, image border) — −48 px

### Plán → Reality
| Plán | Stav | Note |
|------|------|------|
| v71.4 ROW_COUNT 4→6 | ✅ Done lépe | Šli jsme až na 7 + adaptive size |
| v71.5 CSS scale transform | ✅ Done jinak | CSS vars + adaptive sizing místo blurry scale() — zachová pixel sharpness |
| v71.6 dynamic FUN.wideY | ⚠️ Skip | Místo toho ½ funnelu (v71.6) + FUN.slopeEndY update. FUN.h/wideY hardcoded ale balls fungují |

### Otevřené body z M7 (přesunuto)
- **Sizing pro <320 px** → polish inbox (meta viewport=460 už škáluje, nezkoušeno pod 320)
- **Image area scaling** → součást M13 (variable image grid) — schválně skipnuto v M7
- **Belt SVG scale** → already in 3D canvas (auto-followuje)

---

## 📋 Plánováno

### M8: Sjednocený 3D grid (v72.0–82 — ✅ done 2026-05-13)

**Cíl M8:** všechny grid cells jako 3D meshes pro jednotnou scénu (empty / hidden / wall / carrier inner depth).

#### ✅ Hotovo v M8 (v72.0–44)

**Carrier inner depth** (v72.0–15):
- Top face nosiče tmavší než shell přes split GLB se 2 material slots (Material.001 = inner top, Material.002 = outer shell), 2 paralelní `InstancedMesh` per row (`rowSlotMeshes` + `rowSlotInnerMeshes`).
- HSL darken v shaderu (`onBeforeCompile`) — preserve hue + saturation, reduce lightness × 0.55. Tmavomodrá zůstane modrá místo načernalá.
- Inner ghost mesh (v72.15) — synchronně s outer během fire animace, top face se nepropadne na černou při kliku.
- Ball offsets fix (v71.26/27) — base-unit `SLOT_SIZE × 0.195` × `slotScale` (no double scaling).
- R_CARRIER 12 → 11 (v71.23) — carrier balls mírně menší než pending/belt.

**Wall 3D rendering** (v72.16–20):
- Multiple primitives v `carrier.glb` (user-prepared split mesh) → grab All via `gltf.scene.traverse`.
- BFS connected components (`_findWallComponents`) — 4-directional adjacency.
- Per-component polygon via grid-coord trace (`_buildComponentPolygon`) — integer grid corners, midpoint CSS interpolation pro inside corners.
- `THREE.ExtrudeGeometry` z polygon → single mesh per component (true monolith pro L/T/+/U shapes).
- Theme color `--carriers-3d-bg` (read each call, theme-aware).

**Wall polish — concave corners, outline, silhouette** (v72.21–35):
- **Concave inside corner snap** (v72.21–22): pro count=3 vertex (3 ze 4 surrounding cells jsou walls) snap na inner cell-edge intersection místo gap midpointu → čistý 90° L/T/+ inside corner.
- **Polygon offset outline** (v72.25): `_offsetPolygonOutward` helper — každý vertex posunutý outward o `WALL_OUTLINE_PX = 1.6` po normálovém bisektoru. Místo scale (který dělal různou tloušťku na widě vs vyšším rozměru) je outline uniformní po celém obvodu.
- **Polygon dedup** (v72.26): trace končí duplikátem start-vertexu (`[A,B,C,A]`); dedup před offset jinak zero-length edge na konci → první vertex se neoffsetne (tenký šev).
- **Rounded silhouette corners** (v72.29–30): `_buildRoundedShape` — `quadraticCurveTo` na rozích s `WALL_CORNER_RADIUS = 4.5`. Wall i outline shape sdílí helper.
- **Outline barva** (v72.31): místo pure black je outline = wall color × 0.38 (lehce tmavší než nejtmavší toon band 0.47). Sjednocený s materiálem.
- **Wall lightness lift** (v72.32–34): wall color = bg color s HSL lightness + 0.02 → wall mírně vyniká z carrier-3d-bg.

**Carrier shadows** (v72.41–44, **disabled v72.44**):
- Pokus 1: per-cbox CSS box-shadow + scale-fix pro inactive carriers — měl halo artifacts.
- Pokus 2: `filter: drop-shadow()` na `#bottom3d-canvas` — generuje stín ze silhouette opaque pixelů, auto-match s 3D mesh state.
- Three.js InstancedMesh pokus 2× crashnul celý 3D render (z neznámého důvodu — slotGeom i ShapeGeometry obojí).
- Aktuálně: CSS filter rule je zakomentovaný v `game.css` jako reference, vrátíme se k tomu.

#### ✅ Hotovo v M8 — pokračování (v72.45–82)

**Mystery carriers 3D** (v72.46–61):
- 3D rounded box (slotGeom clone s custom UV 0-1) s animovanou `?` texturou (CanvasTexture, 3×3 grid tilted glyphs, diagonal scroll přes offset.x+offset.y).
- `MeshToonMaterial` s `map` → depth shading konzistentní s carriery, dark navy bg `#010206`, ? glyphy semi-transparent white se subtle stroke outline.
- Per-row `InstancedMesh` + black BackSide outline mesh.
- DOM detekce přes class `hiddenq` (slot.hidden flag je permanent, visual reveal pouze když má null souseda → active).
- 2D `?` glyph v `.cbox-hid` schovaný v 3D módu (transparent bg/border/color).

**Mystery reveal animace** (v72.62–66):
- Circular wipe — one-off `ShaderMaterial` Mesh per reveal s discard fragmentu na základě `length(vLocalPos.xy) < uRevealT * MAX_DIST`.
- Object-space XY distance místo UV → uniform wipe přes top i side faces (UV by způsobilo two-phase bug: top má 0-1, sides perimeter).
- `transparent:false + depthTest:false + depthWrite:false`, renderOrder 144 → překryje carrier balls (depthTest by jinak nechal balls prosvítat) ale pending balls (renderOrder 150) draw přes.
- Smooth edge přes `smoothstep` discard hranice.

**Cascade pop animace** (v72.67):
- Slot pops scale 0.78 → 1.15 → 1.0 over 0.30s (existing).
- Balls pop sequentially: ball 0 startuje v 0.15s (slot peak), každý další +0.05s stagger, sám pop scale 0 → 1.15 → 1.0 over 0.20s.
- Total cascade 0.55s. Pop entry žije po celou cascade duration.

**Denial shake** (v72.78–82):
- Klik na inactive/mystery (hiddenq) carrier → Y-axis rotation oscillation (dampened sin, ±0.22 rad ≈ 13°, 3.5 cyklů přes 0.32s).
- Event delegation na `#carriers-grid` — iOS Safari nedoručí click na "neviditelný" inner `.cbox`/`.cbox-hid` (transparent bg v 3D). Bubble up + `closest('.carrier')` najde target.

**Layout & responsivity polish** (v72.68–76):
- `clearCarrierState()` voláno ze `startLevel` — žádné falešné pop animace z mystery cache předchozího levelu.
- `CARR_TARGET_GAP` 6 → 4 (uspora 12 px na 7 řadách).
- `CARR_MIN_SIZE` clamp jen pokud at MIN nepřetéká usable space (fit má prioritu).
- Canvas `H` buffer +90 → +400 (worst case pro MAX_ROWS level switch — bez resize který by rozbil staticky pozicovaný belt track).
- Ghost (tilting) renderOrder 140-142 → 147-148 (nad mystery reveal 144, pod pending 150).
- `.controls` v 3D `width: --funnel-deck-w` (lícuje s deckem, theme select chevron uvnitř).

#### 📋 Deferred (přesunuto z M8 na později)

- **Empty slot 3D** (null → recessed mesh s vnitřním stínem).
- **Garage / Rocket 3D** (zatím 2D emoji — viz UX otázka, jestli vůbec stojí za to).
- **Falling animation** pro carriers (gravity → pending) — `triggerCarrierFire` ghost anim aktuálně dělá lift+tilt; pro „falling" by se rozšířilo o gravity sim.
- **Tech debt:**
  - Wall meshes recreate při každém `updateWalls()` call → caching by component hash, pokud perf issue.
  - `MAX_WALL_INSTANCES = 50` constant nevyužitý od v72.18 — k odebrání.
  - Wall edge cases (holes, disjointné komponenty, grid edge) — potřeba systematicky ověřit.

#### 📂 Kde najít kód

- `gamee/js/render3d_bottom.js`:
  - `_findWallComponents(columns)` (cca ř. 1091) — BFS
  - `_buildComponentPolygon(...)` (cca ř. 1123) — grid trace + CSS conversion
  - `updateWalls(columns)` (cca ř. 1186) — main entry, dispose + recreate
  - `_disposeWallMeshes()` (cca ř. 1172) — cleanup
  - `slotMatOuter` + `slotMatInner` setup (cca ř. 313) — carrier materials
  - HSL darken shader injection (cca ř. 320) — slotMatInner.onBeforeCompile
- `gamee/js/game.js`:
  - `drawCarriers()` (cca ř. 5713) — volá `updateCarriers` + `updateWalls`
  - `_recomputeCarrierLayout()` (cca ř. 5630) — resize handler
- `gamee/assets/3d/carrier.glb` — split mesh s 2 material slots (Material.001 = top inner, Material.002 = shell)
- `gamee/css/game.css`:
  - `body.renderer-3d .wall-block { visibility: hidden }` — 2D walls hidden v 3D mode

#### Známé quirky

- **Rounded corners na walls:** ExtrudeGeometry bevel jen rounduje top→side přechod, ne silhouette. Pro rounded silhouette corners (L/T/+) má `_buildRoundedShape` `quadraticCurveTo` per vertex. Tuning: `WALL_CORNER_RADIUS`.
- **Polygon corner positions:** outer convex + edge midpoint chování shodné s v72.20. Inside concave corners (count=3) od v72.22 snap na cell-edge průsečík missing cell = sharp 90° L/T (vs v72.20 gap midpoint = diagonal cut).
- **Ghost mesh při fire** používá `geomOuter` (outer shell), ne polygon — protože ghost je jen jeden nosič mid-animation, ne komponenta.
- **Shadow Three.js mesh experimenty crashují render:** přidání jakékoliv InstancedMesh + MeshBasicMaterial(transparent) na contentGroup způsobí ztrátu celé 3D scény. Příčina neznámá (slotGeom + ShapeGeometry obojí selhalo). CSS filter funguje, ale aktuálně disabled.

### M9: 3D vizuál — image + BG + funnel finalization (v73+) — 🚧 in progress

**Východisko (po M8):** 3D grid v bottom decku bude vizuálně konzistentní. Image area + BG ale zůstává v "hybridním" stavu z M6 — pixel-canvas (2D) + three-canvas (3D pixely) + block-overlay-canvas (HP). Plus BG je jen CSS gradient přes theme tokeny.

**Cíl M9:** dokončit celkový 3D vizuální dojem hry. Po M9 by hra měla vypadat jako jeden coherent 3D scenérie shora dolů.

#### ✅ Hotovo v M9 (v73.1–50)

**Image-area 3D frame** (v73.1–22):
- `_buildImageFrameGeom()` — outer rounded rect + inner hole přes `THREE.Shape.holes`, ExtrudeGeometry s bevel. Vytvoří "ražba"/cavity look — pixel art skrz hole, frame = case panel okolo.
- Tilt-compensation: outer extendTop=5, extendBottom=13 (frame outer dosahuje canvas top/bottom hran, asymetrie kvůli tilt projection)
- `border-radius: 10px` + `box-shadow: 0 0 0 1.5px #8a5066` na canvas (mauve-pink outline matchuje case bg)
- Frame mesh: MeshLambertMaterial pink, smooth shading (bevel texture pro velkou plochu nešla = tilovala se)
- shift down -14 pixelsGroup + imageFrame → vyrovnání asymetrie cavity floor

**Pixel rendering polish** (v73.23–45):
- Geometry: ExtrudeGeometry s rounded XY corners (radius 1.5) + bevel (size 2.4, thickness 3.2, 6 segments) — proper 3D zaoblený cube s capsule-ish top
- `PIXEL_INSET = 0.70` → 30 % gap mezi pixely (breathing room)
- `PIXEL_DEPTH = 28` (zvětšeno z 18)
- BackSide outline mesh per pixel (scale 1.08, renderOrder -1)
- `MeshLambertMaterial` (smooth shading)
- `HEIGHT_VAR_RANGE = 0.025` (±2.5 % random per-pixel variance) + `HEIGHT_PATTERN` URL param (`?height=random|wave-h|wave-v|wave-diag|radial|flat`) — per-level feel
- `_texDefault` bez 2px black border (outline mesh je redundant)

**Projektil cartoon effects** (v73.46–50):
- **Squash & stretch po bounce** — `p.bounceT0` timestamp, scale curve dampened sin přes 0.18 s, k=0.55 (peak XY widen 1.55, Z squash 0.51)
- **BackSide outline mesh** na projektilech (scale 1.12)
- **`triggerBounceSpark()`** — 4 mini shardy explodují ven z impact pointu při wall bounce, gravity:true, life 0.22s, color matching
- **Motion trail** — každých ~40 ms drobný shard (scale 0.28 → 0, life 0.18s) v aktuální pozici projektilu

#### ✅ Hotovo v M9 day 2 (v73.51–114)

**Bottom unified frame** (v73.54–94):
- Belt + skulina + arena jako **jeden vizuální 3D tvar** s "vylomenou" dírou — match feeling image area frame
- **Hole path**: 13 segmentů (belt rectangle + bridge + skulina + arch + arena + zaoblené dolní rohy + zrcadlo). Arch je 2-segment cubic Bezier per side (matches user-provided `curve_2.svg` reference)
- **Miter offset s self-intersection clipping** (`_miterOffsetPolygon` + `_clipSelfIntersections`):
  - Naivní miter approach selhal na úzké skulině (4 px) — miter body se překrývaly
  - Solution: detect flip (offset segment proti směru original) + far miter check (>3×distance) + segment-segment intersection clipping (splajzne polygon kde se non-adjacent edges křižují)
  - Algoritmus zvládá až ~30 px offset bez self-intersection bugs
- **Stencil clipping**: mask (filled bandOuter shape) napíše stencil=1, band `MeshLambertMaterial` testuje stencil EQUAL 1 → outer side walls jsou clipnuté, inner cavity walls (skrz hole) viditelné. Klíč: `stencilWrite: true` + `stencilWriteMask: 0` aktivuje testing bez psaní.
- **Floor mesh** ve tvaru hole (ShapeGeometry, dark mauve) — přesné kopírování shape místo CSS rectangle bg co přesahoval
- **CSS bottom-deck** transparent v 3D → jen floor mesh poskytuje dark cavity
- **Responzivní rebuild** (`_rebuildUnifiedFrame` memoizovaný přes `beltCenterY|carriersTopCSS|carriersBottomCSS` key) — frame se aktualizuje při level changes / viewport resize

**Sjednocení s image frame** (v73.95–102):
- **Materials** identické: `MeshLambertMaterial({ color: 0xf4b8c8 })`, bez emissive
- **Lighting** identický: `DirectionalLight(1.55) + HemisphereLight(skyColor=#ffe8f0, groundColor=#a090a8, 1.85)` — předchozí bottom Math.PI=3.14 by způsobil přesvícení
- **ExtrudeGeometry** depth=50, bevel=2, bevelSegs=3 — match
- Visual matching color × visual matching lighting → automaticky stejný výsledný odstín

**Layout polish** (v73.103–105):
- **Carriers top padding** (CSS var `--carriers-pad-top`) — JS set podle dostupného prostoru (18px když fits at max, 4px jinak)
- **Pin grid to bottom**: wrap padding-bottom 22→6, arena bottom offset +20→+6 → odstraní nevyužité místo
- **Side gap**: wrap padding-sides 10→16 → carriers dál od krajů frame

**Funnel collider polish** (v73.106–113):
- `physicsArenaPad: 6` nová FUNNEL_3D konstanta — match `FRAME_ARENA_PAD`, FUN.wideL/R na 6/414 místo 0/420
- `physicsNarrowHalf` 36→32 (match new visual skulina FRAME_SKULINA_HALF=32)
- **Multi-segment bezier collider**: render3d_bottom samples obě arch curves (20 segmentů per side), converts to FUN coords, exposes jako `window.FUN.archSegmentsLeft/Right`. game.js `collideFunnelSeg` iteruje přes pole → polygon collision kopíruje visual bezier shape (40 line segmentů total).
- **Arch shift down 16 px** — kompenzace tilt projekce zadní stěny kavity (depth=50 × sin(19.2°) ≈ 16). Bez shift balls bouncovaly o "přední" stěnu, ne tu hlubší kde visuálně vypadalo že klouzají.
- `FUN.slopeEndY` auto-updated z posledního archSegment Y → vertikální arena walls navazují přesně na konec archu.

**Frame visual tunables (final):**
- `FRAME_DEPTH = 50, FRAME_BEVEL = 2` — match image frame
- `FRAME_SKULINA_HALF = 32` (64 px wide throat, ≈ 2-3 balónky)
- `FRAME_ARENA_PAD = 6` (arena bounds tight k canvas edges)
- `skulinaBotCSS = beltBotCSS + 14` (arch top níž, "hlubší" linie)
- `arenaBotCSS = carriersBottomCSS + 6` (pin to grid bottom)
- `FLOOR_SHIFT_Y = 12` (floor dno přesun)
- `BAND_WIDTH = 6` (miter offset width)

#### 📋 Open v M9 (zbývá)

- **Background atmosphere** — současný stav: CSS gradient `--bg-3d-top → --bg-3d-bottom` per theme. Bod 2 původního scope.
- **Image area sjednocení vizuálu s bottom frame** — color/lighting/bevel již matched (v73.95–102), ale možná další polish (theme-awareness barvy frame, atd.).
- **FUNNEL_3D constants finalization** — bod 3 původního scope. v73.110–113 už dělají heavy lifting.
- **Theme cleanup** — pick 3-5 finálních témat pro production (souběžně).

**Klíčové oblasti:**

1. **Pixel image area depth**
   - Vyhodnotit jestli pixel-canvas (2D) má smysl udržovat vedle three-canvas, nebo plně přejít na 3D scénu
   - Pixel highlights / lesk / depth shadows mezi pixely
   - Polish destroy animací (shatter, fade, glow trails)
   - Block 3D rendering refresh — momentálně block-overlay-canvas dělá HP overlay, vyzkoušet jestli 3D block geometry je dostatečně čitelná

2. **Background / atmosphere**
   - Současný stav: CSS gradient `--bg-3d-top → --bg-3d-bottom` per téma
   - Možnosti:
     - 3D depth (parallax pozadí pod hrou)
     - Animated theme (slow gradient flow, atmosphere shift)
     - Ambient particles (sparkles, snow, dust)
     - Skybox / box illusion
     - Theme finalization — momentálně 10 témat, vybrat 3–5 "default" pro production

3. **Funnel finalization** — z v71.22 user note (12.5.2026):
   > "Při finálním dotváření BG se zřejmě nastaví jeden trvalý tvar funnelu."

   Tier 1 parametric foundation (v71.22) je ready. Stačí nastavit finální hodnoty v `FUNNEL_3D` konstanty v `game.js` (cca ř. 5920) — CSS clip-path + FUN physics se propagují automaticky. Tier 2/3 (measurement-based / per-level) se nedělají, viz polish inbox.

4. **Image area aspect ratio** (resp z M7 closeout) — image-area v 3D mode 420×362 vs 360×310 base. Reconsider při BG finalization jestli má smysl měnit pro různé viewports.

**Závislosti:**
- Po **M8** — 3D grid sjednoceno → vizuální baseline jasný
- Před **M13** (variable image grid) — M13 staví nad M9, image rendering musí být stabilní
- Souběžně s **theme cleanup** — výběr finálních themes pro production

**Anti-scope:**
- Mid-game image refinement (= M13)
- Replay export (= M10)
- Gameplay tuning (= M12)

### M10: Replay & scrub — Curve editor Úr. 1.5 (v74+)

Nad existujícím Curve panelem (v63) přidat: `(c, r)` carrieru do history, pixel diff per krok, mini canvas gridy, timeline scrubber, play kontrolér, .webm export. Viz [deep dive →](#deep-dive-difficulty-curve-editor-úr-15-replay--scrub)

### M13: Variable image grid — zjemnění sítě obrázku (future)

**Východisko:** image area má dnes pevný pixel grid (GW × IMG_GH). Každý level se vykresluje na stejné rozlišení. To omezuje:
- **Detail** — malé obličejové rysy se ztrácí, gradient přechody jsou hrubé
- **Difficulty scaling** — nejde mít "snadné" levely s velkými bloky a "expertní" s mikropixely
- **Tematickou variabilitu** — chibi style by mohl mít hrubou síť, realistický portrét jemnou

**Nápady k prozkoumání:**
1. **Per-level resolution** — každý level deklaruje svůj grid (např. `gridScale: 1.5` = 1.5× pixely)
2. **Mid-game refinement** — uprostřed levelu se síť zjemní, hráč musí dokončit přesnější obraz
3. **Subpixel pixels** — kombinace velkých "blok" pixelů a malých "detail" pixelů (mosaic)
4. **Adaptive density** — důležité oblasti (oči, detail) mají hustší grid, pozadí řidší
5. **Resolution slider v editoru** — designer experimentuje s density před save

**Otevřené otázky:**
- Jak se to slučuje s carrier projectile distribution? (víc pixelů = víc projektilů na barvu)
- Performance při 2× grid (4× pixelů) na slabých zařízeních?
- Difficulty curve editor by musel respektovat resolution
- Solver hierarchy (M4) by se musela přepočítat

**Závislosti:** ideálně po M9 (3D vizuál image + BG hotový) — image rendering musí být stabilní baseline před zjemněním sítě. Před M12 (adaptivní obtížnost) — image grid je další knob pro tuning.

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

### 🔭 Polish (z M7 closeout)

- **Test <320 px viewport** — meta viewport=460 už škáluje pro velmi malé displeje, ale nezkoušeno do hloubky. Pokud někdo opravdu testuje na Galaxy Fold (280 css) → ověřit.
- **Gamee SDK haptic capability** — monitorovat changelog, kdyby přidali (v71.16 byl ready Android-only haptic, v71.17 reverted kvůli iOS missing). Pokud Gamee přidá native bridge → re-enable.

### 🌀 Funnel evolution (z v71.22 parametric refactor)

**🎨 Note od user (2026-05-12):** Při finálním dotváření BG (background)
se zřejmě nastaví **jeden trvalý tvar funnelu**. To znamená, že Tier 1
(parametric foundation) **už stačí** — finální design se jen propíše do
`FUNNEL_3D` konstant v `game.js` a tím to bude. Tier 2/3 níže jsou tedy
spekulativní možnosti, pravděpodobně se nikdy nedělají.

**📍 Naplánováno pro:** M9 (3D vizuál — image + BG + funnel finalization).
Funnel finalization je explicitní součást M9 jako bod 3 (souběžně s BG
finalization). Viz Plánováno → M9.

**Současný stav (Tier 1, v71.22):** Funnel rozměry parametrické přes JS
`FUNNEL_3D` konstanty + CSS vars (`--funnel-deck-w`, `--funnel-slope-h`,
`--funnel-narrow-half`, `--funnel-corner-r`). Single source of truth —
změna jedné hodnoty propaguje do CSS clip-path i fyziky FUN coords.
Diagonal intermediate body proporčně k slope-h. Behavior unchanged
vůči pre-v71.22.

**Tier 2 — measurement-based** (~1–2h práce, spekulativní)
JS by při init měřil belt-svg width + pending-canvas height a počítal
funnel rozměry z toho. Když by se belt změnil na 320 px nebo pending
na 70 px, funnel by se automaticky adaptoval. Užitečné pokud bychom
měli variabilní belt/pending velikosti — což zatím nemáme v plánu.

**Tier 3 — per-level funnel** (větší práce, spekulativní)
LEVELS data by mohlo deklarovat custom funnel shape pro daný level:
```js
{ name: 'tvary', funnel: { slopeEndY: 60, narrowHalf: 70 }, ... }
```
Designer by experimentoval s tvarem per level. Hodí se pokud bychom
chtěli, aby měly těžké levely jiný funnel než snadné (gameplay variací).
Pravděpodobně nebude potřeba, viz user note výše.

---

## ✅ Historie commitů

| Verze | Commit | Datum | Co |
|-------|--------|-------|----|
| v73.115 | `e8d7c62` | 2026-05-15 | **M9 day 3 start — BG atmosphere.** Vignette (druhá vrstva radial-gradient), film grain (body::before SVG feTurbulence noise), animated glow pulse (body::after 9s breathing), sparkle particles (30 částic, mix kruhů + 4-cípých hvězdiček, pomalý drift + twinkle, bílé — funguje na všech tématech). |
| v73.114 | `f142459` | 2026-05-14 | **M9 day 2 — Bottom frame complete.** Belt + skulina + arena jako jeden tvar přes miter offset s self-intersection clipping, stencil clipping skryje outer side walls, shaped floor, responzivní rebuild při layout změnách. Multi-segment bezier collider kopíruje visual arch (40 segmentů). Sjednocené světla/materiály s image frame (Lambert, dir 1.55 + hemi 1.85, color #f4b8c8). |
| v73.50 | `da122b0` | 2026-05-13 | **M9 day 1** — image-area 3D frame (ražba/cavity look), rounded 3D pixely s capsule top, breathing gap (PIXEL_INSET 0.70), height pattern variants (random/wave-h/wave-v/wave-diag/radial/flat), squash&stretch + outline + spark + motion trail na projektily. |
| v73.0 | `58b6814` | 2026-05-13 | **M8 closeout** + M9 start marker. M8 (Sjednocený 3D grid) hotov: 3D walls, mystery 3D + reveal anim, cascade pop, denial shake, layout polish. Deferred: empty/garage/rocket 3D, falling anim, tech debt. M9 začíná = 3D vizuál (image area depth, BG atmosphere, funnel finalization). |
| v72.82 | `44543d6` | 2026-05-13 | Event delegation pro denial shake — fix iOS Safari nereagování. Per-element listeners selhávaly na `.carrier.inactive`/`.hiddenq` (inner `.cbox`/`.cbox-hid` mají v 3D transparent bg). Delegated handler na `#carriers-grid` parent + `closest('.carrier')`. |
| v72.79 | `82e8b6b` | 2026-05-13 | Denial shake bundle — klik na inactive/mystery carrier spustí Y-axis rotation oscillation (±13°, dampened sin, 3.5 cyklů, 0.32s). State v `carrierDenialAnim` Map, trigger přes `triggerCarrierDenial` API. CSS cursor:pointer + pointer-events:auto. `.controls` v 3D width = `--funnel-deck-w` (lícuje s deckem). |
| v72.76 | `1e3a048` | 2026-05-13 | Mystery 3D + cascade pop + reveal anim — 3D mystery box s animovanou `?` texturou (3×3 grid tilted glyphs diagonal scroll), circular wipe reveal (one-off ShaderMaterial + object-space discard), cascade pop (slot pops then balls staggered +50ms). `clearCarrierState()` ze startLevel. Layout fixes: CARR_TARGET_GAP 6→4, CARR_MIN_SIZE clamp jen pokud fits, canvas H buffer +400 pro level switch worst case, ghost renderOrder nad mystery reveal. |
| v72.44 | `128a394` | 2026-05-12 | Wall polish bundle — concave corner snap (v72.21–22 fix gap-midpoint stair-step → cell-edge intersection), polygon offset outline (v72.25 `_offsetPolygonOutward` uniform tloušťka, místo scale), trailing-vertex dedup (v72.26 fix tenký šev), rounded silhouette (v72.29–30 `_buildRoundedShape` quadraticCurveTo radius 4.5), outline barva wall × 0.38 (v72.31), wall lightness +0.02 HSL (v72.32–34), disabled shadow filter experiment (v72.41–44). |
| v72.1 | `a6e6d52` | 2026-05-12 | Depth illusion via shader injection — vertex color approach z v72.0 user 'neviděl'. Switch na per-fragment darkening v slotMat.onBeforeCompile (object-space vSlotLocal varying). Funguje regardless of GLB vertex density. Stronger contrast (0.40 min, threshold 0.40). |
| v72.20 | `333476b` | 2026-05-12 | Fix wall polygon trace — grid-coord trace + CSS conversion via cornerCSS helper. v72.19 CSS-coord trace selhával na concave corners (L/T) kvůli inflated rect mismatched endpoints → incomplete polygon → triangles. Grid corners jsou integer, vždy matchují. |
| v72.19 | `785856a` | 2026-05-12 | Walls TRUE monolith — BFS components + ExtrudeGeometry z polygon outline. Pro libovolný shape (L/T/+/U) jediný mesh bez seams. Inflated cell rects fill gaps. |
| v72.18 | `4382656` | 2026-05-12 | Walls technique 3 — per-rect Mesh s custom RoundedBoxGeometry (rounded corners uniform regardless of size, vs InstancedMesh scaled BoxGeometry v v72.17). |
| v72.17 | `c4b98dc` | 2026-05-12 | Wall greedy rect decomposition — InstancedMesh + scaled BoxGeometry. Adjacent walls v row/col mergují do jednoho rectu. L/T/+ decomposed. (Replaced v v72.18.) |
| v72.16 | `e5d998d` | 2026-05-12 | Per-cell 3D walls — procedural RoundedBox, depth 18, color z --carriers-3d-bg theme-aware. Žádné merging zatím (= v72.17). |
| v72.15 | `dbaf619` | 2026-05-12 | Parallel inner ghost mesh — fix 'black top face' během fire anim. Při kliku ghost mesh outer + inner lift sync, top face se nepropadne na BG color. |
| v72.14 | `147d326` | 2026-05-12 | HSL darken pro slotMatInner — preserve hue+saturation, reduce lightness × 0.55. Tmavomodrá zůstane modrá místo načernalá. Shader injection v onBeforeCompile. |
| v72.13 | `7783190` | 2026-05-12 | Swap inner/outer geometry — Material.001 = top (darker), Material.002 = shell (full color). Z user Blender convention. |
| v72.12 | `dd7fbac` | 2026-05-12 | Separate inner InstancedMesh per row — bulletproof multi-material. Dva paralelní InstancedMesh (outer + inner), each své geom + material. Per carrier same matrix + same color na obou. |
| v72.11 | `006f68e` | 2026-05-12 | Merge multiple GLB primitives — fix split-mesh ignoring half. GLTFLoader vytváří 2 separate Mesh per primitive, můj kód grabbed jen první. _mergeWithGroups concat positions/normals/indices + addGroup per material. (Replaced v72.12 — InstancedMesh multi-material nereliable.) |
| v72.10 | `29f44cf` | 2026-05-12 | Split-mesh approach (v72.10) — two material slots z user updated GLB, slotMatOuter + slotMatInner s color 0x666666 × 0.4 darker. (Replaced v72.11/12 — single mesh multi-material nešlo.) |
| v72.0–9 | various | 2026-05-12 | Carrier inner depth illusion iterations — vertex colors → shader injection per-fragment → strict threshold → revert tries. v72.9 strict 0.95-0.99 threshold byl ready ale user chtěl split approach (v72.10+). |
| v71.27 | `0bfb7b1` | 2026-05-12 | Ball offset faktor 0.18 → 0.195 — dorovnat v71.25 vzhled spacingu při 54 carrier (po v71.26 base-unit fixu balls 1.56 px blíže). Final offset @ 54 = 10.53 (vs 10.50 původně). |
| v71.26 | `a560918` | 2026-05-12 | Fix double scaling ball offsets — offX/offY z SLOT_SIZE base units místo cr.width. Bug: offset se násobil 2× slotScale (cr.width × × slotScale) → balls při shrinku kolabovaly do středu kvadraticky. Po fixu: konstantní offset/radius ratio 0.82 napříč všemi velikostmi. |
| v71.25 | `8b09f9c` | 2026-05-12 | Revert sphere segments (user: 'nebyl to ten problem') + ball offsets 0.21 → 0.18 cw/ch v 2×2 mřížce. Balls blíže k sobě, outline overlaps zvětšeny → jednotnější vzhled místo 4 separated balls. |
| v71.24 | `aa86772` | 2026-05-12 | Sphere segments 24×16 → 32×24 pro všechny ball geoms (carrier/pending/belt). Fix 'rozdroben' outline rim při larger render size — inverted hull outline metoda kopíruje polygon segments na siluetě, low count = visible facets. (REVERTED v71.25) |
| v71.23 | `84078ad` | 2026-05-12 | R_CARRIER 12 → 11 — carrier balls mírně menší v poměru k nosiči. Geometry × slotScale stále škáluje s velikostí nosiče (responsive z v71.11). Pending/belt balls (R_PENDING/R_BELT = 12) nedotčeny. |
| v71.22 | `c24a80c` | 2026-05-12 | Parametric funnel — FUNNEL_3D konstanty v JS jako single source of truth, CSS vars (--funnel-deck-w/-slope-h/-narrow-half/-corner-r) nastavované z JS. Clip-path coords přes calc() proporčně. Behavior unchanged, foundation pro Tier 2 (measurement-based) a Tier 3 (per-level konfigurace). |
| v71.21 | `7bc6ca9` | 2026-05-11 | Fix flicker při kliku + belt position bug. (1) Memoize _setAdaptiveCarrierSize na numRows+vh inputs — drawCarriers cascade už nereflow-uje. (2) bottom3d-canvas top via CSS calc(baseline + var(--game-top-extra)) — auto-follows padding change. |
| v71.20 | `7a87107` | 2026-05-11 | PWA setup — manifest.json + apple-mobile-web-app-* meta tagy. User Add to Home Screen → fullscreen Safari bez URL baru/toolbaru. Apple chrome programmatically nelze schovat z webu, PWA install je jediná cesta k fullscreen. |
| v71.19 | `0345e35` | 2026-05-11 | Boost adaptive top padding — threshold 30→16, ratio /3→/2, cap 48→72. v71.18 hodnoty byly příliš subtle (13-20 px splývalo s background), uživatel změnu nevnímal. |
| v71.18 | `e9a2418` | 2026-05-11 | Adaptive top padding — když carriers fit at TARGET (54) a leftover >= 30 px, hra dostane top breathing space (min(48, leftover/3)) od horní hrany telefonu. Při tight space (shrink) 0 — natlačeno nahoru jako dosud. Oscillation prevention: výpočet odečte current --game-top-extra od carrWrap.top. |
| v71.17 | `2b34e7e` | 2026-05-11 | Revert haptic — iOS nemá vibration API (Apple blok), inconsistence napříč platformami. Helper + 4 calls odebrány. Kód v git history (v71.16 = 04608e2) pro budoucí re-enable kdyby Gamee SDK přidalo haptic capability. |
| v71.16 | `04608e2` | 2026-05-11 | Haptic feedback (Android only) — navigator.vibrate() hooks na carrier click (10ms tap), funnel limit denial (double-buzz), level win ([0,60,50,120] pulse), game over (200ms). iOS Safari nemá vibration API (Apple blok). Feature-detected + respect prefers-reduced-motion. (REVERTED v71.17) |
| v71.15 | `4b3529c` | 2026-05-11 | Mobile touch fix — odstraněn 300ms click delay (touch-action: manipulation na #game) a polopruhledný tap highlight overlay (-webkit-tap-highlight-color: transparent). Tap na iPhonu je teď okamžitý. |
| v71.14 | `a18addb` | 2026-05-11 | iOS safe area + visualViewport fix — bottom row carriers se na iPhone uřezávala pod home indicator. CSS env(safe-area-inset-bottom) přidána do safeBottom (12 + ~34 px na iPhone X+). visualViewport resize listener handluje URL bar collapse/expand. |
| v71.13 | `d2c83d7` | 2026-05-11 | RENDERER_MODE default flipped 2D → 3D. URL bez params = 3D scéna (M6 hotový, v71 polishing). 2D fallback opt-in přes ?renderer=2d pro debugging. Deploy na GH Pages. |
| v71.12 | `ff64fa9` | 2026-05-11 | safeBottom = konstanta 12 (ignoruje dev UI — settings bar/Level UI/Stats). Carriers sizují podle production layoutu, ne dev. Plus resize listener teď volá i window.render3dBottom.updateCarriers() — 2D i 3D se synchronně přepočtou. |
| v71.11 | `74ca201` | 2026-05-11 | 3D meshes responzivně škálují k DOM cbox velikosti — slotScale × (cr.width / SLOT_SIZE). Před tím 3D objekty zůstávaly 50 px world units i když DOM divy zmenšily na 38 px → overlap. Outline a balls dědí scale přes multiplikaci. |
| v71.10 | `787f6d1` | 2026-05-11 | Fix overflow 1. a 7. řady — SAFE_BOTTOM dynamicky měří dev settings bar (bar.height + 20). Před tím hardcoded 10 ignorovalo ~38 px pod carriers v dev módu, carriers se vytlačovaly mimo viewport. |
| v71.9 | `af8bb9e` | 2026-05-11 | Fix CSS specificity bug — JS přepisy --carrier-size byly shadowed CSS rule na body.renderer-3d. Defaulty odebrány z body.renderer-3d, použit fallback v var(--x, default). Responsive sizing teď reálně funguje. |
| v71.8 | `ad09d94` | 2026-05-11 | Responsive carrier sizing — měří viewportH + carriers-wrap.top, target 54 px pokud se vejde, shrink jen na malých displejích. Na Pixel 8 / iPhone 14 zachová full size i pro 7 řad. Resize listener pro rotaci. |
| v71.7 | `351541e` | 2026-05-11 | Adaptivní carrier velikost přes CSS vars (--carrier-size/-ball-size/-row-gap) podle počtu řad: 4–5 = 54/26/6, 6 = 48/22/5, 7 = 42/18/4. ROW_COUNT_MAX 4→7, rowSlotIdx/rowBallIdx arrays 6→7 |
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

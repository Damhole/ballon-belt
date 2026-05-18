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
| M9 | 3D vizuál + brand "Plop!" | v73.0–346 | ✅ | Image area 3D frame, bottom unified frame, BG atmosphere, smoke puffs, 3D gun + muzzle flash, hole asset + suck animace, rounded frame corners, HD particle-canvas. Brand: hra pojmenovaná **Plop!**, comic-style PWA ikona (Bangers font, růžová/žlutá), visible badge "Plop! vX.Y". |
| **Beta cycle** | Pre-release polishing + 2. test | **v74.0+** | 🚧 | Druhý test cyklus — feature complete, polishing pro release. Game brand = Plop!. |
| M10 | Replay & scrub | future | 📋 | Curve editor Úr. 1.5 — timeline scrubber, mini canvas, .webm export |
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

#### ✅ Hotovo v M9 day 3 (v73.115–167)

**BG atmosphere** (v73.115):
- Vignette (2. vrstva radial-gradient, dark edges)
- Film grain (body::before SVG feTurbulence noise, 5.5% opacity)
- Animated glow pulse (body::after, 9s breathing, 50%→100% opacity)
- Sparkle particles canvas (30 částic, mix kruhů + 4-cípých hvězdiček, drift + twinkle, bílé) — funguje na všech tématech

**Layout polish + 4-row fix** (v73.116–122):
- Dev UI offsets (controls margin-top 16, ammo-audit/settings bar 10)
- 4-row slack distribution: pro málo řad na velkém displeji slack → margin-top na carriers-wrap, MAX_CAVITY_ABOVE = 100 cap
- Lock arch height: FRAME_ARCH_HEIGHT = 90 konstanta, vertikální stěny arény extendují místo deformace bezier
- Frame anchory = `#carriers-grid` (reálné řady, ne wrap s paddingem). Arch končí 15 px nad první řadou, frame bottom pin na last row + 5 buffer

**Collider polish** (v73.123–127):
- DEBUG_COLLIDER_LINE zelená čára pro vizuální debug
- Sliding kontakt (e=0.0): odebere jen normal komponentu velocity, tangenciální zůstane → ball klouže
- Arch sampling 20 → 40 → 80 segmentů
- Smoothed vertex normály: `_smoothPolylineNormals` v render3d_bottom (CCW rotace tangent), collideFunnelSeg lerpuje mezi p1.normal a p2.normal podle t. Kontinuální normal field, žádné step-funkce na hraně mezi segmenty

**Dev UI refactor** (v73.128–135):
- `#settings-toggle` floating ⚙ button (22 px, white 15% fill, hover 25%, active modrá) — top-right rohu funnel area
- `#dev-overlay` popover (rounded, backdrop-filter blur, dark transparent bg) — nad funnel area, hidden default
- `#version-badge` top-left rohu funnel area
- `.controls` + `#ammo-audit` + safe zone toggle JSem přesunuty do overlay
- Klik na ⚙ / klik mimo / Shift+D / ?debug=1 → otvírá/zavírá
- Stats.js disabled v index_local

**Anti-scroll saga + root cause** (v73.136–167):
- v73.138: revertnuty anti-scroll hacky (position:fixed, touch-action:none, overflow:hidden) — pull-to-refresh musí fungovat
- v73.139: `min-height: 100dvh` místo 100vh (dynamic viewport, iOS URL bar aware)
- v73.140: `overflow: hidden` na `#game` — bottom3d-canvas má +400 buffer tail (absolute pos), bez overflow:hidden přispíval k document scroll height
- v73.151–156: experimenty s body padding (40→0), 100dvh vs visualViewport, vše revertnuto
- v73.158–165: iterace safeBottom 4/8/12/20/4/12, revert experiments hledající root cause
- **v73.166 🎯 ROOT CAUSE:** `--carriers-pad-top` je v `render3d_bottom._setCarriersPadTop()` nastavený dynamicky (18 px pro `cellSize ≥ 50`, 4 px pro shrunk). Můj algo měl `WRAP_PAD_TOP = 4` HARDCODED → 14 px discrepance pro TARGET levely:
  - 4-row TARGET cellSize 54 → real pad 18, algo myslel 4 → grid_top o 14 px níž → game.bottom o 14 px níž → overflow vh → body grows → scrollbar
  - 5+ row shrunk cellSize < 50 → real pad 4 → consistent s algo → no overflow
  - **Algo teď PREDIKUJE actual pad:** ESTIMATED_PAD = 18 pro cellSize compute (conservative), pak `actualPadTop = (carrierSize >= 50) ? 18 : 4` pro shift placement. Tím real grid_top = algo's expected.
- v73.167: safeBottom 20 → 7 px (po root cause fix už není potřeba velký buffer)

**Závěr M9 day 3:** vše funguje. Frame visualy konzistentní napříč levely + viewporty, žádný scrollbar, žádný horizontal jump grafiky na desktopu, sparkles + glow pulse animace, čistý dev UI overlay.

#### ✅ Hotovo v M9 day 4+ (v73.168–217) — Cartoon polish + physics fixes + dev tools

**Pixel destruction polish** (v73.168–172, v73.188):
- Wave bounce po destrukci: damped sine Z-stretch na sousedech v rádiusu 4, life 360 ms (v73.168–169, 172)
- Hit bounce při bounce na špatné barvě: subtle ~3 px stretch na zasaženém pixelu (v73.170–171)
- v73.188: změna z position-offset poskoku na **stretch nahoru** (pixel zůstává na zemi, jen roste) — match cartoon look

**Pending ball physics & visuals** (v73.173–180):
- Squash/stretch při kolizi: `bounceT0` + `bounceAmp` per ball, intenzita úměrná `|vn|/180`, max 10 % (v73.173–174)
- Arch sanity clamp fix: `_archXAtY` přesné bezier segmenty místo lineární interpolace (v73.173)
- Pending overflow fix: hard stop `wideL/wideR+r`, gate posunuto 14 px níž (v73.175)
- Collider dno +180 px hlouběji do carrier area (`physicsExtraDepth`): kuličky spawnuji v carrier oblasti a stoupají (v73.176–177)
- Krk-walls + throat sanity clamp proti úniku přes skulinu (v73.177–181)

**Anti-escape saga — root cause asymetrického úniku** (v73.182–186):
- v73.182: debug console.log detekuje pending balls outside opening corridor
- v73.183–185: iterace strict clamp +12 / bezier vs linear fallback / `_archXAtY` offsetování z bandOuter — vše revertováno
- **v73.186 🎯 ROOT CAUSE:** `_archXAtY` fallback vracel `segs[last].x` bez ohledu na orientaci. Right arch (top→bot): last=wideR=414. Left arch (bot→top): last=narrowL=178. Asymetrické! Pro y mimo segment range (gap zone mezi `narrowY=40` a `arch start ≈56` kvůli `ARCH_Y_SHIFT=16`) měl right side rx=414 → žádný clamp → únik. Fix: vrátit x z **closest endpoint** podle Y vzdálenosti
- v73.187: cleanup — odstraněny throat walls (collideFunnelSeg), debug log

**Position-aware belt loading — sparse array refactor** (v73.189–191):
- Belt přepsán z compact array na sparse array délky `BELT_CAP=14` (null = prázdný slot)
- `findBeltLoadSlot(b.x, beltAnim)` najde slot s vizuální pozicí nejblíž ball.x
- Ball čeká pod otvorem dokud prázdný slot neprojde kolem (per-x gate)
- Cannon iterace, beltCount, beltIsFull/Empty helpers
- Realistic load — kuličky se naloží na pozici kde se nachází, ne na konec array (teleport)

**Bottom frame outline + canvas extending saga** (v73.192–201):
- v73.192–193: zapnut existující `unifiedFrameOutline` mesh (mauve-pink #8a5066, match image area box-shadow)
- v73.194–196: experimenty s ExtrudeGeometry vs ShapeGeometry vs LineLoop, miter offset z innerPts vs bandOuter
- 🎯 **v73.195 fix duplicate outline:** `_disposeUnifiedFrame` neodebíral `unifiedFrameOutline` → akumulovaly se duplikáty při rebuilds (resize/layout change). Přidán do meshes array
- v73.196–197: canvas + camera extended o CANVAS_PAD=12/4 px (outline sahá 8 px za frame edge, byl ořezán). Způsobilo grid shift
- v73.198–199: alternative — `FRAME_ARENA_PAD: 6→10`, `CARR_TARGET_SIZE: 54→52` (cavity 408→400). Frame nelícoval s image area
- 🎯 **v73.201 ROOT CAUSE grid shiftu:** `updateCarriers` počítal `wX = cboxRect.left - canvasRect.left`, implicitní assumption že `cameraLeft = 0`. Když jsme cameru extendnuli na `(-pad, W+pad)`, assumption se rozpadl → 3D meshe se renderovaly o +pad vpravo. Fix: použít `bottom-deck` jako stable world origin: `wX = cboxRect.left - bottomDeckRect.left`. Coordinate system nezávislý na canvas/camera config

**Mystery box color tuning** (v73.202–204, v73.209–210, v73.212):
- v73.202: theme-aware base = `--carriers-3d-bg × 0.10` (darken factor)
- v73.203–204: factor iterace 0.10 → 0.70 → 0.10 (user feedback "hodně hnědá" → "strašně světlá" → správně dark wine)
- 🎯 **v73.209 fix rendered ≠ texture:** mystery box používal `MeshToonMaterial` (respektuje lighting) → rendered color × light_factor → výrazně jasnější než hex z dev pickeru. Změna na `MeshBasicMaterial` — texture color zobrazena přesně
- v73.210: `MYSTERY_BASE_DEFAULT = '#10040b'` konstanta (laděno tebou v dev color pickeru)
- v73.212: final `MYSTERY_BASE_DEFAULT = '#1c0410'` (deeper wine)

**Dev color picker tool** (v73.205–208):
- "🎨 Colors" panel v dev-overlay (settings ⚙)
- 7 tunables: BG gradient top/bottom, Floor/Image BG (cascade), Image frame mesh, Bottom frame mesh, Frame outline, Mystery base
- Live preview + native `<input type="color">` + hex text input
- localStorage persistence pod `bb-color-overrides`, "Reset všech barev" button
- Cascade: floor color → floor mesh + wall mat (+0.02 HSL) + image area BG
- UX: overlay se zprůhlední během native pickeru (`opacity:0 + pointer-events:none`), vrátí se po change/blur. Display:none nešlo — schoval i input → picker se nestihl otevřít
- API exposed: `render3d.setImageFrameColor`, `render3dBottom.setBottomFrameColor / setOutlineColor / setMysteryBaseColor / refreshFloorColor / refreshWallColor / rebuildMysteryTexture` + getters

**Pending ball shadows — diskon vs real** (v73.211–217):
- v73.211: enabled disk shadow (CircleGeometry × 1.35 R_PENDING, opacity 0.35), scaluje s pozicí v trychtýři, renderOrder 148
- v73.212–215: real shadow mapping experiment — `renderer.shadowMap.enabled=true`, dedicated shadowLight, `pendingMesh.castShadow=true`, floor Lambert + receiveShadow. Trade-off: shadowLight position vs lighting changes. Nerenderoval nic
- v73.214: ROOT-LEVEL FEEDBACK 🚨 — Claude unilaterálně revertoval real shadow zpět na disk bez svolení. Uložen memory `feedback_no_unilateral_revert.md`. Auto mode classifier zablokoval druhý force-reset, správně.
- v73.216–217: disk shadow tunes (méně oválný 0.45→0.70, blíž k ball, slight X offset pro sun direction) → user verdikt "vypadá nevkusně" → **v73.217: shadow disabled** (`visible=false`), infrastruktura zachována v kódu

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

### Beta cycle: Pre-release polish (v74) — 🚧 in progress

**Cíl:** Feature-complete hra prochází 2. testovacím cyklem. Tyto body musí být hotové než hra půjde na test. Pořadí práce: ne chronologicky — user rozhoduje co dál.

| Prio | Stav | Vel. | Téma | Nápad |
|------|------|------|------|-------|
| P0 | 💡 | M | Hra | **Blocks fix** — rozbila se mechanika i vizuál bloku po přechodu na 3D; nutno spustit a prověřit |
| P1 | 💡 | M | Editor | **Editor nahodit + opravit** — editor neběží na local; zkontrolovat stav po přechodu na 3D |
| P1 | 💡 | S | Editor | **Theme k levelu** — selector theme pro každý level v editoru (level data + editor UI) |
| P1 | 💡 | S | Editor | **Photo color minimizer** — sjednocovat podobné barvy pod jednu při importu fotek; šetřit paletou |
| P1 | 💡 | S | Hra | **Ball do díry check hned** — balonek nastoupí na belt → okamžitě zkontroluj jestli jeho slot půjde do díry; nečekat na celý round |
| P1 | 💡 | M | Infra | **FPS drain diagnóza** — hra bere FPS i bez interakce; hledání příčiny (bg-canvas, particles, dirty flags, …) + fix |
| P2 | 💡 | S | Hra | **Zvuky** — pop, dopad projektilu, win jingle; user dodá zdrojové soubory; ffmpeg trim/normalizace/konverze na OGG |
| P2 | 💡 | XS | Hra | **Poslední pixel větší collider** — 2× collider jen pro poslední pixel na scéně |
| P2 | 💡 | XS | Hra | **Belt zrychlit** — zvýšit belt scroll speed |
| P2 | 💡 | S | Hra | **Flow: zrychlení po vyprázdnění carriers** — když hráč odklikne všechny nosiče a žádný nezbývá, hra 2× zrychlí (belt + projektily) dokud level neskončí |
| P2 | 💡 | XS | Polish | **Ball highlights** — tmavé barvy (černá, tmavě modrá) špatně viditelné v carrier gridu; přidat rim-light nebo highlight |
| P2 | 💡 | XS | Polish | **Decentnější smoke z gun** — smoke puffs příliš výrazné; ztlumit opacity / scale |
| P2 | 💡 | S | Infra | **Přímý link na level** — URL param `?level=ID` načte konkrétní level přímo; default (bez paramu) all-in-one pořadí zachováno |

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
| P2 | 💡 | L | **Odstranit 2D renderer** — ~29 RENDERER_MODE guards + 8 draw funkcí (drawBelt, drawCarriers, drawPending, drawGrid…) jsou mixem logiky a vizuálu; nutno rozplést game logiku od 2D kreslení. V 3D módu neaktivní, ale tech debt blokující čitelnost kódu. Udělat až po release, ne v beta. |
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
| v74.5 | (pending) | 2026-05-18 | **PWA ikona — balónková varianta (icon_3).** Nahrazena 3D plastová ikona za nafukovací balónkový styl. Stejný pipeline (flood fill + trim + 3 velikosti). |
| v74.4 | (pending) | 2026-05-18 | **Nová PWA ikona — 3D Plop! PNG.** Nahrazena SVG ikona (Bangers font) za 3D rendered PNG (žlutý rounded square + pink PLOP!). ImageMagick flood fill odstranil černé pozadí + trim. Vygenerováno icon-192.png, icon-512.png, icon-maskable.png. manifest.json: SVG→PNG, background_color tmavá→žlutá #f0c000. index_local.html: apple-touch-icon link + apple-mobile-web-app-title opraven na "Plop!". |
| v74.3 | (pending) | 2026-05-18 | **Settings button experimenty + version badge top tune.** Pokus o toon styling settings ⚙ buttonu (white circle s dark outline, lifted drop shadow, hover/active anims, open state pink). User experimentoval — chtěl bez circle jen ikonu s dark dropshadow zespod. Nakonec **vráceno na úplně původní** subtle 22 px white-on-translucent ⚙ emoji button. Version badge (Plop! + v74.3) posunut o 2 px výš (`funnelTop + 6` → `+ 4`). |
| v74.2 | `14547d5` | 2026-05-18 | **PWA safe-area-inset support (notch / home indicator).** iOS PWA s `apple-mobile-web-app-status-bar-style: black-translucent` má status bar/notch transparentní přes obsah → text z `#version-badge` se schovával pod notch. Fix: `#game` padding přidává `env(safe-area-inset-top/bottom/left/right, 0px)` — obsah se odsadí od notche, home indicatoru i side bezelů (landscape). Funguje napříč všemi devices (iPhone X+, SE, Android, desktop, iPad). V devices bez safe area `env()` returns 0 → bez efektu. |
| v74.1 | `3f75b43` | 2026-05-18 | **PWA install fix — split manifest scope.** Root cause: `manifest.json` `start_url` pointoval na `./index.html` (prod s real Gamee SDK). PWA install pak spustil prod verzi, která čeká na parent message která v PWA standalone nikdy nepřijde → `startLevel()` se nezavolá → prázdná hra (jen pozadí + empty image area). **Fix**: (1) `manifest.json` `start_url` → `./index_local.html` (se stub SDK, funguje standalone). (2) `<link rel="manifest">` + apple-mobile-web-app-* metas odstraněny z `index.html` — z prod verze už PWA install nejde, jen z local. (3) CLAUDE.md Gamee zip exclude list rozšířen o `manifest.json`, `assets/icon-*.svg`, `assets/icons/` (PWA-only, v Gamee iframe nepotřebné). Gamee deployment beze změny — `index.html` zůstává funkční pro iframe. **Pozn.**: předchozí v74.1 (commit `8fd7287` se polyfillem + 2D fallback) byl revertnut (`5ea56fd`) — user explicitně řekl že 2D fallback není řešení a požaduje aby Three.js fungoval. Aktuální v74.1 je čistá per-platform separace. |
| **v74.0** | `bc8c8ca` | 2026-05-18 | **🎬 Beta cycle start.** v73 cyklus uzavřen (M9 hotov + brand identita). Hra teď oficiálně **Plop!** — feature complete, vstupuje do druhého testovacího cyklu. Polishing před release. Externí komunikace: "Plop! Beta v74.0". |
| v73.346 | `2e1b5f2` | 2026-05-18 | **Fix Plop! color v badge.** Odstraněn explicitní `color` na `.game-name`/`.ver-num` — child spans teď inheritují parentův `#version-badge` color (`rgba(255,255,255,0.55)` v 3D módu = světlá). Jediný styling rozdíl: `font-weight: 600` na Plop! pro mírné odlišení od verze. |
| v73.345 | `795d6dc` | 2026-05-18 | **Plop! v UI sjednoceno s version fontem.** Bangers @import + comic style v `#version-badge` odstraněno. Plop! teď používá stejný `var(--font-sans)` jako version number, jen `font-weight: 600`. Comic font zůstává jen v ikoně (PWA install). |
| v73.344 | `ab33a70` | 2026-05-18 | **Game name "Plop!" + icon.** Game pojmenovaná "Plop!" (interní project název zůstává balloon-belt). Visible branding přes `#version-badge`: "Plop!" (Bangers comic font, sytě růžová `#ff1493`) + `v73.344` malé šedé vedle. CSS `@import` Google Fonts Bangers. **PWA manifest** `name`/`short_name` aktualizovány na "Plop!". **Icon design**: SVG s PLOP! textem v Bangers fontu (embedded base64), sytě růžová na sytě žluté pozadí, text rotated -4° s overflow přes icon edges (intentional crop look). 3 verze: `icon-192.svg`, `icon-512.svg`, `icon-maskable.svg` v `gamee/assets/`. |
| v73.343 | `2df0777` | 2026-05-18 | **HD particle-canvas + smoke pozice.** `particleCanvas` internal resolution × `Math.max(2, devicePixelRatio)` + `ctx.scale(DPR, DPR)` → 2D drawings (smoke, cannon, particles) jsou crisp na retině i po CSS stretch v 3D módu. Drawing code zůstává v 360×310 souřadnicích. Smoke spawn distance 14 → 21 px podél cannon angle (14 muzzle + 7 forward) → cloud je před hlavní místo přímo na ní. |
| v73.342 | `b3acda2` | 2026-05-18 | **Smoke puffs 3D → 2D refactor (fix phone freezes).** Odstraněna 3D `IcosahedronGeometry` smoke puff implementace (i přes shared geometry stále způsobovala GC stalls + GPU buffer cycling per puff). Nahrazena čistě 2D verzí na `particle-canvas`: bílé kruhy s outline `rgba(20,22,28,0.5)` × 1.2 px, 3 puffs staggered (500/610/730 ms po posledním fire), pop-in scale 0→1.15, drift up + lateral, opaque do 50 % pak fade-out. Žádné GPU buffery, žádné per-frame mesh updates. Bonus fix: clamp `t` do [0,1] + min radius 0.1 — eliminuje `arc()` IndexSizeError při newly-spawned puffu kdy `dt` mohl být lehce negativní. |
| v73.341 | `6c4f0b7` | 2026-05-18 | **Perf fix: smoke puff geometry sharing.** Per-puff `IcosahedronGeometry(7, 2)` (80 faces) se vytvářela nově při každém spawn ale nedisposovala — GPU paměť leak při rychlé střelbě → GC stalls (freeze na mobilu po výstřelu). Fix: shared `_smokePuffGeom` přes všechny puffs, jen materiály per-puff (ty se dispose správně). |
| v73.340 | `9ce2c0c` | 2026-05-18 | **BG linear gradient (radial → linear).** Main body background změněn z `radial-gradient(ellipse at top, top → bottom)` na `linear-gradient(to bottom, top → bottom)` v `body.renderer-3d` CSS. Světlejší barva nahoře, tmavší dole, vertikální plynulý přechod. Vignette layer (radial dark edges) zachován. |
| v73.339 | `1cc6871` | 2026-05-17 | **Muzzle smoke puffs — 3D cartoon clouds.** Po výstřelu z děla spawnují 3 menší staggered smoke puffs (500/610/730 ms po posledním shotu). Každý puff: `IcosahedronGeometry(7, 2)` (smooth 80-face), bílá `MeshToonMaterial` + dark outline (`0x14161c`, BackSide, scale 1.10, child main meshe). Pop-in scale 0→1.0 v 25 %, drift +Y 13–19px + lateral ±5px, opaque do 50 % pak fade-out 50–100 %. Scale multipliers per puff: 0.45/0.55/0.40. Smoke timer se prodlužuje s každým novým shotem → rapid fire = 3 puffs až po dohrání burst (ne 3 per shot). Spawn pozice: world muzzle (přes `gunHead.localToWorld(0,26,0)`) → contentGroup-local (puff zůstává na místě po spawn, gun rotace ho nepohne). |
| v73.338 | `821e0b7` | 2026-05-17 | **3D gun (gunBody + gunHead) v top scene.** Nahrazení 2D cannon kreslení 3D gun mesh z `belt-boxes.glb`. `gunBody` statický korpus, `gunHead` rotuje s `cannonAngle` (rozsah ×0.55, lerp 20%/frame). Position smooth lerp X 22%/frame. Chrome matcap material (standardní Three.js viewDir UV formule, ne `normal.xy` override — gun je jeden objekt, asymetrie není problém). Tlustší outline (scale 1.10, color `0x14161c`). Konstanty `GUN_Y_OFFSET=-37, GUN_Z_OFFSET=73`. **Muzzle flash** — additive sphere child gunHead, ústí hlavně (local Y=26). 130ms anim, scale 0.5→1.6, opacity 1→0 (ease-out). Color z `item.color` mix 35% s bílou. **Image frame rounded corners** — outerR 14→22, innerR 8→16, CSS `border-radius` image-area+canvas 10→16. |
| v73.337 | `4258929` | 2026-05-17 | **Belt box matcap + hole asset + suck animace + rounded frame corners.** Shell belt boxů přepnut z `MeshToonMaterial` → `MeshMatcapMaterial` s procedurální chrome matcap texturou (sky/horizon/ground bands + spec hotspot, redesigned pro `normal.xy` mapping = front face na center of matcap). **`onBeforeCompile` override** matcap UV: `texture2D(matcap, normal.xy * 0.495 + 0.5)` místo standardní view-dependent formule → position-independent → levý (`scale.x=-1`) i pravý box vypadají identicky (fix asymmetry root cause: orthographic camera s objekty blízko Z=10 a `vViewPosition.x` 0–420 → různé matcap UV pro různé X). Arrow zůstává toon (neon emissive). Pozice tweaks: +1Y, ±1X (sblížení k středu). **Nový `hole` asset z GLB** — 2 primitives: rim (chrome matcap, sdílí boxMat) + flat inner plate (`MeshBasicMaterial #252a3d` tmavá ploška = vypadá jako díra). Outline rim scale 1.12. Pozice `(W/2, trackWY+20, 10)`. **Hole-suck animace** — `triggerHoleSuck(hex)` triggernutý ze všech 4 míst kde `belt[i]=null` v game.js. Phase 1 (72% času): pomalé přibližování + wiggle (sin/cos X+Y, 22Hz, ±3.5px) = jako vysavač. Phase 2 (28%): rychlý cubic ease-in vcuc, scale 1→0. Duration 180ms total. **Rounded unified frame corners** — `_buildHolePath` přidává `quadraticCurveTo` na 4 belt-skulina shoulder rohy (R_SHOULDER=5) + 2 belt-canvas top rohy (R_TOP=5). Skulina-arch transitions (funnel) ponechány ostré (smoothing přes cp1/cp2 zkoušeno ale revertnuto kvůli vizuálním artefaktům na bandOuter miter offsetu). Carrier marks lehce světlejší (HSL L+0.05 → +0.09). |
| v73.317–336 | `42a488d` | 2026-05-17 | **Carrier marks + floor gradient + belt boxes arrow + box materials.** Carrier marks — flat rounded čtverce pod každým carrierem (i mystery), floor color + HSL L+0.05, persistuje přes level (visual stopa "tady byl carrier"). Floor gradient přes shader injection — bottom row ×1.18 lighter (gradient mix factor based on vWorldPosition.y). Belt boxes refactored pro 2 primitives (shell + arrow): shell = chrome matcap → toon material (6-band metallic gradient), arrow = darker color, neon theme má arrow emissive (0x00e8f8 glow). Box outline lighter (0x000000 → 0x303040). FPS stats panel (bottom-left) hidden v dev. Box positions tweaks Y +8, X ±13. |
| v73.304–316 | (pending) | 2026-05-17 | **3D belt overhaul.** Rollery odstraněny (schované pod boxy). Belt plane (BoxGeometry) nahrazena 14× GLB `beltPlate` plátky (InstancedMesh, outer+inner primitives jako carrier). Toon material, **alternating tint zebra** (even/odd), **subtle Y-shake** (sin jitter 0.4 px synchronized s balls), **side belt edges** (tmavé pruhy pod plates). **Theme tint** přes `refreshBeltTint()` — plates + inner + edges + boxy automaticky tintnuté podle `--carriers-3d-bg` (BLEND 18% plates, 12% boxy). Inner barva odvozená z theme-mixed plate + HSL L+0.28. |
| v73.300–303 | `4087614` → `5cd06e7` | 2026-05-17 | **3D belt boxes integration.** Nový asset `gamee/assets/3d/belt-boxes.glb` s `beltBoxL/R` objekty. `_loadBeltBoxes` loader (GLTFLoader, scale ×50, mirror fallback pokud chybí strana). **Chrome matcap material** procedurálně generovaný (`_makeChromeMatcap` — canvas s vertical gradient + spec hot spot + edge vignette). **Belt cycle expansion** — `BELT_STARTX 50→18`, `SPACING 20→24`, `TOTAL 280→336`, `LAUNCH_TRACK 130→162`. Ball range pokrývá vnitřek obou boxů → emerge/entry efekt, wrap point invisible. Visibility cull odstraněn. |
| v73.295–299 | `ff04859` → `01bba80` | 2026-05-17 | **LOW tier wave/hit OFF, particles enabled everywhere.** Po per-effect cost audit: wave (updateGrid re-write všech pixelů per frame na 0.36s) + hit bounce = největší per-destruction cost. Vypnuty na LOW. Particles (shards/flash/CA/dust) mizí ve srovnání → enabled na všech tierech. Konsensus: LOW = "shadows off + wave off + hit off". `PERF_DOWN_HOLD_MS 4→10s`. Fix freeze ball na pasu po endGame přes `_hasBottomMovement` check. updateCarriers throttle 60Hz zachován (30Hz dělalo anim trhanou). |
| v73.291–294 | `2c5e5f2` → `8c90296` | 2026-05-17 | **Performance optim cluster + bugfixy.** `updatePending` ball-ball collision O(n²) → O(n) přes spatial grid bucketing (cell 24 px, fallback < 12 balls). Crash fix: stale `N` po `pending.splice()` v substepu — N recompute per substep. updateCarriers throttle test (revertnuto v73.295). Dohrání 3D particles po endGame přes `render3d.hasActiveAnimations()` — render pokračuje dokud shards/ghosts/dust/wave dohrají. |
| v73.283–290 | `37889b7` → `a4bd2ab` | 2026-05-16 | **Velký thermal optim balíček.** **bg-canvas particles** vypnuty úplně (~0.5–1 ms/frame). **Top + bottom scéna render-on-dirty** — skip render pokud žádná animace aktivní (mark dirty na triggers + safety 1× za 60 frames). **updateCarriers DOM cache** — per-slot bbox cache, invalidate jen na resize/level/theme change (~4000 layout reads / click anim ušetřeno). **Shader pre-warm** — `renderer.compile(scene, camera)` po init → eliminuje first-use 50–200ms shader compilation jamy. **Skip drawBelt + drawPending v 3D módu** (1800 DOM ops/s — visibility:hidden ale stále paintovaly hidden canvasy). **Drift detector throttle** 60Hz → 6Hz (~27 000 ops/s ušetřeno). Plus fix konfety freezing po endGame. |
| v73.277–282 | `03f8cd1` → `79ea049` | 2026-05-16 | **Cache-busting + version watchdog + thermal opt základ.** Cache-busting přes `?v=<version>` query string na všech prod asset URLs + runtime watchdog v `game.js` co compare HTML #version-badge proti `BB_VERSION_R3D` + `BB_VERSION_R3DB` — kterýkoli mismatch → force reload. **Fix missing `render3d_bottom.js`** v prod index.html. Dev `index_local.html` cache-bust rozšířen na všechny moduly. **Quality tier system** (HIGH/MED/LOW) + auto-degrade FPS<45 / upgrade FPS>55 + sticky shadow-off pravidlo. **Pause render při overlay/pause**, idle bg-canvas pause. Revert thermal indicator (invertovaná logika). |
| v73.269–276 | `271474d` → `27b477d` | 2026-05-16 | **Outline frame fine-tuning.** Picture frame (CSS `box-shadow`) a bottom frame (`OUTLINE_W`) zjemněny z 1.5/2 na 1.3 px. Per-theme barvy outline sjednoceny — `THEME_FRAME_COLORS.outline` aktualizován aby kopíroval CSS `--image-canvas-outline` v každém tématu (pink shodný, ostatní rozladěné → vyrovnáno). `FRAME_OUTLINE_PX` (dead konstanta) odstraněn — skutečnou tloušťku řídí `OUTLINE_W` v `_rebuildUnifiedFrame`. |
| v73.264–268 | `0185c81` → `a6627ff` | 2026-05-16 | **bg-canvas particles redesign.** Nahrazení 30 hvězd dust-style additive kruhy → revert na hvězdy + canvas z-index 9000 (nad hrou) → znovu dust-style bez hvězd N=7 → menší velikost (max 1.9 px) → čistší rendering bez halo / additive blending. |
| v73.257–263 | `cf6e31c` → `adb0d27` | 2026-05-16 | **Tier system refinements.** Bg-canvas + pixelRatio napojeny na tier. Flash zapnut na MED (`if tier < 2`). Shadow downgrade na MED → revert (MED = shadows OFF, plná retina, sticky off pravidlo). LOW pixel ratio zpět na min(dpr, 1.5) (kvůli kvalitě). 5s cooldown po tier change. `MED → LOW` jen při fps ≤ 29. Fix shadow toggle artefakty (force material.needsUpdate na všech objektech ve scéně). |
| v73.249–256 | `0341df7` → `3b18f43` | 2026-05-16 | **Quality tier basics + ball shader experiment.** Stats.js dev panel re-enabled. Procedurální noise v ball shaderu (per-channel hash, per-direction drift, color tint) → user nakonec odstranil. Quality tier system implementace start (HIGH/MED/LOW, auto-degrade, pause on overlay, shadow on-demand). |
| v73.237–248 | `f933e85` → `2e90b41` | 2026-05-16 | **Ambient dust motes + ball shader noise.** Dust motes nad povrchem pixelů — spawn při destrukci, fade ~3s, občas v barvě pixelu. Per-channel chromatic drift na ball povrchu (custom shader injection do MeshToonMaterial). Pop circle 2D efekt vypnut, sphere shards místo BoxGeometry. |
| v73.229–236 | `a5c08e4` → `4abe4ad` | 2026-05-16 | **CA efekt + gradace + cleanup.** CA ghosts posun +1.5 px nahoru. CA jen při hromadném ničení → revert. CA streak/heat systém s gradací → revert → finální: CA na náhodný interval (každý 3.–5. zničený pixel). |
| v73.228 | `249125f` | 2026-05-16 | **Per-pixel chromatic aberration.** `triggerPixelCA(gx, gy, hex)` v render3d.js — spawne 2 ghost InstancedMesh planes s AdditiveBlending na destroyed pixelu: červený posunutý +4.5 px, cyan −4.5 px, fade 180 ms. Voláno z obou destroy sitů v game.js. |
| v73.227 | `a5c0faf` | 2026-05-16 | **Revert full-screen CA** (`git revert 7524945`). Full-screen efekt na #image-area nebyl to co user chtěl — žádal per-pixel efekt. |
| v73.226 | `7524945` | 2026-05-16 | Full-screen chromatic aberration na #image-area (revertnuto v 73.227). |
| v73.225 | `94f4977` | 2026-05-16 | **Impact flash + contact sparks.** `spawnImpactFlash` na 2D canvas overlay, `triggerBallContactSpark` pro pending ball kontakt se stěnami + ball-ball kolize. Glow frame dimmed. |
| v73.221 | `5728619` | 2026-05-16 | **Fix floor color — `getComputedStyle(body)`.** Theme CSS vars jsou na `body.theme-X`, `documentElement` vždy vracel pink `:root` default. `_rebuildUnifiedFrame` + `refreshFloorColor` přepnuty na `document.body`. |
| v73.220 | `d119d2f` | 2026-05-16 | **Fix bottom frame color persist.** `st._frameColorOverride` / `st._outlineColorOverride` — `_rebuildUnifiedFrame` čte state override při init materiálů, frame+outline nepřepisuje na pink. |
| v73.219 | `cdc3105` | 2026-05-16 | **Floor bg + canvas outline theme-aware.** `refreshFloorColor/refreshWallColor` voláno z `_applyThemeFrameColors`. `--image-canvas-outline` CSS var per téma, nahrazuje hardcoded `#8a5066`. |
| v73.218 | `8e6bb45` | 2026-05-16 | **Per-theme frame colors.** `THEME_FRAME_COLORS` pro 10 témat, `_applyThemeFrameColors()`, `setTheme()` rozšířen o dispatch `bb:theme-changed`, 3D lazy-init aplikují barvy po init. `debug.js`: localStorage per-téma (`bb-color-overrides-<theme>`), `reloadForTheme()` na event, reset resetuje jen aktuální téma. |
| v73.168–217 | various | 2026-05-16 | **M9 day 4+ — Cartoon polish + physics fixes + dev tools.** Wave/hit bounce stretch, pending ball squash/stretch, **fix asymetrického úniku přes _archXAtY closest endpoint**, position-aware belt sparse array load, bottom frame outline + **fix duplicate dispose**, **fix grid shift via bottom-deck reference**, mystery base #1c0410 + MeshBasicMaterial fix, dev color picker tool, shadow experiments (disabled). Viz "M9 day 4+" deep dive výš. |
| v73.167 | `c3e128b` | 2026-05-15 | **safeBottom 20 → 7** (o 2/3 menší). Po v73.166 root cause fix se algo dobře hlídá. |
| v73.166 | `dcf25e0` | 2026-05-15 | **🎯 ROOT CAUSE fix scrollbar:** algo predikuje --carriers-pad-top podle cellSize (18 px pro TARGET, 4 px pro shrunk). Tím byla 14 px discrepance mezi 4-row a 5+ row levely — algo měl WRAP_PAD_TOP=4 hardcoded, render3d_bottom._setCarriersPadTop nastavil 18 pro TARGET. Algo používá ESTIMATED_PAD=18 pro cellSize compute, pak PREDIKUJE actual pad pro shift placement. |
| v73.165 | `e4ffe33` | 2026-05-15 | Revert v73.164. |
| v73.164 | `091b734` | 2026-05-15 | Ground-truth game.height měření (revertnuto). |
| v73.158-163 | various | 2026-05-15 | Iterace safeBottom 4/8/12/20/4/12, revert experiments hledající root cause. |
| v73.151-156 | various | 2026-05-15 | Experimenty s body padding (40 vs 0), 100dvh vs visualViewport, revertnuto. |
| v73.150 | `e0f05b0` | 2026-05-15 | Revert v73.149 (fixed 4 px gap nepomohlo). |
| v73.140-149 | various | 2026-05-15 | **Anti-scroll saga:** body min-height 100vh→100dvh, overflow:hidden na #game (= bottom3d-canvas +400 buffer tail nepřispěje k document scroll), iterace safeBottom. Cíl: žádný scrollbar napříč resize range. |
| v73.139 | `2381365` | 2026-05-15 | body min-height: 100vh → 100dvh (dynamic viewport, iOS URL bar aware). |
| v73.138 | `89222e6` | 2026-05-15 | Revert anti-scroll hacků (touch-action:none, position:fixed, overflow:hidden). Pull-to-refresh musí fungovat. |
| v73.128-137 | various | 2026-05-15 | **Dev UI refactor:** floating ⚙ button (22 px, white 15% fill) + popover overlay nad funnel area (rounded, backdrop-filter blur). version badge top-left, settings top-right. .controls + #ammo-audit + safe zone toggle uvnitř overlay. Click outside / Shift+D / klik na ⚙ zavírá. Anti-scroll iterace. |
| v73.123-127 | various | 2026-05-15 | **Collider polish:** debug collider line, sliding kontakt (e=0), 40→80 segmentů arch, smoothed normály na vrcholech polyline pro plynulý sliding skrz inflection point. |
| v73.122 | `1525592` | 2026-05-15 | **Frame anchory = reálné carrier řady** (ne #carriers-wrap s paddingem). Měření z #carriers-grid. Arch končí 15 px nad první horní řadou, frame bottom pin na last row + 5 buffer. |
| v73.121 | `a316709` | 2026-05-15 | **Lock arch height na 90 px:** arenaTopCSS = min(skulinaBot+90, carriersTopCSS-15). Pro shifted carriers se vertikální stěny arény natáhnou místo deformace bezier. |
| v73.120 | `4f21207` | 2026-05-15 | **4-row slack distribution:** pro málo řad na vysokých displejích vznikalo mrtvé místo. Distribuujeme slack jako margin-top na #carriers-wrap → grid se posune dolů, frame se prodlouží. MAX_CAVITY_ABOVE = 100. |
| v73.118-119 | various | 2026-05-15 | Dev UI offsets — controls margin-top 16 px, ammo-audit + settings bar margin-top 10 px. |
| v73.116-117 | various | 2026-05-15 | Controls margin-bottom→top fixes (controls má order:100 = pod hrou). |
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

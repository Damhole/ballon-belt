const COLORS=[
  // 0–11  výchozí (původní)
  '#3dd64a','#ff7a1a','#5bc8f5','#1b9aff','#ff4fa3','#f5d800','#8b4dff','#141414','#ffffff','#e63946','#00c8a0','#8c8c8c',
  // 12–17  červené
  '#ff3b30','#c0392b','#ff6b6b','#b71c1c','#ff8a65','#bf360c',
  // 18–21  oranžové
  '#ff9800','#e65100','#ffb300','#f57c00',
  // 22–25  žluté / limetky
  '#c6e617','#76d400','#ffd600','#aeea00',
  // 26–29  zelené
  '#00c853','#1b5e20','#69f0ae','#33691e',
  // 30–33  tyrkysové / cyan
  '#00bcd4','#006064','#b2ebf2','#00e5ff',
  // 34–38  modré
  '#42a5f5','#0d47a1','#82b1ff','#1565c0','#7986cb',
  // 39–42  fialové
  '#7c4dff','#6a1b9a','#ab47bc','#ce93d8',
  // 43–46  růžové / magenta
  '#e91e63','#f48fb1','#ad1457','#ff80ab',
  // 47–50  tmavé neutrály
  '#212121','#424242','#616161','#757575',
  // 51–54  světlé neutrály
  '#bdbdbd','#e0e0e0','#fff9c4','#fce4ec',
  // 55–60  hnědé / teplé
  '#795548','#5d4037','#a1887f','#d7ccc8','#bf8040','#ffcc80',
  // 61–63  speciální
  '#ff6e40','#40c4ff','#b9f6ca',
];
const BELT_CAP=14;
const COLS=7;
const GW=36,GH=31,IMG_GH=27;
const UPC=4;
const PPU=10;

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKS (Okruh 2) — puzzle-style HP walls inside the image area
//   • shape:  'rect' | 'cross' | 'L' | 'T' | 'circle'
//   • x,y:    top-left in image pixel coords (0..GW-1 × 0..IMG_GH-1)
//   • w,h:    bounding box in image pixels
//   • color:  0..8 (index to COLORS)
//   • hp:     HP measured in PROJECTILES (PPU=10 → hp=80 means 8 balls = 2 carriers)
//
// Projectile of matching color → subtracts 1 HP. Wrong color → bounces.
// Targeting (pickTargetForColor): weighted random between pixels (w=1) and
// blocks (w=hp), so partially-damaged blocks lose priority vs fresh pixels.
// ═══════════════════════════════════════════════════════════════════════════
function blockMask(shape,w,h){
  const m=[]; for(let y=0;y<h;y++){m.push(new Array(w).fill(false));}
  if(shape==='rect'){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)m[y][x]=true;
  } else if(shape==='cross'){
    const cx=Math.floor((w-1)/2), cy=Math.floor((h-1)/2);
    const armW=Math.max(1,Math.floor(w/3)), armH=Math.max(1,Math.floor(h/3));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(Math.abs(y-cy)<=Math.floor(armH/2)) m[y][x]=true;
      if(Math.abs(x-cx)<=Math.floor(armW/2)) m[y][x]=true;
    }
  } else if(shape==='L'){
    const thick=Math.max(1,Math.floor(w/3));
    for(let y=0;y<h;y++)for(let x=0;x<thick;x++)m[y][x]=true;   // levý sloupec
    for(let y=h-thick;y<h;y++)for(let x=0;x<w;x++)m[y][x]=true; // spodní řada
  } else if(shape==='T'){
    const thick=Math.max(1,Math.floor(h/3));
    for(let y=0;y<thick;y++)for(let x=0;x<w;x++)m[y][x]=true;   // horní řada
    const stemW=Math.max(1,Math.floor(w/3));
    const stemX=Math.floor((w-stemW)/2);
    for(let y=thick;y<h;y++)for(let x=stemX;x<stemX+stemW;x++)m[y][x]=true; // noha
  } else if(shape==='circle'){
    const cx=(w-1)/2, cy=(h-1)/2, rx=w/2, ry=h/2;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const nx=(x-cx)/rx, ny=(y-cy)/ry;
      m[y][x]=(nx*nx+ny*ny)<=1.0;
    }
  }
  return m;
}

// Cover test — returns true if image pixel (gx,gy) is blocked by a live block.
function blockCoversPixel(blk,gx,gy){
  const lx=gx-blk.x, ly=gy-blk.y;
  if(lx<0||ly<0||lx>=blk.w||ly>=blk.h)return false;
  return blk._mask[ly][lx];
}

// Find the first live block whose mask contains the given image pixel (gx,gy).
// Returns block or null.
function findBlockAtPixel(gx,gy){
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(blockCoversPixel(b,gx,gy))return b;
  }
  return null;
}

// Smaže pixely pod solid blokem (grid[y][x] = -1 pro každou buňku masky).
// Volá se při zničení solid bloku — blok byl neprůhledný, takže pixely pod nejsou
// „odhalené odměnou". Mystery blok tohle nevolá (pod ním zůstávají originální pixely).
function clearPixelsUnderBlock(blk){
  for(let ly=0;ly<blk.h;ly++)for(let lx=0;lx<blk.w;lx++){
    if(!blk._mask[ly][lx])continue;
    const gx=blk.x+lx, gy=blk.y+ly;
    if(gy<0||gy>=GH||gx<0||gx>=GW)continue;
    grid[gy][gx]=-1;
  }
}

// Hydrate a level's block definitions into live runtime instances with _mask + HP.
// kind:
//   'solid'   – default. Barevný blok, trefí jen shodná barva, projektil pop-ne,
//               při zničení se pixely pod blokem smažou (blok byl neprůhledný – fér).
//   'mystery' – šedý "?" blok. Zasáhne libovolná barva, projektil se odrazí (ne pop),
//               HP -1 za zásah, při zničení se odhalí pixely pod blokem.
function hydrateBlocks(defs){
  if(!Array.isArray(defs))return [];
  return defs.map(d=>({
    kind:d.kind==='mystery'?'mystery':'solid',
    shape:d.shape||'rect',
    x:d.x|0, y:d.y|0,
    w:Math.max(1,d.w|0), h:Math.max(1,d.h|0),
    color:d.color|0,
    hp:Math.max(1,d.hp|0),
    maxHp:Math.max(1,d.hp|0),
    _mask:blockMask(d.shape||'rect',Math.max(1,d.w|0),Math.max(1,d.h|0)),
  }));
}

let currentBlocks=[];

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL REGISTRY — PRIORITY CHAIN
//   1) gamee.getLevels()    ← Gamee platform (pokud v budoucnu nabídne)
//   2) window.LEVELS        ← generováno TVÝM editorem (gamee/js/levels.js)
//   3) LEVELS_FALLBACK      ← hardcoded default v tomhle souboru (safety net)
//
// Každý level = { key, label, type, imageDifficulty, image, blocks, rocketTargets, garage }
// type:             'relaxing' | 'medium' | 'hard' | 'hardcore'
// imageDifficulty:  1..5 (hodnotí obraz: pixely + bloky + překážky)
// blocks:           pole definic blokových překážek (Okruh 2 – zatím []).
// rocketTargets:    2 color indexy pro raketové nosiče (null = level nepodporuje rakety).
// garage:           { col, carriers:[{color}] } nebo null (null = level nemá garáž).
// ═══════════════════════════════════════════════════════════════════════════
const LEVELS_FALLBACK=[
  {
    key:'smiley', label:'smajlík', type:'relaxing', imageDifficulty:1,
    image:{source:'smiley'},
    // Testovací blok (Okruh 2): růžový obdélník 8×3 pod bradou smajlíka v modrém
    // pozadí, HP 20 = 2 koule. Hráč ho musí rozbít; je mimo obraz (nekryje pixely).
    blocks:[{shape:'rect',x:14,y:24,w:8,h:3,color:4,hp:20}],
    rocketTargets:[8,7],
    garage:{col:3,carriers:[{color:3},{color:0},{color:4}]}
  },
  {
    key:'moon', label:'měsíc', type:'relaxing', imageDifficulty:1,
    image:{source:'moon'},
    blocks:[],
    rocketTargets:[8,5],
    garage:{col:4,carriers:[{color:5},{color:2},{color:6}]}
  },
  {
    key:'starwars', label:'C-3PO', type:'relaxing', imageDifficulty:1,
    image:{source:'starwars'},
    blocks:[],
    rocketTargets:[5,1],
    garage:{col:3,carriers:[{color:5},{color:1},{color:8}]}
  },
  {
    key:'frog', label:'žabka', type:'relaxing', imageDifficulty:1,
    image:{source:'frog'},
    blocks:[],
    rocketTargets:[0,7],
    garage:{col:3,carriers:[{color:0},{color:7},{color:3}]}
  },
  {
    key:'mondrian', label:'Mondrian', type:'relaxing', imageDifficulty:1,
    image:{source:'mondrian'},
    blocks:[],
    rocketTargets:null,
    garage:null
  }
];
// Zkus postupně zdroje levelů — první neprázdný vyhrává.
function resolveLevels(){
  try{
    if(typeof gamee!=='undefined'&&typeof gamee.getLevels==='function'){
      const remote=gamee.getLevels();
      if(Array.isArray(remote)&&remote.length){console.log('[levels] using gamee.getLevels() — '+remote.length+' levels');return remote;}
    }
  }catch(e){/* Gamee API chyba – ignoruj a pokračuj na další zdroj */}
  if(typeof window!=='undefined'&&Array.isArray(window.LEVELS)&&window.LEVELS.length){console.log('[levels] using window.LEVELS (editor) — '+window.LEVELS.length+' levels');return window.LEVELS;}
  console.log('[levels] using LEVELS_FALLBACK — '+LEVELS_FALLBACK.length+' levels');
  return LEVELS_FALLBACK;
}
const LEVELS=resolveLevels();
// Helper — najdi plnou definici levelu podle klíče (fallback na první level).
function getLevelDef(key){return LEVELS.find(l=>l.key===key)||LEVELS[0];}
// Default complexity pro level — respektuje designer pin (lvl.defaultComplexity).
// Fallback chain: pin → první complexity s existující variantou → 'easy'.
// Volá se při přepnutí levelu, aby hráč dostal to, co designer označil jako
// výchozí (ne to, co měl nastavené u předchozího levelu).
function resolveDefaultDifficulty(key){
  const def=getLevelDef(key);
  if(!def)return 'easy';
  const pin=def.defaultComplexity;
  const variants=Array.isArray(def.carrierLayouts)?def.carrierLayouts:[];
  const hasVariant=(d)=>variants.some(v=>v&&v.difficulty===d&&Array.isArray(v.grid)&&v.grid.length);
  if(pin&&['easy','medium','hard'].includes(pin)&&hasVariant(pin))return pin;
  for(const d of ['easy','medium','hard'])if(hasVariant(d))return d;
  return 'easy';
}
// Převod carrier difficulty stringu na 1..5 rank.
function carrierDifficultyRank(diff){return diff==='easy'?1:diff==='medium'?3:5;}
// Kombinace dvou os → celková obtížnost (label + key pro CSS třídu).
function computeTotalDifficulty(imgDiff,carrDiff){
  const total=imgDiff+carrDiff; // 2..10
  if(total<=3)return{key:'relaxing',label:'Relaxing'};
  if(total<=5)return{key:'medium',label:'Medium'};
  if(total<=7)return{key:'hard',label:'Hard'};
  return{key:'hardcore',label:'Hard-core'};
}
let grid,belt,pending,columns,score,loops,running,difficulty='easy',gravityOn=false,rocketsOn=false,garageMode='off',currentLevel='smiley';
// True když makeColumns postavil grid z `level.carrierLayouts[...]` (layout-based).
// startLevel podle toho ví, že má PŘESKOČIT rocket + garage injekci (layout už má
// rakety/garáž embedded jako tiles). False = auto-generovaný grid = injekce jede jako dřív.
let columnsFromLayout=false;
// garageMode: 'off' | 'single' (1 náhodný směr) | 'multi' (2-4 náhodné směry)
const GAR_DIR_VEC={N:[0,-1],S:[0,1],W:[-1,0],E:[1,0]};
let beltAnim=0,lastBeltTime=null;
// Limit: max 4 nosiče (= 16 koulí) v trychtýři současně. Hard block:
// pokud pending > 12, klik na nosič se ignoruje a zobrazí se varování.
const PENDING_DISPENSE_THRESHOLD=12; // > 12 → klik je odmítnut
let funnelWarnTimer=0; // vteřin do skrytí varování
let nudgeTimer=0; // periodické „pomoc uvízlé kouli" pro natural anti-stuck
// Gamee state
let paused=false, gameStarted=false, playTime=0, playTimer=null, beltLoopStarted=false;
let ammoCheckTimer=0;
// === BELT LAUNCH POINT ===
const BELT_LX=28,BELT_RX=332,BELT_BALL_R=14;
const BELT_STARTX=BELT_LX+BELT_BALL_R+8;          // 50
const BELT_ENDX=BELT_RX-BELT_BALL_R-8;            // 310
const BELT_SPACING=(BELT_ENDX-BELT_STARTX)/(BELT_CAP-1); // ~20
const BELT_TOTAL=BELT_CAP*BELT_SPACING;            // ~280
const LAUNCH_X=180;                                // střed pásu – otvor
const LAUNCH_TRACK=LAUNCH_X-BELT_STARTX;          // ~130
let noMatchPasses=0;
let stuckPassCount=0;   // kolikrát v řadě koule prošla bez konzumace (count===0)
// === POJÍZDNÝ KANON ===
let gunQueue=[];                   // fronta čekajících střel {ci,color}
let gunFireTimer=0;
const GUN_FIRE_INTERVAL=0.04;     // 40 ms mezi výstřely
const CANNON_Y=GH*10-6;           // 304 – těsně nad spodní hranou (SCALE je 10)
const CANNON_MIN_X=16;
const CANNON_MAX_X=344;
const CANNON_SPEED=560;           // px/s podél spodní hrany
const CANNON_ARRIVE_EPS=1.5;      // px – kdy se považuje za „na pozici"
const CANNON_LEAD=0.4;            // 0..1 – jak blízko pod cíl kanon dojede (nižší = víc rotace hlavně)
let cannonX=LAUNCH_X, cannonAngle=-Math.PI/2;
let cannonLock=null;              // {ci, gx, gy, idealX, angle, type} – drží vybraný cíl, aby kanon nekmital
let cannonSidePref=0;             // -1=levá polovina, 1=pravá, 0=žádná preference (přepočítat)
let cannonSideShots=0;            // počet vystřelených ran s aktuální preferencí
const CANNON_SIDE_COMMIT=15;      // po kolika ranách se kanon rozhodne přehodnotit stranu
let cannonIdleT=0;                // čas co kanon nevystřelil (watchdog proti zamrznutí queue)
let introSeq=0;                   // token pro zrušení naplánovaného intra při resetu/přepnutí levelu
// === BOUNCING PARTICLE SYSTEM ===
let particles=[],particleCanvas,particleCtx;
let shards=[];                    // odlétající střípky při zásahu – jen vizuál, nezasahují do fyziky
let confetti=[];                  // konfety na konci levelu – rozletí se, gravitace, postupně zmizí
function spawnConfetti(){
  const palette=['#ff4fa3','#f5d800','#3dd64a','#5bc8f5','#ff7a1a','#8b4dff','#ffffff','#1b9aff'];
  // Tři výbuchy z dolního okraje – střed, levá, pravá strana
  const bursts=[{x:180,y:300},{x:70,y:300},{x:290,y:300}];
  bursts.forEach((b,bi)=>{
    const n=50;
    const baseAng=-Math.PI/2+(bi===1?-0.35:bi===2?0.35:0); // mírně do stran
    for(let i=0;i<n;i++){
      const ang=baseAng+(Math.random()-0.5)*1.1;
      const spd=220+Math.random()*220;
      confetti.push({
        x:b.x+(Math.random()-0.5)*8,
        y:b.y,
        vx:Math.cos(ang)*spd+(Math.random()-0.5)*40,
        vy:Math.sin(ang)*spd,
        size:2+Math.random()*3.5,
        ratio:0.35+Math.random()*0.5,
        rot:Math.random()*Math.PI*2,
        vrot:(Math.random()-0.5)*18,
        life:0,
        maxLife:1.3+Math.random()*1.1,
        color:palette[(Math.random()*palette.length)|0],
        delay:bi*0.12+Math.random()*0.08
      });
    }
  });
}
function spawnPopShards(x,y,color){
  const n=8;
  for(let i=0;i<n;i++){
    const ang=(i/n)*Math.PI*2+(Math.random()-0.5)*0.7;
    const spd=70+Math.random()*110;
    shards.push({
      x,y,
      vx:Math.cos(ang)*spd,
      vy:Math.sin(ang)*spd-45,           // lehký impuls vzhůru, pak gravitace
      size:1.6+Math.random()*2.4,
      rot:Math.random()*Math.PI,
      vrot:(Math.random()-0.5)*12,
      life:0,
      maxLife:0.35+Math.random()*0.28,
      color
    });
  }
}

// Velký výbuch když se blok zničí: hodně shardů z každé vyplněné buňky masky,
// rychlejší + většího rozměru než běžný pop. Barva matche bloku.
function spawnBlockExplosion(blk){
  const color=COLORS[blk.color]||'#fff';
  const cells=[];
  for(let ly=0;ly<blk.h;ly++)for(let lx=0;lx<blk.w;lx++){
    if(blk._mask[ly][lx])cells.push({lx,ly});
  }
  // Shard count podle rozlohy, omezené na rozumný počet
  const perCell=Math.max(2,Math.floor(18/Math.max(1,cells.length/4)));
  for(const {lx,ly} of cells){
    const cx=(blk.x+lx)*SCALE+SCALE/2;
    const cy=(blk.y+ly)*SCALE+SCALE/2;
    for(let i=0;i<perCell;i++){
      const ang=Math.random()*Math.PI*2;
      const spd=120+Math.random()*180;
      shards.push({
        x:cx,y:cy,
        vx:Math.cos(ang)*spd,
        vy:Math.sin(ang)*spd-60,
        size:2.2+Math.random()*2.6,
        rot:Math.random()*Math.PI,
        vrot:(Math.random()-0.5)*14,
        life:0,
        maxLife:0.55+Math.random()*0.4,
        color
      });
    }
  }
}
const SCALE=10;
const PSPEED=320;
const PSPREAD=0.35;
const MAX_PER_COLOR=10;

function initParticleCanvas(){
  if(particleCanvas)return;
  particleCanvas=document.createElement('canvas');
  particleCanvas.width=360;particleCanvas.height=310;
  particleCanvas.style.cssText='position:absolute;left:0;top:0;width:360px;height:310px;pointer-events:none;z-index:2';
  document.getElementById('image-area').appendChild(particleCanvas);
  particleCtx=particleCanvas.getContext('2d');
}

// Najde nejbližší pixel dané barvy v gridu (display souřadnice)
// Pozor: ignoruje pixely pod živými bloky (projektil by je nemohl trefit).
function nearestSameColor(ci,px,py){
  let best=null,bd=Infinity;
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==ci)continue;
    if(findBlockAtPixel(x,y))continue; // skrytý pod blokem
    const tx=x*SCALE+SCALE/2,ty=y*SCALE+SCALE/2;
    const d=(tx-px)**2+(ty-py)**2;
    if(d<bd){bd=d;best={tx,ty};}
  }
  return best;
}

// Má daná barva nějaký cíl — ať už volný pixel, solid blok stejné barvy, nebo
// libovolný mystery blok (mystery přijímá libovolnou barvu)? Používá se k detekci
// "už pro mě není co trefit → pop" ve fyzice.
function hasAnyTargetForColor(ci){
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind==='mystery')return true;
    if(b.color===ci)return true;
  }
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]===ci && !findBlockAtPixel(x,y)) return true;
  }
  return false;
}
// Přísnější varianta — má barva DOSAŽITELNÝ cíl (exposed pixel v komponentě
// navázané na prázdno, nebo živý blok)? Používá se v dispatchi cannonu, aby
// se nehromadila queue na barvě, co má pixely jen uvnitř uzavřeného prostoru.
function hasReachableTargetForColor(ci){
  if(getReachableCountOfColor(grid,ci)>0) return true;
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind==='mystery')return true;
    if(b.color===ci)return true;
  }
  return false;
}

// Najde nejbližší cíl (pixel NEBO blok) dané barvy. Používá se po odrazu
// od zdi pro přesměrování + jako hlavní steering heuristika.
// Mystery blok se bere jako wildcard (libovolná barva ho může trefit).
function nearestTargetForColor(ci,px,py){
  let best=null, bd=Infinity;
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind!=='mystery'&&b.color!==ci)continue;
    const tx=(b.x+b.w/2)*SCALE, ty=(b.y+b.h/2)*SCALE;
    const d=(tx-px)**2+(ty-py)**2;
    if(d<bd){bd=d;best={tx,ty,kind:'block',ref:b};}
  }
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==ci)continue;
    if(findBlockAtPixel(x,y))continue;
    const tx=x*SCALE+SCALE/2, ty=y*SCALE+SCALE/2;
    const d=(tx-px)**2+(ty-py)**2;
    if(d<bd){bd=d;best={tx,ty,kind:'pixel'};}
  }
  return best;
}

// Weighted-random target selection pro color ci.
//   • každý pixel dané barvy (a nezakrytý blokem): weight 1
//   • každý živý solid blok dané barvy: weight = blk.hp
//   • každý živý mystery blok (libovolná barva ho trefí): weight = blk.hp
// Vrací {tx,ty,kind:'pixel'|'block',ref?} nebo null.
function pickTargetForColor(ci){
  const cands=[];
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind!=='mystery'&&b.color!==ci)continue;
    const cx=(b.x+b.w/2)*SCALE, cy=(b.y+b.h/2)*SCALE;
    cands.push({tx:cx,ty:cy,kind:'block',ref:b,w:b.hp});
  }
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==ci)continue;
    if(findBlockAtPixel(x,y))continue;
    cands.push({tx:x*SCALE+SCALE/2,ty:y*SCALE+SCALE/2,kind:'pixel',w:1});
  }
  if(!cands.length)return null;
  const total=cands.reduce((s,c)=>s+c.w,0);
  let r=Math.random()*total;
  for(const c of cands){ if((r-=c.w)<=0) return c; }
  return cands[cands.length-1];
}

// Vybere střelu pro kanon: vrátí {idealX, angle, dist, type} pro nejlepší cíl barvy ci.
// Upřednostňuje přímé zásahy, jinak zkusí odraz od levé/pravé stěny nebo stropu.
// Když nic čisté není, vrátí direct s penaltou (projektil se zkusí proflákat přes odraz).
// Zkusí najít úhel (přímý nebo odrazový), který simulací trefí cíl. Vrací {angle,type} nebo null.
function findShotFromX(idealX,cannonYPos,tx,ty,ci,targetBlock){
  const WALL_L=1,WALL_R=358,WALL_T=1;
  const MUZZLE=14;
  const tries=[];
  tries.push({type:'direct',angle:Math.atan2(ty-cannonYPos,tx-idealX)});
  {
    const t=idealX/(idealX+tx);
    const by=cannonYPos+(ty-cannonYPos)*t;
    if(by>WALL_T&&by<cannonYPos-5)
      tries.push({type:'bank-L',angle:Math.atan2(by-cannonYPos,WALL_L-idealX)});
  }
  {
    const t=(WALL_R-idealX)/((WALL_R-idealX)+(WALL_R-tx));
    const by=cannonYPos+(ty-cannonYPos)*t;
    if(by>WALL_T&&by<cannonYPos-5)
      tries.push({type:'bank-R',angle:Math.atan2(by-cannonYPos,WALL_R-idealX)});
  }
  {
    const t=cannonYPos/(cannonYPos+ty);
    const bx=idealX+(tx-idealX)*t;
    if(bx>WALL_L+5&&bx<WALL_R-5)
      tries.push({type:'bank-T',angle:Math.atan2(WALL_T-cannonYPos,bx-idealX)});
  }
  for(const tr of tries){
    const mx=idealX+Math.cos(tr.angle)*MUZZLE;
    const my=cannonYPos+Math.sin(tr.angle)*MUZZLE;
    if(simulateShotReaches(mx,my,tr.angle,ci,240,targetBlock)) return tr;
  }
  return null;
}

function pickCannonShot(ci,cannonXPos,cannonYPos){
  // Seznam (tx,ty) potenciálních cílů barvy ci: pixely + živé bloky stejné barvy.
  // Bez toho by modrá koule (ci=3) hledala pouze modré pixely a růžová koule pouze
  // růžové pixely — blok by nikdy nebyl cíl, přestože kolize na něj zasáhne.
  const exposed=getExposedPixelsOfColor(grid,ci);
  const targets=exposed.map(({x,y})=>({
    tx:x*SCALE+SCALE/2, ty:y*SCALE+SCALE/2, kind:'pixel', gx:x, gy:y
  }));
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    // Mystery blok je cíl pro libovolnou barvu; solid jen pro shodnou.
    if(b.kind!=='mystery'&&b.color!==ci)continue;
    // Aim points: střed bloku + každá EXPOSED edge cell (mask cell s alespoň
    // jedním sousedem mimo blok). Když blok vyčuhuje jen jedním pixelem zpod
    // pixelového blob-u, aim na střed je blokovaný, ale aim na ten vyčuhující
    // pixel projde čistou LoS. Pro každý aim point se vytvoří separátní
    // candidate target — findShotFromX si vybere ten, ze kterého se trefí.
    const cx=Math.floor(b.x+b.w/2), cy=Math.floor(b.y+b.h/2);
    targets.push({
      tx:(b.x+b.w/2)*SCALE, ty:(b.y+b.h/2)*SCALE,
      kind:'block', gx:cx, gy:cy, blockRef:b
    });
    if(b._mask){
      for(let ly=0;ly<b.h;ly++)for(let lx=0;lx<b.w;lx++){
        if(!b._mask[ly][lx])continue;
        // edge cell = aspoň jeden sousední (N/S/E/W) je mimo masku
        const edge=
          (ly===0||!b._mask[ly-1][lx])||
          (ly===b.h-1||!b._mask[ly+1][lx])||
          (lx===0||!b._mask[ly][lx-1])||
          (lx===b.w-1||!b._mask[ly][lx+1]);
        if(!edge)continue;
        const gx=b.x+lx, gy=b.y+ly;
        targets.push({
          tx:gx*SCALE+SCALE/2, ty:gy*SCALE+SCALE/2,
          kind:'block', gx, gy, blockRef:b
        });
      }
    }
  }
  if(!targets.length)return null;
  const candidates=[];
  for(const t of targets){
    const {tx,ty}=t;
    const rawIdeal=cannonXPos+(tx-cannonXPos)*CANNON_LEAD;
    const lerpX=Math.max(CANNON_MIN_X,Math.min(CANNON_MAX_X,rawIdeal));
    const underX=Math.max(CANNON_MIN_X,Math.min(CANNON_MAX_X,tx));
    // Zkus různé pozice kanonu – od preferované (lerp) po krajní fallbacky.
    // První pozice s úspěšnou trajektorií vyhrává.
    const positions=[lerpX,underX,CANNON_MIN_X+20,CANNON_MAX_X-20];
    let found=null;
    for(const pos of positions){
      const shot=findShotFromX(pos,cannonYPos,tx,ty,ci,t.blockRef||null);
      if(shot){found={idealX:pos,angle:shot.angle,type:shot.type};break;}
    }
    if(found){
      candidates.push({idealX:found.idealX,tx,ty,angle:found.angle,type:found.type,kind:t.kind,blockRef:t.blockRef});
    } else {
      // Skutečně žádná cesta – blokovaný fallback (použijeme jen pokud fakt nic lepšího není)
      candidates.push({idealX:lerpX,tx,ty,angle:Math.atan2(ty-cannonYPos,tx-lerpX),type:'blocked',kind:t.kind,blockRef:t.blockRef});
    }
  }
  const typeWeight={direct:0,'bank-L':1,'bank-R':1,'bank-T':2,blocked:3};
  // Kanon se „rozhoduje" po CANNON_SIDE_COMMIT ranách: zjistí, kde má víc cílů (levá/pravá
  // polovina plátna) a commitne se na tu stranu. Bez kmitání po jednom projektilu, ale
  // zároveň nezanedbá druhou stranu, když tam zbývá víc kuliček.
  const midX=(CANNON_MIN_X+CANNON_MAX_X)/2;
  const pool=candidates.filter(c=>c.type!=='blocked');
  // Žádný target s LoS → vracíme null. Dispatch rotuje queue a hledá jinou
  // barvu s LoS. Když ani jedna barva nemá LoS, spadne to na
  // pickCannonShotForceBlocked (watchdog last-resort). Dřívější blocked-pixel
  // fallback („particle fyzika si cestu najde") střílel přes zdi a particly
  // se kupily → odstraněno.
  if(!pool.length) return null;
  const active=pool;
  if(cannonSidePref===0||cannonSideShots>=CANNON_SIDE_COMMIT){
    let leftC=0,rightC=0;
    for(const c of active){
      if(c.tx<midX)leftC++;else rightC++;
    }
    if(leftC>rightC)cannonSidePref=-1;
    else if(rightC>leftC)cannonSidePref=1;
    else cannonSidePref=(cannonXPos>=midX)?-1:1;
    cannonSideShots=0;
  }
  candidates.sort((a,b)=>{
    const aB=a.type==='blocked'?1:0, bB=b.type==='blocked'?1:0;
    if(aB!==bB) return aB-bB;
    const rowA=Math.floor(a.ty/SCALE), rowB=Math.floor(b.ty/SCALE);
    if(rowA!==rowB) return rowB-rowA;
    const tw=typeWeight[a.type]-typeWeight[b.type];
    if(tw!==0) return tw;
    const aSide=a.tx<midX?-1:1;
    const bSide=b.tx<midX?-1:1;
    const aMatch=aSide===cannonSidePref?0:1;
    const bMatch=bSide===cannonSidePref?0:1;
    if(aMatch!==bMatch)return aMatch-bMatch;
    return Math.abs(a.tx-cannonXPos)-Math.abs(b.tx-cannonXPos);
  });
  return candidates[0];
}

// Watchdog last-resort: vrátí nejlepší blocked trajektorii na libovolný target
// (pixel i blok) nebo null, pokud barva nemá žádný target. Používá se, když
// normální pickCannonShot vrací null po dlouhou dobu a projektily se v gunQueue
// kupí — raději vystřelíme blocked a ať particle fyzika něco dělá, než držet
// queue zamrzlou.
function pickCannonShotForceBlocked(ci,cannonXPos,cannonYPos){
  // Force varianta — bere VŠECHNY pixely barvy (nejen exposed) + všechny bloky,
  // aby se watchdog nezaseknul když je barva zaboxovaná uvnitř blobu.
  const targets=[];
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==ci)continue;
    if(findBlockAtPixel(x,y))continue;
    targets.push({tx:x*SCALE+SCALE/2, ty:y*SCALE+SCALE/2, kind:'pixel', gx:x, gy:y});
  }
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind!=='mystery'&&b.color!==ci)continue;
    targets.push({
      tx:(b.x+b.w/2)*SCALE, ty:(b.y+b.h/2)*SCALE,
      kind:'block', gx:Math.floor(b.x+b.w/2), gy:Math.floor(b.y+b.h/2), blockRef:b
    });
  }
  if(!targets.length)return null;
  // Nejbližší target (jednoduše podle euklidovské vzdálenosti od kanonu).
  let best=null, bestD=Infinity;
  for(const t of targets){
    const d=Math.hypot(t.tx-cannonXPos, t.ty-cannonYPos);
    if(d<bestD){bestD=d; best=t;}
  }
  if(!best)return null;
  const rawIdeal=cannonXPos+(best.tx-cannonXPos)*CANNON_LEAD;
  const lerpX=Math.max(CANNON_MIN_X,Math.min(CANNON_MAX_X,rawIdeal));
  return {
    idealX:lerpX, tx:best.tx, ty:best.ty,
    angle:Math.atan2(best.ty-cannonYPos, best.tx-lerpX),
    type:'blocked', kind:best.kind, blockRef:best.blockRef||null
  };
}

function launchBouncingParticles(matching,cm,onDone){
  if(!matching.size){onDone();return;}
  particlesFlying=true;
  let popped=0,total=0;
  let done=false;
  const finish=()=>{if(done)return;done=true;particlesFlying=false;onDone();};
  const safety=setTimeout(finish,2500);
  const onPop=()=>{popped++;if(popped>=total){clearTimeout(safety);finish();}};

  for(const c of matching){
    // Spočítej kolik pixelů té barvy v gridu skutečně existuje
    let pixelCount=0;
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++)if(grid[y][x]===c)pixelCount++;
    if(pixelCount===0)continue; // žádný cíl, přeskoč
    const prev=remainingUnits[c]||0;
    const budget=cm[c]*PPU+prev;
    // Nikdy nevypusť víc projektilů než je cílů a než je MAX_PER_COLOR
    const count=Math.min(budget,MAX_PER_COLOR,pixelCount);
    // Přebytek uložit, ale taky ho ořezat na rozumný max (2× počet pixelů)
    remainingUnits[c]=Math.min(budget-count, pixelCount*2);
    for(let i=0;i<count;i++){
      total++;
      // Start ze středu pásu – spodní hrana canvasu, mírný rozptyl ±25px okolo středu
      const spawnX=155+Math.random()*50;      // 155–205px ≈ střed pásu
      const spawnY=GH*SCALE-2;               // úplný spodek canvasu (308px)
      const angle=-Math.PI/2+(Math.random()-0.5)*Math.PI*0.7; // ±63° od svislice
      particles.push({
        x:spawnX, y:spawnY,
        vx:Math.cos(angle)*PSPEED,
        vy:Math.sin(angle)*PSPEED,
        ci:c, color:COLORS[c],
        phase:'fly',
        stuckT:0,
        popR:0, popX:0, popY:0,
        onPop
      });
    }
  }
  if(total===0){clearTimeout(safety);finish();}
}

function randomFreePos(){
  // Najdi náhodnou volnou pozici kdekoliv na canvasu
  for(let a=0;a<60;a++){
    const rx=5+Math.random()*350;
    const ry=5+Math.random()*(GH*SCALE-10);
    const gx=Math.floor(rx/SCALE),gy=Math.floor(ry/SCALE);
    if(gy>=0&&gy<GH&&gx>=0&&gx<GW&&grid[gy][gx]===-1)
      return {x:rx,y:ry};
  }
  return {x:155+Math.random()*50,y:GH*SCALE-5}; // fallback
}

function respawnParticle(p){
  // Tah 5f: „chytrý escape". Když je projektil zaseknutý (lepí se na hranu
  // nepřátelského bloku / pixelu), prohledej okolí ve 24 směrech a najdi
  // nejbližší bod, odkud je volná viditelnost (LoS) na cíl. Tam otoč vektor
  // rychlosti. Projektil se prostřelí přes několik cel prázdného/vlastního
  // prostoru na pozici s čistou střelou a pak trefí cíl. Žádný teleport,
  // žádný ping-pong, žádné ničení projektilu.
  if(!hasAnyTargetForColor(p.ci)){ p.phase='pop'; p.popX=p.x; p.popY=p.y; p.onPop(); return; }
  // Tah 7: když je barva uzamčená (žádná LoS-dostupná cíl), nedělej smart
  // escape – jen rozhoď do největšího otevřeného směru, ať se odlepí.
  const losNear=losReachableTargetForColor(p.ci,p.x,p.y);
  if(!losNear){
    const DIRS=24;
    let openA=null, openLen=0;
    for(let i=0;i<DIRS;i++){
      const a=(i/DIRS)*Math.PI*2 + Math.random()*0.1;
      const dx=Math.cos(a), dy=Math.sin(a);
      let len=0;
      for(let step=1;step<=8;step++){
        const gx=Math.floor((p.x+dx*step*SCALE)/SCALE);
        const gy=Math.floor((p.y+dy*step*SCALE)/SCALE);
        if(gy<0||gy>=GH||gx<0||gx>=GW) break;
        const blk=findBlockAtPixel(gx,gy);
        if(blk&&blk.kind!=='mystery'&&blk.color!==p.ci) break;
        const cell=grid[gy]&&grid[gy][gx];
        if(cell!==undefined&&cell!==-1&&cell!==p.ci) break;
        len++;
      }
      if(len>openLen){ openLen=len; openA=a; }
    }
    if(openA!==null){
      p.vx=Math.cos(openA)*PSPEED;
      p.vy=Math.sin(openA)*PSPEED;
    }
    p.stuckT=0; p.bounceStreak=0;
    return;
  }
  const near=pickTargetForColor(p.ci)||nearestTargetForColor(p.ci,p.x,p.y);
  if(!near){ p.phase='pop'; p.popX=p.x; p.popY=p.y; p.onPop(); return; }
  // 1) Pokud z aktuální pozice vidíme cíl, namiř přímo.
  if(hasLineOfSight(p.x,p.y,near.tx,near.ty,p.ci)){
    const a=Math.atan2(near.ty-p.y,near.tx-p.x)+(Math.random()-0.5)*PSPREAD;
    p.vx=Math.cos(a)*PSPEED; p.vy=Math.sin(a)*PSPEED;
    p.stuckT=0; p.bounceStreak=0;
    return;
  }
  // 2) Prohledej 24 směrů × několik vzdáleností – najdi nejbližší bod, ze
  // kterého je LoS na cíl a cesta k němu vede přes prázdno/vlastní barvu.
  const DIRS=24;
  let bestA=null, bestDist=Infinity;
  for(let i=0;i<DIRS;i++){
    const a=(i/DIRS)*Math.PI*2;
    const dx=Math.cos(a), dy=Math.sin(a);
    for(let step=2;step<=16;step++){
      const rx=p.x+dx*step*SCALE*0.5;
      const ry=p.y+dy*step*SCALE*0.5;
      if(rx<5||rx>355||ry<5||ry>GH*SCALE-5) break;
      const gx=Math.floor(rx/SCALE), gy=Math.floor(ry/SCALE);
      if(gy<0||gy>=GH||gx<0||gx>=GW) break;
      const blk=findBlockAtPixel(gx,gy);
      if(blk&&blk.kind!=='mystery'&&blk.color!==p.ci) break;
      const cell=grid[gy]&&grid[gy][gx];
      if(cell!==undefined&&cell!==-1&&cell!==p.ci) break;
      if(hasLineOfSight(rx,ry,near.tx,near.ty,p.ci)){
        if(step<bestDist){ bestDist=step; bestA=a; }
        break;
      }
    }
  }
  if(bestA!==null){
    p.vx=Math.cos(bestA)*PSPEED;
    p.vy=Math.sin(bestA)*PSPEED;
    p.stuckT=0; p.bounceStreak=0;
    return;
  }
  // 3) Žádná escape pozice v okolí → přesměruj aspoň do největšího
  // otevřeného směru (greedy) aby se projektil pohnul. Stuck counter
  // neresetujeme – pokud to nepomůže, další respawn zkusí znovu.
  let openA=null, openLen=0;
  for(let i=0;i<DIRS;i++){
    const a=(i/DIRS)*Math.PI*2;
    const dx=Math.cos(a), dy=Math.sin(a);
    let len=0;
    for(let step=1;step<=12;step++){
      const gx=Math.floor((p.x+dx*step*SCALE)/SCALE);
      const gy=Math.floor((p.y+dy*step*SCALE)/SCALE);
      if(gy<0||gy>=GH||gx<0||gx>=GW) break;
      const blk=findBlockAtPixel(gx,gy);
      if(blk&&blk.kind!=='mystery'&&blk.color!==p.ci) break;
      const cell=grid[gy]&&grid[gy][gx];
      if(cell!==undefined&&cell!==-1&&cell!==p.ci) break;
      len++;
    }
    if(len>openLen){ openLen=len; openA=a; }
  }
  if(openA!==null){
    p.vx=Math.cos(openA)*PSPEED;
    p.vy=Math.sin(openA)*PSPEED;
    p.stuckT=0;
    // bounceStreak neresetujeme – pokud se zasekne znova, postupně
    // doroste a zkusíme další escape.
  }
}

// Odsimuluje let projektilu stejnou fyzikou jako updateParticles —
// stěny + odraz od wrong-color pixelů a non-target mystery bloků.
// Bounce cap brání ping-pongu a zároveň drží simulaci blízko reality
// (s každým odrazem roste numerická divergence vůči reálnému particlu,
// který má drobný spread na fire angle). Limit ~4 odrazů → 95%+ shoda.
function simulateShotReaches(sx,sy,angle,targetCi,maxSteps=600,targetBlock=null){
  let x=sx,y=sy;
  let vx=Math.cos(angle)*PSPEED, vy=Math.sin(angle)*PSPEED;
  const dt=1/60;
  const YMAX=GH*SCALE-2;
  let bounces=0;
  const BOUNCE_CAP=4;
  for(let s=0;s<maxSteps;s++){
    let nx=x+vx*dt, ny=y+vy*dt;
    let wallBounced=false;
    if(nx<1){nx=1; vx=Math.abs(vx); wallBounced=true;}
    else if(nx>358){nx=358; vx=-Math.abs(vx); wallBounced=true;}
    if(ny<2){ny=2; vy=Math.abs(vy); wallBounced=true;}
    else if(ny>YMAX) return false;
    const hit=firstCollisionOnPath(x,y,nx,ny,targetCi);
    if(hit){
      // Detekce: cíl trefen?
      if(hit.blk){
        if(hit.blk.kind==='mystery'){
          if(targetBlock===hit.blk) return true;
          // mystery v cestě → odraz (HP simulace neřešíme)
        } else if(hit.blk.color===targetCi){
          return true;
        }
        // wrong-color blok → odraz
      } else {
        if(hit.cell===targetCi) return true;
        // wrong-color pixel → odraz
      }
      // Odraz: flip vx/vy podle směru přechodu z prev cell do hit cell
      // (přesně jako updateParticles na řádku 1081/1119/1165).
      const prevGx=Math.floor(x/SCALE), prevGy=Math.floor(y/SCALE);
      if(prevGx!==hit.gx) vx=-vx;
      if(prevGy!==hit.gy) vy=-vy;
      if(prevGx===hit.gx&&prevGy===hit.gy){vx=-vx; vy=-vy;}
      bounces++;
      if(bounces>BOUNCE_CAP) return false;
      // Position zůstává před kolizí (jako updateParticles při bounce — nudge
      // se aplikuje až další iterací). Tím se vyhneme zaseknutí v hit cell.
      continue;
    }
    if(wallBounced){
      bounces++;
      if(bounces>BOUNCE_CAP) return false;
    }
    x=nx; y=ny;
  }
  return false;
}
function hasLineOfSight(x1,y1,x2,y2,ownColor){
  // Paprsek z (x1,y1) do (x2,y2) – vrátí false pokud kříží špatnou barvu.
  // Tah 7c: při diagonálním přechodu mezi buňkami kontroluje OBA sousední
  // rohy – pokud jsou oba blokované, paprsek tudy neprojde (žádná „corner-cut"
  // štěrbina). Tím se zabrání detekci cíle za zdivem, které má jen diagonální
  // kontakt mezi rohy bloků.
  const dx=x2-x1,dy=y2-y1;
  const steps=Math.max(4,Math.ceil(Math.sqrt(dx*dx+dy*dy)/(SCALE*0.5)));
  let lastGx=Math.floor(x1/SCALE), lastGy=Math.floor(y1/SCALE);
  const cellBlocks=(gx,gy)=>{
    if(gy<0||gy>=IMG_GH||gx<0||gx>=GW)return false;
    const blk=findBlockAtPixel(gx,gy);
    if(blk){
      if(blk.kind==='mystery')return false;
      return blk.color!==ownColor;
    }
    const cell=grid[gy][gx];
    return cell!==-1 && cell!==ownColor;
  };
  for(let s=1;s<steps;s++){
    const t=s/steps;
    const gx=Math.floor((x1+dx*t)/SCALE);
    const gy=Math.floor((y1+dy*t)/SCALE);
    if(gx===lastGx && gy===lastGy) continue;
    if(gx!==lastGx && gy!==lastGy){
      // Diagonální přechod — obě buňky u rohu musí být volné.
      if(cellBlocks(gx,lastGy) && cellBlocks(lastGx,gy)) return false;
    }
    if(cellBlocks(gx,gy)) return false;
    lastGx=gx; lastGy=gy;
  }
  return true;
}

// Vrátí nejbližší cíl barvy ci, ke kterému je z (px,py) volná LoS.
// Pokud žádný → null = „barva uzamčena", projektil má jen poletovat.
function losReachableTargetForColor(ci,px,py){
  let best=null, bd=Infinity;
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind!=='mystery'&&b.color!==ci)continue;
    const tx=(b.x+b.w/2)*SCALE, ty=(b.y+b.h/2)*SCALE;
    const d=(tx-px)**2+(ty-py)**2;
    if(d<bd && hasLineOfSight(px,py,tx,ty,ci)){bd=d;best={tx,ty,kind:'block',ref:b};}
  }
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==ci)continue;
    if(findBlockAtPixel(x,y))continue;
    const tx=x*SCALE+SCALE/2, ty=y*SCALE+SCALE/2;
    const d=(tx-px)**2+(ty-py)**2;
    if(d<bd && hasLineOfSight(px,py,tx,ty,ci)){bd=d;best={tx,ty,kind:'pixel'};}
  }
  return best;
}

function steerAfterBounce(p){
  // Tah 7: přímá LoS → namíř na cíl.
  const near=losReachableTargetForColor(p.ci,p.x,p.y);
  if(near){
    const dx=near.tx-p.x, dy=near.ty-p.y;
    const angle=Math.atan2(dy,dx)+(Math.random()-0.5)*PSPREAD;
    p.vx=Math.cos(angle)*PSPEED;
    p.vy=Math.sin(angle)*PSPEED;
    return;
  }
  // Žádný cíl barvy → jen jemně rozptyl aktuální vektor (±~16°) proti ping-pongu.
  if(!hasAnyTargetForColor(p.ci)){
    const cur=Math.atan2(p.vy,p.vx);
    const a=cur+(Math.random()-0.5)*Math.PI*0.18;
    p.vx=Math.cos(a)*PSPEED;
    p.vy=Math.sin(a)*PSPEED;
    return;
  }
  // Tah 7e: cíl existuje, ale LoS z aktuální pozice je blokovaná. Zkus najít
  // úhel, který přes odraz od zdi stejně dorazí (simulace jako u děla).
  // Když takovou trajektorii objevíme, projektil ji převezme. Když ne,
  // rozptýlíme aktuální vektor proti zamrznutí.
  const TRIES=20;
  let bestA=null, bestAlign=-Infinity;
  const curA=Math.atan2(p.vy,p.vx);
  for(let i=0;i<TRIES;i++){
    const a=Math.random()*Math.PI*2;
    if(simulateShotReaches(p.x,p.y,a,p.ci)){
      // Preferuj úhel blízký aktuálnímu směru — odraz pak vypadá přirozeně,
      // ne jako ostré teleport-přemíření.
      const align=Math.cos(a-curA);
      if(align>bestAlign){ bestAlign=align; bestA=a; }
    }
  }
  if(bestA!==null){
    p.vx=Math.cos(bestA)*PSPEED;
    p.vy=Math.sin(bestA)*PSPEED;
    return;
  }
  const a=curA+(Math.random()-0.5)*Math.PI*0.18;
  p.vx=Math.cos(a)*PSPEED;
  p.vy=Math.sin(a)*PSPEED;
}

// Tah 6: swept collision. Vrátí první buňku na cestě (x1,y1)->(x2,y2),
// která má blok nebo nenulovou barvu. Při diagonálním přechodu buněk
// zkontroluje oba sousední rohy → žádný „corner-cut" tunelem mezi bloky.
function firstCollisionOnPath(x1,y1,x2,y2,ci){
  const dx=x2-x1, dy=y2-y1;
  const dist=Math.sqrt(dx*dx+dy*dy);
  if(dist<0.5) return null;
  const steps=Math.max(4, Math.ceil(dist*2));
  let lastGx=Math.floor(x1/SCALE), lastGy=Math.floor(y1/SCALE);
  for(let s=1;s<=steps;s++){
    const t=s/steps;
    const cx=x1+dx*t, cy=y1+dy*t;
    const gx=Math.floor(cx/SCALE), gy=Math.floor(cy/SCALE);
    if(gx===lastGx && gy===lastGy) continue;
    // Diagonální přechod: corner-cut JEN když jsou OBA sousední rohy
    // blokované (jinak projektil legitimně prošel volným sousedem do cílové
    // buňky a umělé odrazení by ho vrhlo zpět do blokovaného souseda).
    if(gx!==lastGx && gy!==lastGy){
      const aX=gx, aY=lastGy, bX=lastGx, bY=gy;
      const aIn=(aY>=0&&aY<GH&&aX>=0&&aX<GW);
      const bIn=(bY>=0&&bY<GH&&bX>=0&&bX<GW);
      const blkA=aIn?findBlockAtPixel(aX,aY):null;
      const blkB=bIn?findBlockAtPixel(bX,bY):null;
      const celA=aIn?grid[aY][aX]:-1;
      const celB=bIn?grid[bY][bX]:-1;
      const blockedA=!!blkA || (celA>-1 && celA!==ci);
      const blockedB=!!blkB || (celB>-1 && celB!==ci);
      if(blockedA && blockedB){
        if(blkA) return {gx:aX, gy:aY, cx, cy, blk:blkA, cell:-1};
        if(blkB) return {gx:bX, gy:bY, cx, cy, blk:blkB, cell:-1};
        return {gx:aX, gy:aY, cx, cy, blk:null, cell:celA};
      }
    }
    if(gy>=0&&gy<GH&&gx>=0&&gx<GW){
      const blk=findBlockAtPixel(gx,gy);
      if(blk) return {gx, gy, cx, cy, blk, cell:-1};
      const cell=grid[gy][gx];
      if(cell>-1) return {gx, gy, cx, cy, blk:null, cell};
    }
    lastGx=gx; lastGy=gy;
  }
  return null;
}

function updateParticles(dt){
  for(let i=shards.length-1;i>=0;i--){
    const s=shards[i];
    s.life+=dt;
    if(s.life>=s.maxLife){shards.splice(i,1);continue;}
    s.vy+=300*dt;
    s.vx*=0.96;
    s.x+=s.vx*dt; s.y+=s.vy*dt;
    s.rot+=s.vrot*dt;
  }
  for(let i=confetti.length-1;i>=0;i--){
    const c=confetti[i];
    if(c.delay>0){c.delay-=dt;continue;}
    c.life+=dt;
    if(c.life>=c.maxLife){confetti.splice(i,1);continue;}
    c.vy+=260*dt;
    c.vx*=0.985;
    c.x+=c.vx*dt; c.y+=c.vy*dt;
    c.rot+=c.vrot*dt;
    c.vrot*=0.992;
  }
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    if(!p)continue;
    if(p.phase==='rocket'){
      p.totalT+=dt; p.trailT+=dt;
      const dx=p.tx-p.x, dy=p.ty-p.y;
      const d=Math.hypot(dx,dy);
      if(d<4||p.totalT>2.5){
        // Výbuch – vymaž pixely cílové barvy v okruhu.
        // Když v radiusu nic není (např. centroid padl mimo barvu),
        // přecíluj na nejbližší existující pixel téže barvy.
        let gxC=Math.floor(p.tx/SCALE), gyC=Math.floor(p.ty/SCALE);
        const R=5, maxDestroy=20;
        const collect=(cx,cy)=>{
          const out=[];
          for(let ry=-R;ry<=R&&out.length<maxDestroy;ry++)
            for(let rx=-R;rx<=R&&out.length<maxDestroy;rx++){
              if(rx*rx+ry*ry>R*R)continue;
              const xx=cx+rx, yy=cy+ry;
              if(xx<0||xx>=GW||yy<0||yy>=IMG_GH)continue;
              if(grid[yy][xx]===p.ci)out.push({xx,yy});
            }
          return out;
        };
        let hits=collect(gxC,gyC);
        if(!hits.length){
          const near=findNearestPixelOfColor(p.ci,gxC,gyC);
          if(near){gxC=near.gx;gyC=near.gy;p.tx=gxC*SCALE+SCALE/2;p.ty=gyC*SCALE+SCALE/2;hits=collect(gxC,gyC);}
        }
        const destroyed=hits.length;
        for(const h of hits){
          grid[h.yy][h.xx]=-1;
          spawnPopShards(h.xx*SCALE+SCALE/2,h.yy*SCALE+SCALE/2,p.color);
        }
        if(destroyed){
          drawGrid();
          score+=destroyed*10;
          document.getElementById('score').textContent=score;
          gamee.updateScore(score,playTime,'balloon-belt-v51');
        }
        // Rázová vlna
        particles.push({phase:'pop',ci:p.ci,color:p.color,popR:0,popX:p.tx,popY:p.ty,maxPopR:42,onPop:()=>{}});
        particles.splice(i,1);
        if(running&&!anyTargetLeft()){setTimeout(()=>{if(running)endGame(true);},80);}
        continue;
      }
      p.x+=dx/d*p.speed*dt;
      p.y+=dy/d*p.speed*dt;
      continue;
    }
    if(p.phase==='pop'){
      p.popR+=dt*(p.maxPopR?p.maxPopR*9:90);
      if(p.popR>(p.maxPopR||10))particles.splice(i,1);
      continue;
    }

    // Tah 5e: žádný totalT cap. Projektil žije dokud netrefí vlastní cíl
    // nebo dokud barva nemá žádný živý cíl (řeší check níže na
    // hasAnyTargetForColor). Hráč jinak ztratí projektily naprázdno a
    // nedohraje level.
    p.totalT=(p.totalT||0)+dt;

    // Udržuj konstantní rychlost (billiard – bez wobble, přímý let)
    const spd=Math.sqrt(p.vx*p.vx+p.vy*p.vy)||1;
    p.vx=p.vx/spd*PSPEED; p.vy=p.vy/spd*PSPEED;

    // Pokud pro barvu neexistuje žádný živý cíl (pixel ani blok) → pop
    if(!hasAnyTargetForColor(p.ci)){p.phase='pop';p.popX=p.x;p.popY=p.y;p.onPop();continue;}

    // Navrhovaná nová pozice
    let nx=p.x+p.vx*dt, ny=p.y+p.vy*dt;
    let wallBounced=false;

    // Odraz od stěn → po stěně nasměruj k cíli
    const YMAX=GH*SCALE-2;
    if(nx<1){nx=1;p.vx=Math.abs(p.vx);wallBounced=true;}
    if(nx>358){nx=358;p.vx=-Math.abs(p.vx);wallBounced=true;}
    if(ny<2){ny=2;p.vy=Math.abs(p.vy);wallBounced=true;}
    if(ny>YMAX){ny=YMAX;p.vy=-Math.abs(p.vy);wallBounced=true;}

    // Kontrola gridu – swept collision (Tah 6) zabrání corner-cut tunelům
    let gx, gy, cell, hitBlock;
    const hit=firstCollisionOnPath(p.x,p.y,nx,ny,p.ci);
    if(hit){
      gx=hit.gx; gy=hit.gy;
      hitBlock=hit.blk||null;
      cell=hit.cell;
      // Posuň projektil na bod kolize (nx/ny), aby odrazové směrování
      // vycházelo ze správné polohy a nespadlo do dříve přeskočené buňky.
      nx=hit.cx; ny=hit.cy;
    } else {
      gx=Math.floor(nx/SCALE); gy=Math.floor(ny/SCALE);
      cell=(gy>=0&&gy<GH&&gx>=0&&gx<GW)?grid[gy][gx]:-1;
      hitBlock=(gy>=0&&gy<GH&&gx>=0&&gx<GW)?findBlockAtPixel(gx,gy):null;
    }

    let anyBounce=wallBounced;

    if(hitBlock){
      if(hitBlock.kind==='mystery'){
        // Mystery blok: libovolná barva -1 HP, projektil se ODRAZÍ (nepop-ne).
        hitBlock.hp-=1;
        if(hitBlock.hp<=0){
          // Odhaleno! Pixely pod blokem zůstávají (blok je jen "sundáme").
          spawnBlockExplosion(hitBlock);
          currentBlocks=currentBlocks.filter(b=>b!==hitBlock);
          drawGrid();
          // Projektil pokračuje v letu za odhalenou plochu (odraz se neprovede,
          // když blok zmizel — jen přesměrujeme na nejbližší cíl své barvy).
          steerAfterBounce(p);
          p.x=nx; p.y=ny; p.stuckT=0;
        } else {
          const prevGx=Math.floor(p.x/SCALE),prevGy=Math.floor(p.y/SCALE);
          if(prevGx!==gx)p.vx=-p.vx;
          if(prevGy!==gy)p.vy=-p.vy;
          if(prevGx===gx&&prevGy===gy){p.vx=-p.vx;p.vy=-p.vy;}
          anyBounce=true;
          drawGrid(); // překreslit HP číslo
        }
      } else if(hitBlock.color===p.ci){
        // Solid blok, color match → blok utrpí 1 HP (1 projektil = 1 HP), projektil pop
        {
          const oldGx=Math.floor(p.x/SCALE), oldGy=Math.floor(p.y/SCALE);
          const steps=Math.max(1,Math.abs(gx-oldGx)+Math.abs(gy-oldGy));
          const crossed=[];
          for(let s=1;s<=steps;s++){
            const fx=p.x+(nx-p.x)*(s/steps), fy=p.y+(ny-p.y)*(s/steps);
            const cx=Math.floor(fx/SCALE), cy=Math.floor(fy/SCALE);
            const blk=findBlockAtPixel(cx,cy);
            if(blk&&blk!==hitBlock)crossed.push({cx,cy,col:blk.color,hp:blk.hp});
          }
          if(crossed.length) console.log('[BB-DEBUG] block hit CROSSED OTHER BLOCK', {ci:p.ci, from:[oldGx,oldGy], to:[gx,gy], hitCol:hitBlock.color, hitHP:hitBlock.hp, crossed});
        }
        hitBlock.hp-=1;
        p.phase='pop'; p.popX=nx; p.popY=ny; p.onPop();
        spawnPopShards(nx,ny,p.color);
        if(hitBlock.hp<=0){
          // Blok zničen → exploze + smazat pixely pod + odstranit z aktivních.
          // Solid blok byl neprůhledný → pixely pod NEZŮSTÁVAJÍ jako odměna.
          clearPixelsUnderBlock(hitBlock);
          spawnBlockExplosion(hitBlock);
          currentBlocks=currentBlocks.filter(b=>b!==hitBlock);
        }
        drawGrid();
        if(running&&!anyTargetLeft()){
          particles.forEach(q=>{if(q.phase==='fly'){q.phase='pop';q.popX=q.x;q.popY=q.y;}});
          setTimeout(()=>{if(running)endGame(true);},80);
        }
      } else {
        // Solid blok, nesprávná barva → odraz
        const prevGx=Math.floor(p.x/SCALE),prevGy=Math.floor(p.y/SCALE);
        if(prevGx!==gx)p.vx=-p.vx;
        if(prevGy!==gy)p.vy=-p.vy;
        if(prevGx===gx&&prevGy===gy){p.vx=-p.vx;p.vy=-p.vy;}
        // Tah 5g + 6c: bezpečný nudge – posuň jen pokud by cesta
        // nevrazila do dalšího bloku/pixelu (jinak zůstaň, další frame
        // to zkusí znovu s flipnutou rychlostí).
        {
          const _nx=p.x+p.vx*dt, _ny=p.y+p.vy*dt;
          if(!firstCollisionOnPath(p.x,p.y,_nx,_ny,p.ci)){ p.x=_nx; p.y=_ny; }
        }
        anyBounce=true;
        p.stuckT+=dt;
        if(p.stuckT>1.2){
          console.log('[BB-DEBUG] respawn (stuck)', {ci:p.ci, atX:p.x|0, atY:p.y|0, blockColor:hitBlock.color, blockHP:hitBlock.hp});
          respawnParticle(p);
        }
      }
    } else if(cell===p.ci){
      // Vlastní barva → znič pixel
      {
        // Diagnostika: jestli se mezi starou a novou buňkou nějaký blok
        // „přeskočil" (corner-cut / tunnel), vypíšeme to. Pokud byla jakákoli
        // buňka na cestě pokryta blokem, projektil by se měl odrazit → log.
        const oldGx=Math.floor(p.x/SCALE), oldGy=Math.floor(p.y/SCALE);
        const steps=Math.max(1,Math.abs(gx-oldGx)+Math.abs(gy-oldGy));
        const crossed=[];
        for(let s=1;s<=steps;s++){
          const fx=p.x+(nx-p.x)*(s/steps), fy=p.y+(ny-p.y)*(s/steps);
          const cx=Math.floor(fx/SCALE), cy=Math.floor(fy/SCALE);
          const blk=findBlockAtPixel(cx,cy);
          if(blk)crossed.push({cx,cy,col:blk.color,hp:blk.hp});
        }
        if(crossed.length) console.log('[BB-DEBUG] pixel destroy CROSSED BLOCK', {ci:p.ci, from:[oldGx,oldGy], to:[gx,gy], crossed});
      }
      grid[gy][gx]=-1;
      if(gravityOn)applyGravityToCol(grid,gx);
      drawGrid();
      p.phase='pop'; p.popX=nx; p.popY=ny; p.onPop();
      spawnPopShards(nx,ny,p.color);
      if(running&&!anyTargetLeft()){
        particles.forEach(q=>{if(q.phase==='fly'){q.phase='pop';q.popX=q.x;q.popY=q.y;}});
        setTimeout(()=>{if(running)endGame(true);},80);
      }
    } else if(cell>-1){
      // Špatná barva → fyzikální odraz ze strany nárazu
      const prevGx=Math.floor(p.x/SCALE),prevGy=Math.floor(p.y/SCALE);
      if(prevGx!==gx)p.vx=-p.vx;
      if(prevGy!==gy)p.vy=-p.vy;
      if(prevGx===gx&&prevGy===gy){p.vx=-p.vx;p.vy=-p.vy;}
      // Tah 5g + 6c: bezpečný nudge (viz výše).
      {
        const _nx=p.x+p.vx*dt, _ny=p.y+p.vy*dt;
        if(!firstCollisionOnPath(p.x,p.y,_nx,_ny,p.ci)){ p.x=_nx; p.y=_ny; }
      }
      anyBounce=true;
      p.stuckT+=dt;
      if(p.stuckT>1.2){respawnParticle(p);}
    } else {
      p.x=nx; p.y=ny; p.stuckT=0; p.bounceStreak=0;
    }

    // Po každém odrazu: sleduj streak a eskapuj z rohu pokud je příliš dlouhý
    if(anyBounce && p.phase==='fly'){
      p.bounceStreak=(p.bounceStreak||0)+1;
      if(p.bounceStreak>8){
        respawnParticle(p);
      } else {
        steerAfterBounce(p);
      }
    }
  }
}

function drawCannon(){
  if(!particleCtx)return;
  const ctx=particleCtx;
  // Preview barvu ukážeme jen když má front queue item DOSAŽITELNÝ cíl
  // (jinak to vypadá jako „zamrzlá střela na hlavni").
  let nextColor=null;
  if(gunQueue.length>0){
    const ci=gunQueue[0].ci;
    if(hasReachableTargetForColor(ci)) nextColor=gunQueue[0].color;
  }
  ctx.save();
  ctx.translate(cannonX,CANNON_Y);
  // Stín pod kanonem
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0,6,15,3,0,0,Math.PI*2);
  ctx.fill();
  // Podvozek (lichoběžník)
  ctx.fillStyle='#2b2d35';
  ctx.strokeStyle='#6a6e78';
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(-15,5);
  ctx.lineTo(15,5);
  ctx.lineTo(11,-3);
  ctx.lineTo(-11,-3);
  ctx.closePath();
  ctx.fill();ctx.stroke();
  // Kolečka – statická (pohyb naznačený stínem)
  ctx.fillStyle='#111';
  ctx.beginPath();ctx.arc(-9,5,2.2,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(9,5,2.2,0,Math.PI*2);ctx.fill();
  // Otočný talíř
  ctx.fillStyle='#44464f';
  ctx.beginPath();ctx.arc(0,-3,5,0,Math.PI*2);ctx.fill();
  // Hlaveň – otočená k cíli (-PI/2 = svisle nahoru)
  ctx.rotate(cannonAngle+Math.PI/2);
  ctx.fillStyle='#4d5058';
  ctx.strokeStyle='#7a7e88';
  ctx.lineWidth=1;
  ctx.fillRect(-2.6,-15,5.2,14);
  ctx.strokeRect(-2.6,-15,5.2,14);
  // Hrdlo – barevné náznak další střely
  if(nextColor){
    ctx.fillStyle=nextColor;
    ctx.beginPath();
    ctx.arc(0,-15,2.2,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.4)';
    ctx.stroke();
  }
  ctx.restore();
}
function drawParticles(){
  if(!particleCtx)return;
  particleCtx.clearRect(0,0,360,310);
  drawCannon();
  for(const p of particles){
    if(p.phase==='fly'){
      const spd=Math.sqrt(p.vx*p.vx+p.vy*p.vy)||1;
      // Stopa
      particleCtx.save();
      particleCtx.globalAlpha=0.28;
      particleCtx.beginPath();
      particleCtx.arc(p.x-p.vx/spd*10,p.y-p.vy/spd*10,3.2,0,Math.PI*2);
      particleCtx.fillStyle=p.color;particleCtx.fill();
      particleCtx.restore();
      // Balónek
      particleCtx.save();
      particleCtx.beginPath();
      particleCtx.arc(p.x,p.y,4.8,0,Math.PI*2);
      particleCtx.fillStyle=p.color;particleCtx.fill();
      particleCtx.strokeStyle='rgba(0,0,0,0.28)';particleCtx.lineWidth=1;particleCtx.stroke();
      particleCtx.beginPath();
      particleCtx.arc(p.x-1.5,p.y-1.5,1.6,0,Math.PI*2);
      particleCtx.fillStyle='rgba(255,255,255,0.5)';particleCtx.fill();
      particleCtx.restore();
    } else if(p.phase==='rocket'){
      const dx=p.tx-p.x, dy=p.ty-p.y;
      const ang=Math.atan2(dy,dx);
      // Plamenná stopa – pulzující z kouře za raketou
      const tx=p.x-Math.cos(ang)*8, ty=p.y-Math.sin(ang)*8;
      particleCtx.save();
      particleCtx.globalAlpha=0.55;
      particleCtx.beginPath();
      particleCtx.arc(tx,ty,4+Math.sin(p.totalT*40)*1.2,0,Math.PI*2);
      particleCtx.fillStyle='#ffb347';particleCtx.fill();
      particleCtx.globalAlpha=0.85;
      particleCtx.beginPath();
      particleCtx.arc(tx+Math.cos(ang)*2,ty+Math.sin(ang)*2,2.2,0,Math.PI*2);
      particleCtx.fillStyle='#fff7c2';particleCtx.fill();
      particleCtx.restore();
      // Tělo rakety
      particleCtx.save();
      particleCtx.translate(p.x,p.y);
      particleCtx.rotate(ang);
      particleCtx.fillStyle='#e8e8ee';
      particleCtx.fillRect(-5,-2.2,10,4.4);
      particleCtx.fillStyle=p.color;
      particleCtx.fillRect(2,-2.2,3,4.4);
      particleCtx.strokeStyle='rgba(0,0,0,0.45)';
      particleCtx.lineWidth=0.8;
      particleCtx.strokeRect(-5,-2.2,10,4.4);
      // Špička
      particleCtx.beginPath();
      particleCtx.moveTo(5,-2.2);particleCtx.lineTo(8,0);particleCtx.lineTo(5,2.2);particleCtx.closePath();
      particleCtx.fillStyle='#c0c4cc';particleCtx.fill();particleCtx.stroke();
      particleCtx.restore();
    } else {
      const maxR=p.maxPopR||10;
      const alpha=Math.max(0,1-p.popR/maxR);
      particleCtx.save();
      particleCtx.globalAlpha=alpha;
      particleCtx.beginPath();
      particleCtx.arc(p.popX,p.popY,p.popR,0,Math.PI*2);
      particleCtx.strokeStyle=p.color;particleCtx.lineWidth=2;particleCtx.stroke();
      // Rychlý světelný záblesk
      if(p.popR<4){
        particleCtx.globalAlpha=0.55*(1-p.popR/4);
        particleCtx.beginPath();
        particleCtx.arc(p.popX,p.popY,6+p.popR,0,Math.PI*2);
        particleCtx.fillStyle='#ffffff';particleCtx.fill();
      }
      particleCtx.restore();
    }
  }
  // Konfety – nad vším, fade podle životnosti
  for(const c of confetti){
    if(c.delay>0)continue;
    const t=c.life/c.maxLife;
    const alpha=Math.max(0,1-t*t);
    particleCtx.save();
    particleCtx.globalAlpha=alpha;
    particleCtx.translate(c.x,c.y);
    particleCtx.rotate(c.rot);
    particleCtx.fillStyle=c.color;
    const w=c.size, h=c.size*c.ratio;
    particleCtx.fillRect(-w/2,-h/2,w,h);
    particleCtx.strokeStyle='rgba(0,0,0,0.25)';
    particleCtx.lineWidth=0.6;
    particleCtx.strokeRect(-w/2,-h/2,w,h);
    particleCtx.restore();
  }
  // Střípky – vykreslí se nad particly (hezky překryjí pop ring)
  for(const s of shards){
    const t=s.life/s.maxLife;
    const alpha=Math.max(0,1-t*t);
    particleCtx.save();
    particleCtx.globalAlpha=alpha;
    particleCtx.translate(s.x,s.y);
    particleCtx.rotate(s.rot);
    particleCtx.fillStyle=s.color;
    particleCtx.fillRect(-s.size/2,-s.size/2,s.size,s.size);
    particleCtx.strokeStyle='rgba(0,0,0,0.35)';
    particleCtx.lineWidth=0.5;
    particleCtx.strokeRect(-s.size/2,-s.size/2,s.size,s.size);
    particleCtx.restore();
  }
}
function makeGridShapes(){
  const g=[];
  for(let y=0;y<IMG_GH;y++){
    const r=[];
    for(let x=0;x<GW;x++){
      if(y===IMG_GH-1){r.push(-1);continue;}
      r.push(Math.floor(y/3)%2===0?5:6);
    }
    g.push(r);
  }
  const shapes=[
    {cx:18,cy:13,rx:14,ry:11,c:1},{cx:18,cy:14,rx:10,ry:8,c:0},
    {cx:11,cy:16,rx:6,ry:5,c:3},{cx:25,cy:16,rx:6,ry:5,c:2},
    {cx:11,cy:17,rx:4,ry:3,c:4},{cx:25,cy:17,rx:4,ry:3,c:6}
  ];
  for(const s of shapes)
    for(let y=0;y<IMG_GH-1;y++)for(let x=0;x<GW;x++){
      const dx=(x-s.cx)/s.rx,dy=(y-s.cy)/s.ry;
      if(dx*dx+dy*dy<=1)g[y][x]=s.c;
    }
  return g;
}
function makeGridStripes(){
  const g=[];
  for(let y=0;y<IMG_GH;y++)g.push(new Array(GW).fill(-1));
  const cw=Math.floor(GW/3);
  const pats=[
    [{c:0,h:3},{c:3,h:2},{c:5,h:2},{c:4,h:2},{c:0,h:3},{c:3,h:2},{c:5,h:2},{c:4,h:3},{c:0,h:2},{c:6,h:3},{c:5,h:3}],
    [{c:1,h:2},{c:4,h:3},{c:6,h:2},{c:3,h:2},{c:2,h:3},{c:1,h:2},{c:4,h:3},{c:0,h:2},{c:6,h:2},{c:1,h:3},{c:4,h:3}],
    [{c:2,h:3},{c:4,h:2},{c:2,h:2},{c:0,h:3},{c:3,h:2},{c:2,h:2},{c:0,h:3},{c:4,h:2},{c:2,h:3},{c:0,h:3},{c:3,h:2}]
  ];
  for(let col=0;col<3;col++){
    const xs=col*cw,xe=col===2?GW:xs+cw;
    let y=0;
    for(const s of pats[col]){
      for(let dy=0;dy<s.h&&y<IMG_GH-1;dy++,y++)
        for(let x=xs;x<xe;x++)g[y][x]=s.c;
      if(y>=IMG_GH-1)break;
    }
  }
  return g;
}
function makeGridMix(){
  const g=makeGridStripes();
  for(let y=Math.floor(IMG_GH*0.55);y<IMG_GH-1;y++)for(let x=0;x<GW;x++)g[y][x]=5;
  const shapes=[
    {cx:8,cy:21,rx:5,ry:3,c:1},{cx:18,cy:22,rx:5,ry:3,c:0},
    {cx:28,cy:21,rx:5,ry:3,c:3},{cx:13,cy:23,rx:3,ry:2,c:4},{cx:23,cy:23,rx:3,ry:2,c:6}
  ];
  for(const s of shapes)
    for(let y=0;y<IMG_GH-1;y++)for(let x=0;x<GW;x++){
      const dx=(x-s.cx)/s.rx,dy=(y-s.cy)/s.ry;
      if(dx*dx+dy*dy<=1)g[y][x]=s.c;
    }
  return g;
}
function makeGridSmiley(variant){
  // variant: 'final' (default) | 'neutral' (straight mouth, obě oči) | 'wink' (úsměv + zavřené pravé oko)
  variant=variant||'final';
  // Barvy: 0 zelená, 1 oranžová, 2 světlomodrá, 3 modrá, 4 růžová, 5 žlutá, 6 fialová, 7 černá, 8 bílá
  const BG=3, SKIN=5, OUTL=7, BLUSH=4, EYEW=8, TONG=8;
  const g=new Array(IMG_GH);
  for(let y=0;y<IMG_GH;y++)g[y]=new Array(GW).fill(BG);
  const cx=17.5, cy=12.5, R=11.2, r=10.2;
  // Tvář – žlutá výplň s černou konturou
  for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
    const d=Math.hypot(x-cx,y-cy);
    if(d<=R){g[y][x]=(d>=r)?OUTL:SKIN;}
  }
  // Duhový paprskový rámeček v rozích (ať to vypadá hot)
  const rays=[
    {cx:2,cy:2,c:1},{cx:33,cy:2,c:0},
    {cx:2,cy:24,c:6},{cx:33,cy:24,c:4}
  ];
  for(const s of rays)for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
    const d=Math.hypot(x-s.cx,y-s.cy);
    if(d<=2.2&&g[y][x]===BG)g[y][x]=s.c;
  }
  // Oči – černý kroužek s bílým highlightem, pravé lze zavřít (wink)
  const eyes=[{x:13,y:10},{x:22,y:10}];
  for(let i=0;i<eyes.length;i++){
    const e=eyes[i];
    const closed=(variant==='wink'&&i===1);
    if(closed){
      for(let xx=e.x-2;xx<=e.x+2;xx++)if(xx>=0&&xx<GW)g[e.y][xx]=OUTL;
      g[e.y-1][e.x-2]=OUTL;g[e.y-1][e.x+2]=OUTL;
    } else {
      for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
        const d=Math.hypot(x-e.x,y-e.y);
        if(d<=2.4)g[y][x]=OUTL;
      }
      for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
        const d=Math.hypot(x-(e.x-0.6),y-(e.y-0.6));
        if(d<=0.9)g[y][x]=EYEW;
      }
    }
  }
  // Tvářičky – růžové skvrny jen přes žlutou kůži
  for(const c of [{x:9,y:14},{x:26,y:14}])
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const dx=x-c.x,dy=(y-c.y)*1.3;
      if(dx*dx+dy*dy<=3.2&&g[y][x]===SKIN)g[y][x]=BLUSH;
    }
  // Pusa – pro 'neutral' rovná linka, jinak úsměv s bílým „zubem"
  if(variant==='neutral'){
    for(let xx=14;xx<=21;xx++)if(g[16][xx]===SKIN)g[16][xx]=OUTL;
  } else {
    const mcx=17.5, mcy=14.2, mR=6.0, mr=4.9;
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const dx=(x-mcx), dy=(y-mcy)*1.25;
      const d=Math.hypot(dx,dy);
      if(y>=mcy&&d<=mR&&g[y][x]===SKIN){
        if(d>=mr)g[y][x]=OUTL;
        else if(y>=mcy+1.2)g[y][x]=TONG;
      }
    }
  }
  return g;
}
function makeGridMoon(variant){
  // variant: 'empty'|'moon'|'plusses'|'stars'|'final'|'twinkle-a'|'twinkle-b' (default 'final')
  variant=variant||'final';
  const BG=6, CRES=2, DARK=7, STAR=8, PLUS=5;
  const g=new Array(IMG_GH);
  for(let y=0;y<IMG_GH;y++)g[y]=new Array(GW).fill(BG);
  const hasMoon=variant!=='empty';
  const hasPlusses=variant==='plusses'||variant==='stars'||variant==='final'||variant==='twinkle-a'||variant==='twinkle-b';
  const hasStars=variant==='stars'||variant==='final'||variant==='twinkle-a'||variant==='twinkle-b';
  if(hasMoon){
    const cx=18.5, cy=13.5, R=10.4, off=4.2;
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const d1=Math.hypot(x-cx,y-cy);
      const d2=Math.hypot(x-(cx+off),y-cy);
      if(d1<=R)g[y][x]=(d2<=R)?DARK:CRES;
    }
  }
  const plusses=[{x:6,y:6},{x:33,y:12},{x:5,y:17},{x:28,y:1},{x:14,y:25},{x:32,y:25},{x:2,y:25}];
  if(hasPlusses)for(const p of plusses){
    const cells=[{x:p.x,y:p.y},{x:p.x-1,y:p.y},{x:p.x+1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1}];
    for(const q of cells){
      if(q.x>=0&&q.x<GW&&q.y>=0&&q.y<IMG_GH&&g[q.y][q.x]===BG)g[q.y][q.x]=PLUS;
    }
  }
  const bgStars=[{x:3,y:2},{x:7,y:1},{x:31,y:3},{x:33,y:7},{x:2,y:11},{x:34,y:14},{x:4,y:22},{x:31,y:22},{x:10,y:25},{x:26,y:25},{x:1,y:17},{x:16,y:0}];
  const innerStars=[{x:19,y:9},{x:22,y:12},{x:24,y:9},{x:18,y:17},{x:24,y:17},{x:21,y:15}];
  if(hasStars){
    for(const s of bgStars)if(g[s.y]&&g[s.y][s.x]===BG)g[s.y][s.x]=STAR;
    for(const s of innerStars)if(g[s.y]&&g[s.y][s.x]===DARK)g[s.y][s.x]=STAR;
  }
  // Zablikání – některé hvězdičky dočasně nažloutlé
  if(variant==='twinkle-a'||variant==='twinkle-b'){
    const setA=[{x:7,y:1},{x:33,y:7},{x:19,y:9},{x:24,y:17},{x:10,y:25}];
    const setB=[{x:3,y:2},{x:34,y:14},{x:22,y:12},{x:18,y:17},{x:1,y:17},{x:31,y:22}];
    const twinkle=variant==='twinkle-a'?setA:setB;
    for(const s of twinkle)if(g[s.y]&&g[s.y][s.x]===STAR)g[s.y][s.x]=PLUS;
  }
  return g;
}
function makeGridC3PO(variant){
  // C-3PO – zlatá robotí hlava se dvěma kulatými očima a mřížkou pusy,
  // na tmavém mozaikovém pozadí.
  // varianty: 'final' (default), 'ha-open' – otevřená pusa pro smích.
  variant=variant||'final';
  const BG=7, GOLD=5, SHADOW=1, EYE=1, DARK=7, WHITE=8;
  const g=[];
  for(let y=0;y<IMG_GH;y++)g.push(new Array(GW).fill(BG));
  // Barevné střípky v pozadí (mozaika)
  const speckles=[
    [1,1,2],[4,2,4],[7,0,6],[11,2,0],[29,1,3],[32,2,6],[34,0,2],[27,3,4],
    [2,5,4],[34,5,0],[1,8,6],[33,7,3],[0,12,4],[35,10,6],[1,15,0],[34,13,2],
    [0,18,3],[35,17,4],[2,21,6],[33,22,0],[5,25,2],[30,25,6],[15,26,3],[22,26,4],
    [10,25,0],[25,26,2],[1,25,4],[34,25,3],[8,20,6],[27,20,2]
  ];
  for(const [x,y,c] of speckles)if(x>=0&&x<GW&&y>=0&&y<IMG_GH)g[y][x]=c;
  // Hlava – protažený ovál
  const cx=17.5, cy=11, rx=9.5, ry=10;
  for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
    const dx=(x-cx)/rx, dy=(y-cy)/ry;
    if(dx*dx+dy*dy<=1)g[y][x]=GOLD;
  }
  // Krk – lichoběžník pod hlavou
  for(let y=20;y<=25;y++){
    const w=7-Math.floor((y-20)/2);
    for(let x=Math.floor(cx-w);x<=Math.ceil(cx+w);x++){
      if(x>=0&&x<GW)g[y][x]=(y>=24)?SHADOW:GOLD;
    }
  }
  // Hrany hlavy – stín (oranžová), nejdřív detekuj, pak obarvi
  const edge=[];
  for(let y=0;y<IMG_GH;y++){
    edge.push([]);
    for(let x=0;x<GW;x++){
      let e=false;
      if(g[y][x]===GOLD){
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
          const nx=x+dx, ny=y+dy;
          if(nx<0||nx>=GW||ny<0||ny>=IMG_GH||g[ny][nx]!==GOLD){e=true;break;}
        }
      }
      edge[y].push(e);
    }
  }
  for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++)if(edge[y][x])g[y][x]=SHADOW;
  // Oči – tmavý kruh s oranžovým zářícím středem
  const eyes=[{x:13,y:10},{x:22,y:10}];
  for(const e of eyes){
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const d=Math.hypot(dx,dy);
      if(d<=2.3){
        const nx=e.x+dx, ny=e.y+dy;
        if(nx>=0&&nx<GW&&ny>=0&&ny<IMG_GH)g[ny][nx]=DARK;
      }
    }
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const d=Math.hypot(dx,dy);
      if(d<=1.2){
        const nx=e.x+dx, ny=e.y+dy;
        if(nx>=0&&nx<GW&&ny>=0&&ny<IMG_GH)g[ny][nx]=EYE;
      }
    }
    // Bílý odlesk
    g[e.y-1][e.x]=WHITE;
  }
  // Nos – svislá linka mezi očima
  for(let y=12;y<=15;y++)if(g[y]&&g[y][17]===GOLD)g[y][17]=SHADOW;
  if(variant==='ha-open'){
    // Mechanické otevření – čelist sjede dolů o 2 řádky.
    // Horní ret zůstává, mezi ním a mřížkou se objeví tmavá mezera.
    for(let x=11;x<=24;x++){
      if(g[16]&&g[16][x]===GOLD)g[16][x]=SHADOW; // horní ret
    }
    for(let y=17;y<=18;y++)for(let x=12;x<=23;x++){
      if(g[y]&&g[y][x]!==BG)g[y][x]=DARK;        // tmavá mezera v ústech
    }
    for(let x=12;x<=23;x++){
      for(let y=19;y<=20;y++){
        if(g[y]&&g[y][x]!==BG)g[y][x]=(x%2===0?DARK:GOLD); // přesunutá mřížka
      }
    }
    for(let x=11;x<=24;x++){
      if(g[21]&&g[21][x]===GOLD)g[21][x]=SHADOW; // dolní ret o 2 níž
    }
  } else {
    // Ústa – mřížka se svislými tmavými pruhy
    for(let x=12;x<=23;x++){
      for(let y=17;y<=18;y++){
        if(g[y]&&g[y][x]!==BG)g[y][x]=(x%2===0?DARK:GOLD);
      }
    }
    // Horní a spodní lem pusy
    for(let x=11;x<=24;x++){
      if(g[16]&&(g[16][x]===GOLD))g[16][x]=SHADOW;
      if(g[19]&&(g[19][x]===GOLD))g[19][x]=SHADOW;
    }
  }
  // Uši / výstupky po stranách hlavy
  for(let dy=-1;dy<=1;dy++){
    if(g[11+dy])g[11+dy][6]=SHADOW;
    if(g[11+dy])g[11+dy][29]=SHADOW;
  }
  return g;
}
function makeGridFrog(variant, yOff){
  // Žabka (Keroppi-styl) vynořující se z vody. Hlava = široký ovál, nahoře
  // dvě vyčnívající oční bulvy. yOff posune tělo dolů → postupné vynoření.
  variant=variant||'final';
  yOff=yOff||0;
  const BG=8, GREEN=0, OUT=7, WATER=2, WATER_D=3, PINK=4, WHITE=8;
  const g=[];
  for(let y=0;y<IMG_GH;y++)g.push(new Array(GW).fill(BG));
  // Voda
  const wcx=18, wcy=21, wrx=16, wry=5, WATER_Y=18;
  for(let y=17;y<IMG_GH;y++)for(let x=0;x<GW;x++){
    const dx=(x-wcx)/wrx, dy=(y-wcy)/wry;
    if(dx*dx+dy*dy<=1)g[y][x]=WATER;
  }
  for(let y=17;y<IMG_GH;y++)for(let x=0;x<GW;x++){
    const dx=(x-wcx)/wrx, dy=(y-wcy)/wry;
    const r=dx*dx+dy*dy;
    if(r>0.78&&r<=1&&g[y][x]===WATER)g[y][x]=WATER_D;
  }
  if(variant==='water-only')return g;
  // Hlava – široký plochý ovál
  const headCX=18, headCY=13+yOff, headRX=11, headRY=5.6;
  // Oční bulvy – dva kruhy nad hlavou
  const eyeLCX=12, eyeRCX=24, eyeCY=7+yOff, eyeR=3.8;
  const isHead=(x,y)=>{
    const dx=(x-headCX)/headRX, dy=(y-headCY)/headRY;
    return dx*dx+dy*dy<=1;
  };
  const isEye=(x,y)=>{
    const dl=(x-eyeLCX)*(x-eyeLCX)+(y-eyeCY)*(y-eyeCY);
    if(dl<=eyeR*eyeR)return true;
    const dr=(x-eyeRCX)*(x-eyeRCX)+(y-eyeCY)*(y-eyeCY);
    return dr<=eyeR*eyeR;
  };
  const cells=new Set();
  for(let y=0;y<WATER_Y;y++)for(let x=0;x<GW;x++){
    if(isHead(x,y)||isEye(x,y)){
      g[y][x]=GREEN;
      cells.add(y*GW+x);
    }
  }
  // Kontura proti pozadí (ne proti vodě)
  const edges=[];
  for(let y=0;y<IMG_GH;y++){
    const row=[];
    for(let x=0;x<GW;x++){
      let e=false;
      if(cells.has(y*GW+x)){
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
          const nx=x+dx, ny=y+dy;
          if(nx<0||nx>=GW||ny<0||ny>=IMG_GH){e=true;break;}
          if(!cells.has(ny*GW+nx)&&g[ny][nx]===BG){e=true;break;}
        }
      }
      row.push(e);
    }
    edges.push(row);
  }
  for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++)if(edges[y][x])g[y][x]=OUT;
  const paint=(y,x,c,onlyIfBody)=>{
    if(y<0||y>=WATER_Y||x<0||x>=GW)return;
    if(onlyIfBody&&g[y][x]!==GREEN&&g[y][x]!==OUT)return;
    g[y][x]=c;
  };
  // Bílky očí – vnitřek bulvy
  const innerR=eyeR-1.0;
  for(let y=0;y<WATER_Y;y++)for(let x=0;x<GW;x++){
    const dl=(x-eyeLCX)*(x-eyeLCX)+(y-eyeCY)*(y-eyeCY);
    if(dl<=innerR*innerR&&cells.has(y*GW+x))g[y][x]=WHITE;
    const dr=(x-eyeRCX)*(x-eyeRCX)+(y-eyeCY)*(y-eyeCY);
    if(dr<=innerR*innerR&&cells.has(y*GW+x))g[y][x]=WHITE;
  }
  // Zornice – velké černé kruhy se světlým odleskem
  const pupilR=1.9;
  const pupY=eyeCY+0.4;
  for(let y=0;y<WATER_Y;y++)for(let x=0;x<GW;x++){
    const dl=Math.hypot(x-eyeLCX,y-pupY);
    if(dl<=pupilR&&cells.has(y*GW+x))g[y][x]=OUT;
    const dr=Math.hypot(x-eyeRCX,y-pupY);
    if(dr<=pupilR&&cells.has(y*GW+x))g[y][x]=OUT;
  }
  // Odlesky
  paint(Math.round(pupY-1), eyeLCX, WHITE);
  paint(Math.round(pupY-1), eyeRCX, WHITE);
  // Tvářičky – růžové skvrny po stranách hlavy
  const cheekY=headCY+2;
  for(const ccx of [8,28]){
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(dx*dx+dy*dy<=2){
        const yy=cheekY+dy, xx=ccx+dx;
        if(yy>=0&&yy<WATER_Y&&xx>=0&&xx<GW&&g[yy][xx]===GREEN)g[yy][xx]=PINK;
      }
    }
  }
  // Úsměv – nízký oblouček pod očima
  const mouthY=headCY+2;
  paint(mouthY+1,16,OUT,true);
  paint(mouthY+1,17,OUT,true);
  paint(mouthY+1,18,OUT,true);
  paint(mouthY+1,19,OUT,true);
  paint(mouthY,15,OUT,true);
  paint(mouthY,20,OUT,true);
  return g;
}
function makeGridMondrian(){
  // Mondrian – komplexní kompozice s více bloky (inspirováno Composition with Large Red Plane)
  // Barvy: 1=červená, 3=modrá, 5=žlutá, 7=černá, 8=bílá
  const BL=7,WH=8,RE=1,BU=3,YE=5;
  const g=[];
  for(let y=0;y<IMG_GH;y++)g.push(new Array(GW).fill(-1));
  const fill=(x0,y0,x1,y1,c)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)g[y][x]=c;};

  // Vnější rám (2px)
  fill(0,0,35,1,BL); fill(0,25,35,26,BL);
  fill(0,0,1,26,BL); fill(34,0,35,26,BL);

  // Žluté proužky nahoře a dole
  fill(2,2,33,3,YE);
  fill(2,23,33,24,YE);

  // Černé linky
  fill(0,4,35,5,BL);      // H0 plná (pod horním žlutým)
  fill(10,0,11,26,BL);    // V1 plná (~28% zleva)
  fill(24,0,25,26,BL);    // V2 plná (~67% zleva)
  fill(10,13,35,14,BL);   // H1 částečná (vpravo od V1)
  fill(0,18,25,19,BL);    // H2 částečná (vlevo od V2)
  fill(17,4,18,14,BL);    // V3 částečná (střední sekce, jen horní část)
  fill(29,13,30,26,BL);   // V4 částečná (pravá sekce, jen dolní část)

  // Barevné bloky
  fill(2,6,9,17,BU);      // velká modrá vlevo nahoře
  fill(2,20,9,22,WH);     // bílá vlevo dole
  fill(12,6,16,12,RE);    // červená střed-vlevo nahoře
  fill(19,6,23,12,WH);    // bílá střed-vpravo nahoře
  fill(12,15,23,17,WH);   // bílá střed (mezi H1 a H2)
  fill(12,20,23,22,RE);   // červená střed dole
  fill(26,6,33,12,WH);    // bílá vpravo nahoře
  fill(26,15,28,22,BU);   // modrá vpravo-dole vlevo od V4
  fill(31,15,33,22,WH);   // bílá vpravo-dole vpravo od V4
  return g;
}
// Generuje grid z uživatelských pixel dat (image.source === 'custom').
// pixels = 2D array rozměru IMG_GH × GW, hodnoty -1..8 (případně null/undefined → -1).
function makeGridCustom(pixels){
  const g=[];
  for(let y=0;y<IMG_GH;y++){
    const row=new Array(GW).fill(-1);
    if(Array.isArray(pixels)&&Array.isArray(pixels[y])){
      for(let x=0;x<GW;x++){
        const v=pixels[y][x];
        row[x]=(Number.isInteger(v)&&v>=0&&v<COLORS.length)?v:-1;
      }
    }
    g.push(row);
  }
  return g;
}
function makeGrid(){
  // Výběr generátoru: primárně podle image.source z level definition (data-driven),
  // fallback na currentLevel key (zpětná kompatibilita, když level nemá image.source).
  const def=(typeof getLevelDef==='function')?getLevelDef(currentLevel):null;
  const src=(def&&def.image&&def.image.source)||currentLevel;
  let g;
  if(src==='custom')g=makeGridCustom(def&&def.image&&def.image.pixels);
  else if(src==='moon')g=makeGridMoon();
  else if(src==='starwars')g=makeGridC3PO();
  else if(src==='frog')g=makeGridFrog();
  else if(src==='mondrian')g=makeGridMondrian();
  else g=makeGridSmiley();
  // 4 prázdné řady dole (buffer zóna)
  for(let i=0;i<4;i++)g.push(new Array(GW).fill(-1));
  return g;
}
function countPixels(g){
  const c=new Array(COLORS.length).fill(0);
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++)if(g[y][x]>=0)c[g[y][x]]++;
  return c;
}
// Počet projektilů potřebných pro level: pixely v gridu + HP živých bloků.
// Pixely pod solid blokem už v gridu neexistují (vyčistí se při startu levelu,
// viz clearSolidBlockFootprints v startLevel), takže countPixels nepřidá jejich
// barvy do c. Pod mystery blokem pixely zůstávají a jsou správně započítány
// (mystery se po zničení pouze sundá).
//
// HP bloků:
//   • solid: HP se přičte k barvě bloku (jen ta barva ho může zničit)
//   • mystery: HP se rozdělí mezi existující barvy pixelů proporcionálně
//     (mystery přijímá libovolnou barvu)
function countPixelsAndBlocks(g){
  const c=countPixels(g);
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind==='mystery'){
      const totalPx=c.reduce((a,v)=>a+v,0);
      if(totalPx>0){
        for(let i=0;i<c.length;i++)if(c[i]>0) c[i]+=Math.ceil(b.hp*(c[i]/totalPx));
      } else {
        c[0]=(c[0]||0)+b.hp;
      }
    } else {
      c[b.color]=(c[b.color]||0)+b.hp;
    }
  }
  return c;
}
function colorDepth(g){
  const d=new Array(COLORS.length).fill(0),cnt=new Array(COLORS.length).fill(0);
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    const c=g[y][x];if(c<0)continue;
    d[c]+=Math.min(x,GW-1-x,y,GH-1-y);cnt[c]++;
  }
  return d.map((v,i)=>cnt[i]?v/cnt[i]:0);
}
function progressionLayers(g){
  // Simuluje postupné odkrývání obrazu. Layer 0 = barvy dostupné od začátku (na obvodu),
  // layer 1 = barvy dostupné po vyčištění layer 0, atd. Používá se pro hard-mode
  // ordering: needed (nízký layer) → hluboko, non-critical (vysoký layer) → nahoru.
  const layers={};
  const g2=g.map(r=>r.slice());
  let layer=0;
  while(layer<20){
    const avail=getAvailableColors(g2);
    if(!avail.size)break;
    for(const c of avail)if(!(c in layers))layers[c]=layer;
    for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
      if(avail.has(g2[y][x]))g2[y][x]=-1;
    }
    layer++;
  }
  return layers;
}
function getOpenEmptyCells(g){
  const open=new Set();
  const stack=[];
  const push=(x,y)=>{
    const k=y*GW+x;
    if(open.has(k))return;
    if(g[y][x]!==-1)return;
    open.add(k);stack.push([x,y]);
  };
  for(let x=0;x<GW;x++)push(x,GH-1);
  while(stack.length){
    const [x,y]=stack.pop();
    if(x>0)push(x-1,y);
    if(x<GW-1)push(x+1,y);
    if(y>0)push(x,y-1);
    if(y<GH-1)push(x,y+1);
  }
  return open;
}
function getReachableCountOfColor(g,color){
  // Vrátí počet pixelů v souvislých komponentách, které mají aspoň 1 přímo vystavený pixel.
  // Projektily dokážou kaskádově zničit celou komponentu, jakmile se dostanou k jednomu vystavenému.
  const open=getOpenEmptyCells(g);
  const reachable=new Set();
  const stack=[];
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(g[y][x]!==color)continue;
    let exp=false;
    if(y>0&&open.has((y-1)*GW+x))exp=true;
    else if(y<GH-1&&open.has((y+1)*GW+x))exp=true;
    else if(x>0&&open.has(y*GW+(x-1)))exp=true;
    else if(x<GW-1&&open.has(y*GW+(x+1)))exp=true;
    if(exp){
      const k=y*GW+x;
      if(!reachable.has(k)){reachable.add(k);stack.push([x,y]);}
    }
  }
  while(stack.length){
    const [x,y]=stack.pop();
    for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
      if(nx<0||nx>=GW||ny<0||ny>=GH)continue;
      const k=ny*GW+nx;
      if(reachable.has(k))continue;
      if(g[ny][nx]!==color)continue;
      reachable.add(k);
      stack.push([nx,ny]);
    }
  }
  return reachable.size;
}
function getExposedPixelsOfColor(g,color){
  const open=getOpenEmptyCells(g);
  const out=[];
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(g[y][x]!==color)continue;
    // Pixel pod živým blokem není dosažitelný — projektil by se odrazil od bloku.
    if(findBlockAtPixel(x,y))continue;
    let exp=false;
    if(y>0&&open.has((y-1)*GW+x))exp=true;
    else if(y<GH-1&&open.has((y+1)*GW+x))exp=true;
    else if(x>0&&open.has(y*GW+(x-1)))exp=true;
    else if(x<GW-1&&open.has(y*GW+(x+1)))exp=true;
    if(exp)out.push({x,y});
  }
  return out;
}
function getAvailableColors(g){
  const open=getOpenEmptyCells(g);
  const s=new Set();
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    const c=g[y][x];
    if(c===-1||s.has(c))continue;
    let exp=false;
    if(y>0&&open.has((y-1)*GW+x))exp=true;
    else if(y<GH-1&&open.has((y+1)*GW+x))exp=true;
    else if(x>0&&open.has(y*GW+(x-1)))exp=true;
    else if(x<GW-1&&open.has(y*GW+(x+1)))exp=true;
    if(exp)s.add(c);
  }
  // Bloky jsou externí cíle nad obrazem — barva živého bloku je vždy dostupná.
  // Mystery blok přijímá libovolnou barvu → přidáme všechny barvy.
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    if(b.kind==='mystery'){for(let k=0;k<COLORS.length;k++)s.add(k);break;}
    s.add(b.color);
  }
  return s;
}
function anyLeft(g){
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++)if(g[y][x]!==-1)return true;
  return false;
}
// Zbývá nějaký cíl k dokončení obrazu – pixel NEBO živý blok.
// Používá se pro detekci "hra hotova". Samotný anyLeft(grid) nestačí, protože
// hráč může mít zničit ještě zbývající bloky i když grid je prázdný.
function anyTargetLeft(){
  if(currentBlocks.some(b=>b.hp>0))return true;
  return anyLeft(grid);
}
function applyGravityTo(g){
  for(let x=0;x<GW;x++) applyGravityToCol(g,x);
}
function applyGravityToCol(g,col){
  const px=[];
  for(let y=0;y<IMG_GH-1;y++)if(g[y][col]!==-1)px.push(g[y][col]);
  for(let y=0;y<IMG_GH-1;y++){
    const fb=(IMG_GH-2)-y;
    g[y][col]=fb<px.length?px[px.length-1-fb]:-1;
  }
}

function isHoneycombSolvable(startGrid,cols){
  // Simulates honeycomb play: each step picks any currently-active carrier
  // (top row or any with a null neighbor) whose color maximally reduces remaining pixels.
  // If nothing helpful is active, digs the active carrier that unlocks the most new neighbors.
  const g=startGrid.map(r=>r.slice());
  const C=cols.map(col=>col.slice());
  function active(c,r){
    if(c<0||c>=COLS||r<0)return false;
    const col=C[c];if(!col||r>=col.length)return false;
    const slot=col[r];if(!slot||slot.wall||slot.type==='garage')return false;
    if(r===0)return true;
    if(col[r-1]===null)return true;
    if(r+1<col.length&&col[r+1]===null)return true;
    if(c>0){const lc=C[c-1];if(lc&&r<lc.length&&lc[r]===null)return true;}
    if(c+1<COLS){const rc=C[c+1];if(rc&&r<rc.length&&rc[r]===null)return true;}
    return false;
  }
  function listActive(){
    const a=[];
    for(let c=0;c<COLS;c++)for(let r=0;r<C[c].length;r++)if(active(c,r))a.push([c,r]);
    return a;
  }
  function applyColor(color,proj){
    let td=proj;
    while(td>0){
      const exp=getExposedPixelsOfColor(g,color);
      if(!exp.length)break;
      exp.sort((a,b)=>b.y-a.y);
      const take=Math.min(td,exp.length);
      for(let i=0;i<take;i++)g[exp[i].y][exp[i].x]=-1;
      td-=take;
      if(gravityOn)applyGravityTo(g);
    }
  }
  let safeguard=500;
  while(anyLeft(g)&&safeguard-->0){
    const act=listActive();
    if(!act.length)return false;
    const avail=getAvailableColors(g);
    let best=-1,bestGain=-1;
    for(let i=0;i<act.length;i++){
      const [c,r]=act[i];
      const color=C[c][r].color;
      if(!avail.has(color))continue;
      const gain=getExposedPixelsOfColor(g,color).length;
      if(gain>bestGain){bestGain=gain;best=i;}
    }
    if(best<0){
      // žádný aktivní nosič nepomůže → kopeme, vyber ten jehož odstranění odhalí nejvíc (neboli má nejvíc nenull slotů jako souseda)
      let bi=0,bd=-1;
      for(let i=0;i<act.length;i++){
        const [c,r]=act[i];
        let d=0;
        const n=[[c,r+1],[c-1,r],[c+1,r]];
        for(const [nc,nr] of n){
          if(nc<0||nc>=COLS||nr<0)continue;
          const nc2=C[nc];if(!nc2||nr>=nc2.length)continue;
          const s=nc2[nr];if(s&&!s.wall&&s.type!=='garage')d++;
        }
        if(d>bd){bd=d;bi=i;}
      }
      best=bi;
    }
    const [bc,br]=act[best];
    const slot=C[bc][br];
    applyColor(slot.color,slot.projectiles);
    C[bc][br]=null;
  }
  return !anyLeft(g);
}
function isLevelSolvable(startGrid,carrierQueue){
  const g=startGrid.map(r=>r.slice());
  const remaining={};
  const queue=carrierQueue.slice();
  let safeguard=10000;
  while(anyLeft(g)&&safeguard-->0){
    if(!queue.length){
      let any=false;
      for(const c in remaining){
        if(remaining[c]>0){
          const exp=getExposedPixelsOfColor(g,Number(c));
          if(exp.length){
            const take=Math.min(remaining[c],exp.length);
            exp.sort((a,b)=>b.y-a.y);
            for(let i=0;i<take;i++)g[exp[i].y][exp[i].x]=-1;
            remaining[c]-=take;
            if(gravityOn)applyGravityTo(g);
            any=true;
          }
        }
      }
      if(!any)return false;
      continue;
    }
    const slot=queue.shift();
    const color=slot.color;
    remaining[color]=(remaining[color]||0)+slot.projectiles;
    const avail=getAvailableColors(g);
    for(const c of avail){
      if((remaining[c]||0)<=0)continue;
      let td=remaining[c];
      while(td>0){
        const exp=getExposedPixelsOfColor(g,c);
        if(!exp.length)break;
        exp.sort((a,b)=>b.y-a.y);
        const take=Math.min(td,exp.length);
        for(let i=0;i<take;i++)g[exp[i].y][exp[i].x]=-1;
        td-=take;
      }
      remaining[c]=td>0?td:0;
      if(gravityOn)applyGravityTo(g);
    }
  }
  return !anyLeft(g);
}
function distributeProjectiles(total){
  const base=Math.floor(total/UPC);
  const extra=total%UPC;
  const balls=[];
  for(let i=0;i<UPC;i++)balls.push(base+(i<extra?1:0));
  return balls;
}
function splitIntoCarriers(color,total){
  const full=UPC*PPU;
  const out=[];
  const fullCount=Math.floor(total/full);
  const remainder=total%full;
  for(let i=0;i<fullCount;i++)out.push({color,projectiles:full});
  if(remainder>0){
    if(remainder<3&&out.length>0)out[out.length-1].projectiles+=remainder;
    else out.push({color,projectiles:remainder});
  }
  return out;
}
function generateCarrierQueue(pxCounts){
  const q=[];
  for(let c=0;c<pxCounts.length;c++){
    if(!pxCounts[c])continue;
    for(const slot of splitIntoCarriers(c,pxCounts[c]))q.push(slot);
  }
  return q;
}
// ═══════════════════════════════════════════════════════════════════════════
// CARRIER LAYOUTS (manuální designer grid) — Okruh XL
//   level.carrierLayouts = [
//     { name, difficulty: 'easy'|'medium'|'hard', grid: [[tile,...],...] }
//   ]
//   tile = null | {type:'carrier',color:0..8} | {type:'wall'}
//        | {type:'garage', queue:[{color},...]} | {type:'rocket', color:0..8}
// Layout přebírá KONTROLU nad topologií gridu včetně garage/rocket — když je
// layout použit, startLevel PŘESKOČÍ vlastní garage + rocket injekci.
// ═══════════════════════════════════════════════════════════════════════════
function pickLayoutVariant(levelDef,diff){
  const all=levelDef&&Array.isArray(levelDef.carrierLayouts)?levelDef.carrierLayouts:null;
  if(!all||!all.length)return null;
  const candidates=all.filter(v=>v&&v.difficulty===diff&&Array.isArray(v.grid)&&v.grid.length);
  if(!candidates.length)return null;
  return candidates[Math.floor(Math.random()*candidates.length)];
}
function buildColsFromLayout(layout,pxCounts){
  // 1) Zjistíme kolik carrier slotů layout má PER barvu.
  //    Počítáme JAK hlavní carrier tiles, TAK carriers v garážní queue — obojí
  //    reprezentuje "slot", který během hry vystřelí projektily. Dřív se queue
  //    ignorovala a level končil se zbytkem v garáži (bug pre-v29).
  const layoutColorDemand=new Array(COLORS.length).fill(0);
  const rows=layout.grid.length;
  for(let r=0;r<rows;r++){
    const row=layout.grid[r]||[];
    for(let c=0;c<COLS;c++){
      const t=row[c];
      if(!t)continue;
      if(t.type==='carrier'&&typeof t.color==='number'){
        layoutColorDemand[t.color]++;
      } else if(t.type==='garage'&&Array.isArray(t.queue)){
        for(const gc of t.queue){
          if(gc&&typeof gc.color==='number')layoutColorDemand[gc.color]++;
        }
      }
    }
  }
  // 2) Postavíme per-color fronty projektilů — rozdělíme pxCounts[c] na tolik chunků
  //    kolik layout nabízí slotů barvy c. Když layout nemá žádný slot dané barvy
  //    a barva má pxCounts[c]>0, je to chyba levelu — warning a fallback na 1 chunk.
  const colorChunks={};
  for(let c=0;c<COLORS.length;c++){
    const total=pxCounts[c]||0;
    if(!total)continue;
    const slots=layoutColorDemand[c];
    if(!slots){
      const reason='barva '+c+' má '+total+' px, ale layout nemá žádný carrier slot té barvy';
      console.warn('[layout] '+reason+' — padne na auto-gen fallback');
      try{
        if(window.parent&&window.parent!==window){
          window.parent.postMessage({
            type:'balloonbelt:layout-fallback',
            levelKey:currentLevel,
            difficulty:difficulty,
            layoutName:(layout&&layout.name)||null,
            reason:reason,
          },'*');
        }
      }catch(e){}
      return null; // celé přepne na auto-gen
    }
    // Rovnoměrné rozdělení: base + remainder do prvních slotů.
    const base=Math.floor(total/slots);
    const rem=total%slots;
    const chunks=[];
    for(let i=0;i<slots;i++)chunks.push(base+(i<rem?1:0));
    colorChunks[c]=chunks;
  }
  // 3) Stavba columns z layoutu — row-major průchod, pop chunk per carrier slot.
  const cols=[];for(let c=0;c<COLS;c++)cols.push([]);
  const hr=difficulty==='easy'?0:difficulty==='hard'?0.8:0.45;
  for(let r=0;r<rows;r++){
    const row=layout.grid[r]||[];
    for(let c=0;c<COLS;c++){
      const t=row[c];
      if(!t){cols[c].push(null);continue;}
      if(t.type==='wall'||t.wall){cols[c].push({wall:true});continue;}
      if(t.type==='rocket'){
        cols[c].push({type:'rocket',color:(t.color|0)});
        continue;
      }
      if(t.type==='garage'){
        // Directions spočítáme až v postprocessu (potřebujeme vědět sousedy).
        // Každý queue item dostane svou porci projektilů z colorChunks — stejné pravidlo
        // jako hlavní carrier slot. Při prázdných chunkech (designer dal barvu, kterou
        // level nepotřebuje) fallback na UPC*PPU, aby garáž aspoň něco dispensla.
        const queue=Array.isArray(t.queue)?t.queue.map(x=>{
          const col=(x&&typeof x.color==='number')?x.color:(x|0);
          const chunks=colorChunks[col];
          const proj=(chunks&&chunks.length)?chunks.shift():UPC*PPU;
          return {color:col,projectiles:proj};
        }):[];
        cols[c].push({type:'garage',directions:['N'],queue,_pendingDirs:true});
        continue;
      }
      if(t.type==='carrier'){
        const col=t.color|0;
        const chunks=colorChunks[col];
        if(chunks&&chunks.length){
          const proj=chunks.shift();
          // Explicitní editor override: t.hidden === true/false vyhraje nad random.
          // Když editor nic nenastavil (undefined), fallback na difficulty-based random.
          const hidden=(t.hidden===true)?true:(t.hidden===false)?false:(r>0&&Math.random()<hr);
          cols[c].push({color:col,hidden,projectiles:proj});
        } else {
          // Designer dal slot barvy, která v tomto levelu nic nepotřebuje → wall.
          cols[c].push({wall:true});
        }
        continue;
      }
      // Neznámý tile → null (safe default).
      cols[c].push(null);
    }
  }
  // 4) Kontrola: všechny chunky spotřebovány? Když ne, layout má málo slotů dané barvy
  //    (editor by to měl chytit, tady jen warn a pokračuj).
  for(const c in colorChunks){
    if(colorChunks[c].length){
      console.warn('[layout] barva '+c+' má ještě '+colorChunks[c].length+' nespotřebovaných chunků — layout poddimenzovaný');
    }
  }
  // 5) Post-process: garáž directions. Single/multi výběr ze validních sousedů.
  for(let c=0;c<COLS;c++){
    for(let r=0;r<cols[c].length;r++){
      const s=cols[c][r];
      if(!s||s.type!=='garage'||!s._pendingDirs)continue;
      delete s._pendingDirs;
      if(garageMode==='off'){
        // Garage v layoutu, ale mode off → převeď na wall (nebude dispensovat, chová se pasivně).
        cols[c][r]={wall:true};
        continue;
      }
      const validDirs=[];
      for(const d of Object.keys(GAR_DIR_VEC)){
        const [dc,dr]=GAR_DIR_VEC[d];
        const nc=c+dc,nr=r+dr;
        if(nc<0||nc>=COLS||nr<0)continue;
        const ncol=cols[nc];
        if(!ncol||nr>=ncol.length)continue;
        const n=ncol[nr];
        if(n&&(n.wall||n.type==='garage'))continue;
        validDirs.push(d);
      }
      if(!validDirs.length){
        // Žádný validní směr — garáž nemůže dispensovat. Nech jako garage (queue visí), aby bylo vidět.
        s.directions=[];
      } else if(garageMode==='single'){
        s.directions=[validDirs[Math.floor(Math.random()*validDirs.length)]];
      } else {
        const want=2+Math.floor(Math.random()*3);
        const shuffled=validDirs.slice().sort(()=>Math.random()-0.5);
        s.directions=shuffled.slice(0,Math.min(want,shuffled.length));
      }
    }
  }
  return cols;
}

function makeColumns(pxCounts){
  columnsFromLayout=false;
  // 1) Preferuj manuální layout (když existuje pro aktuální obtížnost).
  const levelDef=getLevelDef(currentLevel);
  const layout=pickLayoutVariant(levelDef,difficulty);
  if(layout){
    const built=buildColsFromLayout(layout,pxCounts);
    if(built){
      columnsFromLayout=true;
      console.log('[layout] using carrier layout "'+(layout.name||'?')+'" ('+layout.difficulty+') for level '+currentLevel);
      try{
        if(window.parent&&window.parent!==window){
          window.parent.postMessage({
            type:'balloonbelt:layout-applied',
            levelKey:currentLevel,
            difficulty:difficulty,
            layoutName:layout.name||null,
          },'*');
        }
      }catch(e){}
      return built;
    }
    // buildColsFromLayout vrátil null → spadne na auto-gen pod námi.
    console.warn('[layout] layout build failed, falling back to auto-gen');
  }
  // 2) Auto-gen (původní cesta).
  const depth=colorDepth(grid);
  const avail=getAvailableColors(grid);
  let q=generateCarrierQueue(pxCounts);
  const originalQ=q.slice();
  let attempts=0;
  let ok=false;
  let bestQ=q.slice();
  while(attempts<20){
    attempts++;
    q=originalQ.slice();
    if(difficulty==='easy'){
      q.sort((a,b)=>{
        const av=avail.has(a.color)?0:1,bv=avail.has(b.color)?0:1;
        return av!==bv?av-bv:depth[a.color]-depth[b.color];
      });
      for(let i=q.length-1;i>0;i--){
        const j=Math.max(0,Math.min(q.length-1,i+Math.floor((Math.random()-0.5)*3)));
        [q[i],q[j]]=[q[j],q[i]];
      }
    } else if(difficulty==='hard'){
      // Honeycomb Hard: progression layer určuje hloubku. Obraz se čistí bottom-up, carriers
      // kopeme top-down → chronologie se shoduje:
      //   layer 0 (dostupné v obraze od začátku = potřeba hned) → TOP rows, viditelné
      //   layer 1+ (postupně potřeba později) → DEEP rows, skryté pod `?`
      // Hráč při kopání narazí na `?` a musí hádat, která chodba skrývá právě potřebnou barvu
      // pro aktuální progresi — může se splést (odkryje layer 2 barvu když potřeba layer 1).
      const layers=progressionLayers(grid);
      // Sort ASC podle layeru → low-layer první = top rows.
      q.sort((a,b)=>{
        const la=layers[a.color]??99, lb=layers[b.color]??99;
        if(la!==lb)return la-lb;
        return Math.random()-0.5;
      });
      // Round-robin po barvách v RÁMCI stejného layer bucketu → stejné barvy se nelepí do klastru,
      // hráč má v každém sloupci šanci na různé barvy stejné vrstvy.
      const buckets={};
      for(const s of q){const l=layers[s.color]??99;(buckets[l]=buckets[l]||[]).push(s);}
      const sortedLayers=Object.keys(buckets).map(Number).sort((a,b)=>a-b);
      const reordered=[];
      for(const l of sortedLayers)reordered.push(...distributeForVariety(buckets[l]));
      q=reordered;
    } else {
      for(let i=q.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[q[i],q[j]]=[q[j],q[i]];}
    }
    const candidate=buildColsFromQueue(q);
    if(isHoneycombSolvable(grid,candidate)){return candidate;}
    bestQ=q.slice();
  }
  // Žádný safety-net fallback — počet nosičů odpovídá přesně pxCounts.
  // Pokud by žádný z 20 pokusů nebyl solvable, vrátíme poslední kandidát
  // (solvability check je greedy → může být konzervativní).
  return buildColsFromQueue(bestQ);
}
const MAX_ROWS=7;
function distributeForVariety(q){
  // Round-robin podle barev → vedle sebe (v row-major fillu) nebudou stejné barvy.
  // Rozbíjí monolitní klastry nejhojnější barvy (typicky pozadí) v top row.
  const byColor={};
  for(const s of q){(byColor[s.color]=byColor[s.color]||[]).push(s);}
  const keys=Object.keys(byColor).sort((a,b)=>byColor[b].length-byColor[a].length);
  const out=[];
  while(out.length<q.length){
    let progressed=false;
    for(const k of keys){
      if(byColor[k].length){out.push(byColor[k].shift());progressed=true;if(out.length===q.length)break;}
    }
    if(!progressed)break;
  }
  return out;
}
function bfsAllReachable(rows,wallSet){
  // Každá non-wall buňka musí být dosažitelná ortogonálně z top row (r=0).
  // Zdi v runtime nikdy nezmizí, takže statická dosažitelnost = garance že
  // každý nosič půjde odkopat.
  const visited=new Set();
  const queue=[];
  for(let c=0;c<COLS;c++){
    const key=c; // r=0
    if(!wallSet.has(key)){visited.add(key);queue.push([c,0]);}
  }
  if(!visited.size)return false;
  while(queue.length){
    const [c,r]=queue.shift();
    const n=[[c,r-1],[c,r+1],[c-1,r],[c+1,r]];
    for(const [nc,nr] of n){
      if(nc<0||nc>=COLS||nr<0||nr>=rows)continue;
      const key=nr*COLS+nc;
      if(visited.has(key)||wallSet.has(key))continue;
      visited.add(key);
      queue.push([nc,nr]);
    }
  }
  for(let r=0;r<rows;r++)for(let c=0;c<COLS;c++){
    const key=r*COLS+c;
    if(!wallSet.has(key)&&!visited.has(key))return false;
  }
  return true;
}
function validateColumnsReachable(cols){
  // BFS na finálním stavu columns (po případné garáž-injekci). Každý reálný nosič
  // (ne wall, ne garáž) musí být dosažitelný z top row přes non-blocker cesty.
  // Blocker = out-of-bounds, {wall:true}, {type:'garage'}. null = hole (connector).
  const N=COLS;
  const isBlocker=(c,r)=>{
    if(c<0||c>=N||r<0)return true;
    const col=cols[c];
    if(!col||r>=col.length)return true;
    const s=col[r];
    if(s===null)return false;
    return !!s.wall||s.type==='garage';
  };
  const visited=new Set();
  const queue=[];
  for(let c=0;c<N;c++){
    if(cols[c].length&&!isBlocker(c,0)){visited.add(c);queue.push([c,0]);}
  }
  while(queue.length){
    const [c,r]=queue.shift();
    for(const [dc,dr] of [[0,-1],[0,1],[-1,0],[1,0]]){
      const nc=c+dc,nr=r+dr;
      if(isBlocker(nc,nr))continue;
      const k=nr*N+nc;
      if(visited.has(k))continue;
      visited.add(k);queue.push([nc,nr]);
    }
  }
  for(let c=0;c<N;c++){
    for(let r=0;r<cols[c].length;r++){
      const s=cols[c][r];
      if(!s||s.wall||s.type==='garage')continue;
      if(!visited.has(r*N+c))return false;
    }
  }
  return true;
}
function placeWallsWithStrategy(rows,wallsNeeded,sortFn){
  // Greedy placement s BFS-kontrolou connectivity na každém kroku.
  // Fallback bottom-up zajistí, že doplníme požadovaný počet zdí (pokud to topologie dovolí).
  const candidates=[];
  for(let r=0;r<rows;r++)for(let c=0;c<COLS;c++)candidates.push({c,r});
  sortFn(candidates);
  const wallSet=new Set();
  let placed=0;
  for(const {c,r} of candidates){
    if(placed>=wallsNeeded)break;
    const key=r*COLS+c;
    wallSet.add(key);
    if(!bfsAllReachable(rows,wallSet)){wallSet.delete(key);continue;}
    placed++;
  }
  if(placed<wallsNeeded){
    for(let r=rows-1;r>=0&&placed<wallsNeeded;r--){
      for(let c=COLS-1;c>=0&&placed<wallsNeeded;c--){
        const key=r*COLS+c;
        if(wallSet.has(key))continue;
        wallSet.add(key);
        if(!bfsAllReachable(rows,wallSet)){wallSet.delete(key);continue;}
        placed++;
      }
    }
  }
  return wallSet;
}
function countBranchPoints(rows,wallSet){
  // Rozcestí = buňka s ≥3 non-wall sousedy. Víc rozcestí = víc rozhodovacích bodů pro hráče.
  let junctions=0;
  for(let r=0;r<rows;r++)for(let c=0;c<COLS;c++){
    if(wallSet.has(r*COLS+c))continue;
    let open=0;
    for(const [dc,dr] of [[0,-1],[0,1],[-1,0],[1,0]]){
      const nc=c+dc,nr=r+dr;
      if(nc<0||nc>=COLS||nr<0||nr>=rows)continue;
      if(!wallSet.has(nr*COLS+nc))open++;
    }
    if(open>=3)junctions++;
  }
  return junctions;
}
function buildColsFromQueue(q){
  // Grid velikost = ceil(q.length/COLS) řádků (cap MAX_ROWS). Zbytek slotů
  // doplníme zdmi `{wall:true}` s BFS kontrolou dosažitelnosti — každý nosič
  // musí mít non-wall cestu na top row, jinak by byl "trapped".
  const hr=difficulty==='easy'?0:difficulty==='hard'?0.8:0.45;
  const maxSlots=COLS*MAX_ROWS;
  const qUsed=q.length>maxSlots?q.slice(0,maxSlots):q;
  // Velikost gridu (rows) jde za obtížností, ne za počtem nosičů:
  //   easy   → přesně tolik řádků kolik nosičů vyžaduje (minimum zdí, rovná cesta)
  //   medium → o 1 řádek víc (trocha zdí = variace)
  //   hard   → o 3 řádky víc (maze s víc rozcestími)
  const baseRows=Math.max(1,Math.ceil(qUsed.length/COLS));
  const extra=difficulty==='hard'?3:difficulty==='medium'?1:0;
  const rows=Math.min(MAX_ROWS,baseRows+extra);
  const totalSlots=rows*COLS;
  const wallsNeeded=Math.max(0,totalSlots-qUsed.length);
  let wallSet;
  if(difficulty==='easy'){
    // Easy: zdi na spodek (padding).
    wallSet=placeWallsWithStrategy(rows,wallsNeeded,(a)=>a.sort((x,y)=>(y.r-x.r)||(Math.random()-0.5)));
  } else if(difficulty==='hard'){
    // Hard: multi-candidate scoring — generuj K random layoutů, vyber ten s nejvíc rozcestími.
    // Dává hráči víc rozhodovacích bodů, kterou chodbou kopat za needed barvou.
    let best=null, bestScore=-1;
    for(let trial=0;trial<12;trial++){
      const ws=placeWallsWithStrategy(rows,wallsNeeded,(a)=>a.sort(()=>Math.random()-0.5));
      if(ws.size<wallsNeeded)continue;
      const score=countBranchPoints(rows,ws);
      if(score>bestScore){bestScore=score;best=ws;}
    }
    wallSet=best||placeWallsWithStrategy(rows,wallsNeeded,(a)=>a.sort(()=>Math.random()-0.5));
  } else {
    wallSet=placeWallsWithStrategy(rows,wallsNeeded,(a)=>a.sort(()=>Math.random()-0.5));
  }
  // Pokud by pořád zbývaly "díry" (nemělo by nastat), extra nosiči je truncate.
  const effectiveCarriers=totalSlots-wallSet.size;
  // Hard už má layered+rozptýlené ordering z makeColumns → nepřemíchávat, jinak by se ztratilo progression-based hloubkové umístění needed barev.
  const carrierQ=qUsed;
  const finalQ=carrierQ.length>effectiveCarriers?carrierQ.slice(0,effectiveCarriers):carrierQ;
  const cols=[];for(let c=0;c<COLS;c++)cols.push([]);
  let qi=0;
  for(let r=0;r<rows;r++){
    for(let c=0;c<COLS;c++){
      const key=r*COLS+c;
      if(wallSet.has(key)){
        cols[c].push({wall:true});
      } else if(qi<finalQ.length){
        const hidden=r>0&&Math.random()<hr;
        const src=finalQ[qi++];
        cols[c].push({color:src.color,hidden,projectiles:src.projectiles});
      } else {
        cols[c].push({wall:true});
      }
    }
  }
  return cols;
}
function shadeHex(hex,amt){
  // amt v (-1..1): záporná ztmaví, kladná zesvětlí
  const h=hex.replace('#','');
  const r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16);
  const f=c=>Math.max(0,Math.min(255,Math.round(c+(amt<0?c*amt:(255-c)*amt))));
  return 'rgb('+f(r)+','+f(g)+','+f(b)+')';
}
const _shadeCache={};
function shadeCached(hex,amt){
  const k=hex+'|'+amt;
  return _shadeCache[k]||(_shadeCache[k]=shadeHex(hex,amt));
}
// Sprite každé barvy = 10x10 bead s lesklým highlightem vlevo nahoře a stínem vpravo dole.
// Mezi buňkami zůstává 2px mezera (průhledný rámeček), takže prosvítá tmavé pozadí = mřížka.
const _beadSpriteCache={};
function getBeadSprite(color){
  if(_beadSpriteCache[color])return _beadSpriteCache[color];
  const cv=document.createElement('canvas');
  cv.width=SCALE;cv.height=SCALE;
  const c=cv.getContext('2d');
  const s=SCALE-0.2, r=1;           // téměř bez mezery – separace hlavně tmavým gradientem
  c.beginPath();
  c.moveTo(r,0);
  c.lineTo(s-r,0);
  c.quadraticCurveTo(s,0,s,r);
  c.lineTo(s,s-r);
  c.quadraticCurveTo(s,s,s-r,s);
  c.lineTo(r,s);
  c.quadraticCurveTo(0,s,0,s-r);
  c.lineTo(0,r);
  c.quadraticCurveTo(0,0,r,0);
  c.closePath();
  c.fillStyle=color;c.fill();
  c.globalCompositeOperation='source-atop';
  const lg=c.createLinearGradient(0,0,s,s);
  lg.addColorStop(0,'rgba(255,255,255,0.14)');
  lg.addColorStop(0.55,'rgba(255,255,255,0)');
  lg.addColorStop(1,'rgba(0,0,0,0.35)');
  c.fillStyle=lg;c.fillRect(0,0,SCALE,SCALE);
  const rg=c.createRadialGradient(2.2,2.2,0.2,2.2,2.2,2.8);
  rg.addColorStop(0,'rgba(255,255,255,0.38)');
  rg.addColorStop(0.55,'rgba(255,255,255,0.08)');
  rg.addColorStop(1,'rgba(255,255,255,0)');
  c.fillStyle=rg;c.fillRect(0,0,SCALE,SCALE);
  c.globalCompositeOperation='source-over';
  _beadSpriteCache[color]=cv;
  return cv;
}
function drawGrid(){
  const cv=document.getElementById('pixel-canvas');
  const ctx=cv.getContext('2d');
  const W=GW*SCALE, H=GH*SCALE;
  ctx.clearRect(0,0,W,H);
  // Vržené stíny na prázdný prostor pod tvary (hloubkový efekt)
  for(let y=0;y<GH-1;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==-1&&grid[y+1][x]===-1){
      const px=x*SCALE, py=(y+1)*SCALE;
      ctx.fillStyle='rgba(0,0,0,0.4)';
      ctx.fillRect(px+1,py,SCALE-1,3);
      ctx.fillStyle='rgba(0,0,0,0.2)';
      ctx.fillRect(px+1,py+3,SCALE-1,2);
    }
  }
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    const c=grid[y][x];
    if(c===-1)continue;
    ctx.drawImage(getBeadSprite(COLORS[c]), x*SCALE, y*SCALE);
  }
  drawBlocks(ctx);
}

// Bloky se kreslí nad pixely – jsou "nad" obrazem, hráč je musí zničit
// než se dostane k pixelům pod nimi. HP progress = opacity/saturace.
function drawBlocks(ctx){
  // Vržené stíny bloků (pod spodní hranu bloku, jen kde dole není ani pixel
  // ani jiný blok) — aby byly bloky „nad povrchem" jako pixely.
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    for(let ly=0;ly<b.h;ly++)for(let lx=0;lx<b.w;lx++){
      if(!b._mask[ly][lx])continue;
      // jen spodní okraj tvaru
      if(ly+1<b.h && b._mask[ly+1][lx]) continue;
      const gx=b.x+lx, gy=b.y+ly+1;
      if(gy>=GH) continue;
      // co je v buňce pod? pixel nebo blok → stín neřešíme (stacking)
      const hasPix=(gx>=0&&gx<GW)?(grid[gy][gx]!==-1):false;
      if(hasPix) continue;
      const blkBelow=findBlockAtPixel(gx,gy);
      if(blkBelow && blkBelow.hp>0) continue;
      const px=gx*SCALE, py=gy*SCALE;
      ctx.fillStyle='rgba(0,0,0,0.4)';
      ctx.fillRect(px+1,py,SCALE-1,3);
      ctx.fillStyle='rgba(0,0,0,0.2)';
      ctx.fillRect(px+1,py+3,SCALE-1,2);
    }
  }
  for(const b of currentBlocks){
    if(b.hp<=0)continue;
    const isMystery=b.kind==='mystery';
    const fill=isMystery?'#555a62':(COLORS[b.color]||'#888');
    // Solid barva bez vzoru — jeden fill na celý tvar.
    ctx.fillStyle=fill;
    for(let ly=0;ly<b.h;ly++)for(let lx=0;lx<b.w;lx++){
      if(!b._mask[ly][lx])continue;
      const px=(b.x+lx)*SCALE, py=(b.y+ly)*SCALE;
      ctx.fillRect(px,py,SCALE,SCALE);
    }
    // HP číslo centrované uvnitř bloku. Mystery má navíc "?" nad HP číslem.
    const cx=(b.x+b.w/2)*SCALE, cy=(b.y+b.h/2)*SCALE;
    const fontPx=Math.max(12,Math.min(24,Math.floor(Math.min(b.w,b.h)*SCALE*0.7)));
    ctx.save();
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.lineWidth=Math.max(2,fontPx/7);
    ctx.strokeStyle='rgba(0,0,0,0.95)';
    if(isMystery){
      // Velký "?" přes celý blok (dominantní) + malý HP nad ním
      const qFont=Math.max(14,Math.min(28,Math.floor(Math.min(b.w,b.h)*SCALE*0.85)));
      ctx.font='bold '+qFont+'px system-ui, -apple-system, sans-serif';
      ctx.strokeText('?',cx,cy);
      ctx.fillStyle='#ffe07a';
      ctx.fillText('?',cx,cy);
    } else {
      ctx.font='bold '+fontPx+'px system-ui, -apple-system, sans-serif';
      ctx.strokeText(String(b.hp),cx,cy);
      ctx.fillStyle='#ffffff';
      ctx.fillText(String(b.hp),cx,cy);
    }
    ctx.restore();
    // Mystery: malé HP číslo v pravém horním rohu (přes překrytí ? uvnitř)
    if(isMystery){
      const hpX=(b.x+b.w)*SCALE-3, hpY=b.y*SCALE+3;
      ctx.save();
      ctx.textAlign='right';
      ctx.textBaseline='top';
      ctx.font='bold 10px system-ui, -apple-system, sans-serif';
      ctx.lineWidth=2;
      ctx.strokeStyle='rgba(0,0,0,0.95)';
      ctx.strokeText(String(b.hp),hpX,hpY);
      ctx.fillStyle='#ffffff';
      ctx.fillText(String(b.hp),hpX,hpY);
      ctx.restore();
    }
  }
}

function drawBelt(){
  const svg=document.getElementById('belt-svg');
  svg.innerHTML='';
  const W=360,H=64;
  const rollerR=28;
  const trackY1=18,trackY2=46;
  const lx=rollerR,rx=W-rollerR;
  const ns='http://www.w3.org/2000/svg';
  const mk=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);return e;};

  // Clip path – koule za válci zmizí
  const defs=mk('defs',{});
  const clip=mk('clipPath',{id:'bc'});
  clip.appendChild(mk('rect',{x:lx+1,y:trackY1-2,width:rx-lx-2,height:trackY2-trackY1+4}));
  defs.appendChild(clip);
  svg.appendChild(defs);

  // Pásy – s otvorem na LAUNCH_X
  const holeW=20;
  const hx1=LAUNCH_X-holeW/2, hx2=LAUNCH_X+holeW/2;
  svg.appendChild(mk('line',{x1:lx,y1:trackY1,x2:hx1,y2:trackY1,stroke:'#888','stroke-width':4,'stroke-linecap':'round'}));
  svg.appendChild(mk('line',{x1:hx2,y1:trackY1,x2:rx,y2:trackY1,stroke:'#888','stroke-width':4,'stroke-linecap':'round'}));
  svg.appendChild(mk('line',{x1:lx,y1:trackY2,x2:hx1,y2:trackY2,stroke:'#888','stroke-width':4,'stroke-linecap':'round'}));
  svg.appendChild(mk('line',{x1:hx2,y1:trackY2,x2:rx,y2:trackY2,stroke:'#888','stroke-width':4,'stroke-linecap':'round'}));
  // Animované šipky
  const arrowY=(trackY1+trackY2)/2;
  const arrowPeriod=30;
  const arrowOff=beltAnim%arrowPeriod;
  const arrowGrp=mk('g',{'clip-path':'url(#bc)'});
  for(let ax=lx+(arrowOff%arrowPeriod);ax<rx+arrowPeriod;ax+=arrowPeriod){
    arrowGrp.appendChild(mk('polyline',{points:`${ax},${arrowY-5} ${ax+10},${arrowY} ${ax},${arrowY+5}`,fill:'none',stroke:'#666','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'}));
  }
  svg.appendChild(arrowGrp);

  // Válce navrch
  [lx,rx].forEach(cx=>{
    svg.appendChild(mk('ellipse',{cx,cy:H/2,rx:8,ry:rollerR-2,fill:'#666',stroke:'#444','stroke-width':2}));
    svg.appendChild(mk('ellipse',{cx,cy:H/2,rx:4,ry:12,fill:'#888',stroke:'#555','stroke-width':1}));
    svg.appendChild(mk('circle',{cx,cy:H/2,r:4,fill:'#aaa'}));
  });

  // Animované koule
  const ballR=14;
  const startX=lx+ballR+8;
  const endX=rx-ballR-8;
  const trackW=endX-startX;
  const spacing=trackW/(BELT_CAP-1);
  const totalLen=BELT_CAP*spacing;
  const ballY=(trackY1+trackY2)/2;
  const offset=beltAnim%totalLen;

  const ballGrp=mk('g',{'clip-path':'url(#bc)'});
  for(let i=0;i<BELT_CAP;i++){
    const bx=startX+(i*spacing+offset)%totalLen;
    if(i<belt.length){
      const b=belt[i];
      const color=COLORS[b.ci];
      if(b.rocket){
        // Raketová koule – tmavé jádro s barevným prstencem a ikonou rakety
        ballGrp.appendChild(mk('circle',{cx:bx,cy:ballY,r:ballR,fill:'#1a1f2e',stroke:color,'stroke-width':3}));
        ballGrp.appendChild(mk('circle',{cx:bx,cy:ballY,r:ballR-4,fill:'none',stroke:color,'stroke-width':1,opacity:0.5}));
        const txt=mk('text',{x:bx,y:ballY+5,'text-anchor':'middle','font-size':14,fill:'#fff'});
        txt.textContent='🚀';
        ballGrp.appendChild(txt);
      } else {
        ballGrp.appendChild(mk('circle',{cx:bx,cy:ballY,r:ballR,fill:color,stroke:'rgba(0,0,0,0.25)','stroke-width':1}));
        ballGrp.appendChild(mk('circle',{cx:bx-4,cy:ballY-4,r:4,fill:'rgba(255,255,255,0.35)'}));
      }
    } else {
      ballGrp.appendChild(mk('circle',{cx:bx,cy:ballY,r:ballR,fill:'none',stroke:'#3a3a3a','stroke-width':1.5,'stroke-dasharray':'4,3'}));
    }
  }
  svg.appendChild(ballGrp);

  document.getElementById('belt-count').textContent=belt.length;
}
function cntCarriers(){
  let n=0;
  for(let c=0;c<COLS;c++)for(const s of columns[c])if(s!==null&&!s.wall)n++;
  return n;
}
function isCarrierActive(c,r){
  // Honeycomb pravidlo: aktivní je nosič, který má alespoň jednoho volného ortogonálního
  // souseda. "Volný" = null (dug-out hole) nebo horní okraj gridu (r===0).
  // Wall sentinel `{wall:true}` značí padding — představuje "zeď" a NENÍ volný.
  if(c<0||c>=COLS||r<0)return false;
  const col=columns[c];
  if(!col||r>=col.length)return false;
  const slot=col[r];
  if(!slot||slot.wall)return false;
  if(r===0)return true;
  if(col[r-1]===null)return true;
  if(r+1<col.length&&col[r+1]===null)return true;
  if(c>0){const lc=columns[c-1];if(lc&&r<lc.length&&lc[r]===null)return true;}
  if(c+1<COLS){const rc=columns[c+1];if(rc&&r<rc.length&&rc[r]===null)return true;}
  return false;
}
function drawCarriers(){
  const el=document.getElementById('carriers-grid');
  el.innerHTML='';
  for(let c=0;c<COLS;c++){
    const col=document.createElement('div');
    col.className='carrier-col';
    for(let r=0;r<columns[c].length;r++){
      const slot=columns[c][r];
      const isWall=!!(slot&&slot.wall===true);
      const isNullEmpty=slot===null;
      const empty=isNullEmpty||isWall;
      const active=!empty&&isCarrierActive(c,r);
      const hidden=!empty&&!active&&slot.hidden===true;
      const isGarage=!empty&&slot&&slot.type==='garage';
      const garageLocked=isGarage&&!active;
      const div=document.createElement('div');
      // Rozlišíme wall vs null — wall dostane svůj „blok" vzhled (top-down zeď),
      // null zůstane čistě prázdné (hráč vidí jen tmavý slot).
      const emptyClass=isWall?'empty wall':'empty';
      div.className='carrier '+(empty?emptyClass:isGarage?('garage'+(garageLocked?' locked':'')):active?'active':hidden?'hiddenq':'inactive');
      if(empty){
        div.innerHTML=isWall?'<div class="wall-block"></div>':'';
      } else if(hidden){
        div.innerHTML='<div class="cbox-hid">?</div>';
      } else if(isGarage){
        const nextColor=slot.queue.length?COLORS[slot.queue[0].color]:'#2a2a2a';
        const count=slot.queue.length;
        const dirs=slot.directions||['N'];
        const arrMap={N:'gar-arr gar-arr-n',S:'gar-arr gar-arr-s',W:'gar-arr gar-arr-w',E:'gar-arr gar-arr-e'};
        const arrGlyph={N:'\u25B2',S:'\u25BC',W:'\u25C0',E:'\u25B6'};
        let arrHTML='';
        for(const d of dirs)arrHTML+='<span class="'+arrMap[d]+'">'+arrGlyph[d]+'</span>';
        div.innerHTML='<div class="cbox" style="position:relative;background:'+nextColor+';display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:1.5px solid rgba(0,0,0,0.45)">'
          +arrHTML
          +'<span style="font-size:16px;line-height:1">🏠</span>'
          +'<span style="font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.8)">'+count+'</span>'
          +'</div>';
      } else if(slot.type==='rocket'){
        const dc=COLORS[slot.color];
        div.innerHTML='<div class="cbox" style="background:linear-gradient(160deg,#3a3f5a,#111824);border:1.5px solid '+dc+';box-shadow:0 0 6px '+dc+'55 inset;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#fff;font-size:20px;line-height:1">🚀'
          +'<span style="width:10px;height:10px;border-radius:50%;background:'+dc+';box-shadow:0 0 5px '+dc+'"></span>'
          +'</div>';
      } else {
        const bg=COLORS[slot.color];
        const commonStyle='border-radius:50%;min-width:0;min-height:0;aspect-ratio:1;width:100%;max-width:18px;justify-self:center;align-self:center;';
        const activeBall='<div style="'+commonStyle
          +'background:radial-gradient(circle at 36% 32%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 52%), '+bg+';'
          +'box-shadow:inset 0 -2px 4px rgba(0,0,0,0.3), 0 0 0 1.5px rgba(0,0,0,0.28);"></div>';
        const dudBall='<div style="'+commonStyle
          +'background:transparent;'
          +'box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.25);opacity:0.4;"></div>';
        const dist=distributeProjectiles(slot.projectiles||UPC*PPU);
        let ballsHTML='';
        for(const p of dist)ballsHTML+=(p>0?activeBall:dudBall);
        const isCleanup=(slot.projectiles||UPC*PPU)<UPC*PPU;
        const borderStyle=isCleanup?'border:2px dashed rgba(255,255,255,0.55)':'border:1.5px solid rgba(0,0,0,0.45)';
        div.innerHTML='<div class="cbox" style="background:'+bg+';'+borderStyle+'">'+ballsHTML+'</div>';
      }
      if(active&&!isGarage){div.dataset.col=c;div.dataset.row=r;div.addEventListener('click',onCarrierClick);}
      col.appendChild(div);
    }
    el.appendChild(col);
  }
  document.getElementById('carriers-left').textContent=cntCarriers();
}
function findColorCentroid(ci){
  // Najdi největší souvislý shluk a vrať jeho těžiště – vyhneme se tak
  // problému, že průměr dvou oddělených oblastí padne mezi ně.
  const seen=[];
  for(let y=0;y<IMG_GH;y++)seen.push(new Array(GW).fill(false));
  let best=null;
  for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
    if(seen[y][x]||grid[y][x]!==ci)continue;
    const stack=[[x,y]];seen[y][x]=true;
    let sx=0,sy=0,n=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      sx+=cx;sy+=cy;n++;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=cx+dx,ny=cy+dy;
        if(nx<0||nx>=GW||ny<0||ny>=IMG_GH)continue;
        if(seen[ny][nx]||grid[ny][nx]!==ci)continue;
        seen[ny][nx]=true;stack.push([nx,ny]);
      }
    }
    if(!best||n>best.n)best={gx:Math.round(sx/n),gy:Math.round(sy/n),n};
  }
  return best;
}
function findNearestPixelOfColor(ci,gx,gy){
  let best=null,bestD=Infinity;
  for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==ci)continue;
    const d=(x-gx)*(x-gx)+(y-gy)*(y-gy);
    if(d<bestD){bestD=d;best={gx:x,gy:y};}
  }
  return best;
}
function launchRocket(ci){
  const target=findColorCentroid(ci);
  if(!target)return false;
  particles.push({
    phase:'rocket', ci, color:COLORS[ci],
    x:cannonX, y:CANNON_Y-6,
    tx:target.gx*SCALE+SCALE/2, ty:target.gy*SCALE+SCALE/2,
    speed:300, totalT:0, trailT:0,
    popR:0, popX:0, popY:0
  });
  return true;
}
function onCarrierClick(e){
  const c=+e.currentTarget.dataset.col,r=+e.currentTarget.dataset.row;
  if(!running)return;
  const slot=columns[c][r];
  if(!slot)return;
  // Hard limit: v trychtýři max 4 nosiče (16 koulí). Klik se neodbaví a zobrazí se varování.
  if(pending.length>PENDING_DISPENSE_THRESHOLD){
    showFunnelWarning();
    return;
  }
  if(slot.type==='rocket'){
    addToPending({ci:slot.color,ppu:20,rocket:true});
    addToPending({ci:slot.color,ppu:20,rocket:true});
    columns[c][r]=null;
    noMatchPasses=0;
    drawCarriers();drawBelt();drawPending();
    setStatus('🚀 Rakety v trychtýři!');
    return;
  }
  const projectiles=slot.projectiles||UPC*PPU;
  const balls=distributeProjectiles(projectiles).map(p=>({ci:slot.color,ppu:p}));
  for(const b of balls)addToPending(b);
  columns[c][r]=null;
  noMatchPasses=0;
  updateGarages();
  drawCarriers();drawBelt();drawPending();
  setStatus(balls.length+' balónků v trychtýři');
}
function showFunnelWarning(){
  funnelWarnTimer=1.8;
  const el=document.getElementById('funnel-warning');
  if(el){el.textContent='Funnel full — max 4 carriers at once. Wait for balls to reach the belt.';el.classList.add('show');}
}
function updateFunnelWarning(dt){
  if(funnelWarnTimer<=0)return;
  funnelWarnTimer-=dt;
  if(funnelWarnTimer<=0){
    const el=document.getElementById('funnel-warning');
    if(el)el.classList.remove('show');
  }
}
function updateGarages(){
  // Garáž jako "zamčený blok": odemkne se až má ≥1 null souseda v povolených směrech
  // (slot.directions). Pak vydá další nosič z queue do prvního volného povoleného
  // souseda. Když je queue prázdná, celá garáž zmizí (pozice → null).
  for(let c=0;c<COLS;c++){
    for(let r=0;r<columns[c].length;r++){
      const slot=columns[c][r];
      if(!slot||slot.type!=='garage')continue;
      const dirs=slot.directions||['N'];
      let freeNeighbor=null;
      for(const d of dirs){
        const [dc,dr]=GAR_DIR_VEC[d];
        const nc=c+dc,nr=r+dr;
        if(nc<0||nc>=COLS||nr<0)continue;
        const ncol=columns[nc];
        if(!ncol||nr>=ncol.length)continue;
        // Jen "hole" (null) — wall sentinel NENÍ volný slot.
        if(ncol[nr]===null){freeNeighbor=[nc,nr];break;}
      }
      if(!freeNeighbor)continue;
      if(slot.queue.length){
        const next=slot.queue.shift();
        const [nc,nr]=freeNeighbor;
        // Projectiles byly přiděleny už v buildColsFromLayout (porce z pxCounts).
        // Fallback UPC*PPU pro případ, že garáž vznikla jinou cestou (auto-gen).
        columns[nc][nr]={color:next.color,projectiles:next.projectiles||UPC*PPU};
      } else {
        columns[c][r]=null;
      }
    }
  }
}
// === Trychtýř – fyzika koulí ve frontě. Široký konec dole u nosičů,
// úzký nahoře u pásu. „Gravitace" míří vzhůru k pásu – koule stoupají
// skrz trychtýř a vstupují otvorem na pás.
const FUN={w:360,h:90,narrowY:14,wideY:82,narrowL:150,narrowR:210,wideL:10,wideR:350,r:14};
function addToPending(ball){
  ball.r=FUN.r;
  ball.x=FUN.wideL+24+Math.random()*(FUN.wideR-FUN.wideL-48);
  ball.y=FUN.wideY-6-Math.random()*8;
  ball.vx=(Math.random()-0.5)*40;
  ball.vy=-20;
  // Desynchronizace waggle – každá koule má unikátní práh i fázi
  ball.stuckT=-Math.random()*0.35;
  ball.waggleThresh=0.18+Math.random()*0.35;
  pending.push(ball);
}
function collideFunnelSeg(b,x1,y1,x2,y2){
  const sx=x2-x1, sy=y2-y1;
  const seg2=sx*sx+sy*sy;
  let t=((b.x-x1)*sx+(b.y-y1)*sy)/seg2;
  t=Math.max(0,Math.min(1,t));
  const cx=x1+t*sx, cy=y1+t*sy;
  const dx=b.x-cx, dy=b.y-cy;
  const d=Math.hypot(dx,dy);
  if(d<b.r&&d>0.001){
    const nx=dx/d, ny=dy/d;
    const ov=b.r-d;
    b.x+=nx*ov; b.y+=ny*ov;
    const vn=b.vx*nx+b.vy*ny;
    if(vn<0){const e=0.2;b.vx-=(1+e)*vn*nx;b.vy-=(1+e)*vn*ny;}
  }
}
function nudgeStuckNearOpening(dt){
  // Periodicky (každých ~0.45s) najdi kouli nejblíže otvoru a pokud má malou rychlost,
  // dej jí cílený impulz vzhůru s mírnou korekcí ke středu otvoru. Napodobuje
  // „lehké cvrnknutí" — vypadá přirozeně, neexploduje fronta.
  nudgeTimer+=dt;
  if(nudgeTimer<0.45)return;
  if(pending.length===0){nudgeTimer=0;return;}
  const openCX=(FUN.narrowL+FUN.narrowR)/2;
  let best=null, bestY=Infinity;
  for(const b of pending){
    if(b.x===undefined)continue;
    // Musí být v oblasti blízko otvoru (horní část trychtýře) a relativně klidná
    if(b.y>FUN.narrowY+50)continue;
    const speed2=b.vx*b.vx+b.vy*b.vy;
    if(speed2>1800)continue; // už se hýbe — nech
    if(b.y<bestY){bestY=b.y;best=b;}
  }
  if(best){
    const dx=openCX-best.x;
    // Upward impulz + lehká boční korekce k otvoru. Random jitter pro organicky pocit.
    best.vy-=180+Math.random()*120;
    best.vx+=Math.sign(dx||1)*(40+Math.random()*40)+(Math.random()-0.5)*30;
    best.stuckT=-0.1;
    nudgeTimer=0;
  } else {
    // Nikdo není zaseknutý — čekej další cyklus, ale resetuj časovač jen částečně
    nudgeTimer=0.3;
  }
}
function updatePending(dt){
  updateFunnelWarning(dt);
  nudgeStuckNearOpening(dt);
  if(pending.length===0)return;
  const steps=4, h=Math.min(dt,0.05)/steps;
  for(let s=0;s<steps;s++){
    for(const b of pending){
      b.vy-=700*h;            // gravitace směrem k pásu (nahoru)
      b.vx*=0.995;
      b.x+=b.vx*h; b.y+=b.vy*h;
    }
    // Ball-ball
    for(let i=0;i<pending.length;i++)for(let j=i+1;j<pending.length;j++){
      const a=pending[i], b=pending[j];
      const dx=b.x-a.x, dy=b.y-a.y;
      const d=Math.hypot(dx,dy), min=a.r+b.r;
      if(d<min&&d>0.001){
        const nx=dx/d, ny=dy/d, ov=(min-d)/2;
        a.x-=nx*ov; a.y-=ny*ov;
        b.x+=nx*ov; b.y+=ny*ov;
        const rvx=b.vx-a.vx, rvy=b.vy-a.vy;
        const vn=rvx*nx+rvy*ny;
        if(vn<0){
          const e=0.25, imp=(1+e)*vn/2;
          a.vx+=imp*nx; a.vy+=imp*ny;
          b.vx-=imp*nx; b.vy-=imp*ny;
        }
      }
    }
    // Stěny trychtýře (široko dole, úzko nahoře) + dno u nosičů
    const gate=belt.length>=BELT_CAP;
    for(const b of pending){
      collideFunnelSeg(b,FUN.wideL,FUN.wideY,FUN.narrowL,FUN.narrowY);
      collideFunnelSeg(b,FUN.wideR,FUN.wideY,FUN.narrowR,FUN.narrowY);
      // Strop mimo otvor – uzavře trychtýř nahoře po stranách otvoru
      collideFunnelSeg(b,0,FUN.narrowY,FUN.narrowL,FUN.narrowY);
      collideFunnelSeg(b,FUN.narrowR,FUN.narrowY,FUN.w,FUN.narrowY);
      // Dno u nosičů – koule nesmí propadnout dolů
      if(b.y+b.r>FUN.wideY){
        b.y=FUN.wideY-b.r;
        if(b.vy>0) b.vy*=-0.3;
      }
      // Boční tvrdé zastavení – kdyby koule při impulzu klipla za okraj
      if(b.x<b.r){b.x=b.r;if(b.vx<0)b.vx*=-0.3;}
      if(b.x>FUN.w-b.r){b.x=FUN.w-b.r;if(b.vx>0)b.vx*=-0.3;}
      // Sanity clamp do tvaru trychtýře – interpolovaná šířka v dané výšce
      if(b.y>=FUN.narrowY&&b.y<=FUN.wideY){
        const t=(FUN.wideY-b.y)/(FUN.wideY-FUN.narrowY);
        const lx=FUN.wideL+t*(FUN.narrowL-FUN.wideL);
        const rx=FUN.wideR+t*(FUN.narrowR-FUN.wideR);
        if(b.x<lx+b.r){b.x=lx+b.r;if(b.vx<0)b.vx=-b.vx*0.3;}
        if(b.x>rx-b.r){b.x=rx-b.r;if(b.vx>0)b.vx=-b.vx*0.3;}
      }
      // Anti-stuck waggle – per-ball práh a náhodný trigger, aby se koule nesynchronizovaly
      const speed2=b.vx*b.vx+b.vy*b.vy;
      if(speed2<400&&b.y<FUN.narrowY+34){
        b.stuckT=(b.stuckT||0)+h;
        const thr=b.waggleThresh||0.25;
        if(b.stuckT>thr&&Math.random()<0.35){
          const side=Math.random()<0.5?-1:1;
          b.vx+=side*(140+Math.random()*180);
          b.vy-=50+Math.random()*100;
          b.stuckT=-Math.random()*0.25;
          b.waggleThresh=0.18+Math.random()*0.35;
        }
      } else {
        b.stuckT=0;
      }
    }
    // Gate = vodorovný strop mezi narrowL a narrowR když nemá pás místo
    if(gate){
      for(const b of pending){
        if(b.y-b.r<FUN.narrowY && b.x>FUN.narrowL-2 && b.x<FUN.narrowR+2){
          b.y=FUN.narrowY+b.r;
          if(b.vy<0) b.vy*=-0.25;
        }
      }
    }
    // Výstupní pohltání – koule prošla úzkým otvorem nahoru
    for(let i=pending.length-1;i>=0;i--){
      const b=pending[i];
      if(b.y+b.r<FUN.narrowY-4){
        if(belt.length<BELT_CAP){
          pending.splice(i,1);
          delete b.x; delete b.y; delete b.vx; delete b.vy; delete b.r;
          belt.push(b);
          noMatchPasses=0;
          drawBelt();
        } else {
          b.y=FUN.narrowY+b.r; b.vy=60;
        }
      }
    }
  }
}
function drainPending(){
  // Fyzika trychtýře řídí odtok – tady už nic netáhne.
  // Ponecháno pro zpětnou kompatibilitu callerů.
  return pending.length>0;
}
let pendingCtx=null;
function drawPending(){
  const canvas=document.getElementById('pending-canvas');
  if(!canvas)return;
  if(!pendingCtx)pendingCtx=canvas.getContext('2d');
  const ctx=pendingCtx;
  ctx.clearRect(0,0,FUN.w,FUN.h);
  // Stěny trychtýře – široko dole (u nosičů), úzko nahoře (u pásu)
  ctx.strokeStyle='rgba(180,190,210,0.6)';
  ctx.lineWidth=2;
  ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(FUN.wideL,FUN.wideY); ctx.lineTo(FUN.narrowL,FUN.narrowY);
  ctx.moveTo(FUN.wideR,FUN.wideY); ctx.lineTo(FUN.narrowR,FUN.narrowY);
  ctx.stroke();
  // Gate – zobraz čárou nahoře když je pás plný
  if(belt.length>=BELT_CAP){
    ctx.strokeStyle='rgba(255,120,120,0.75)';
    ctx.beginPath();
    ctx.moveTo(FUN.narrowL,FUN.narrowY); ctx.lineTo(FUN.narrowR,FUN.narrowY);
    ctx.stroke();
  }
  // Koule
  for(const b of pending){
    if(b.x===undefined)continue;
    const g=ctx.createRadialGradient(b.x-b.r*0.3,b.y-b.r*0.3,1,b.x,b.y,b.r);
    g.addColorStop(0,'rgba(255,255,255,0.7)');
    g.addColorStop(0.4,COLORS[b.ci]);
    g.addColorStop(1,COLORS[b.ci]);
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.35)';
    ctx.lineWidth=0.8;
    ctx.stroke();
  }
}
function checkLaunchPoint(prevAnim, curAnim){
  if(!running||belt.length===0)return;
  const prevOff=prevAnim%BELT_TOTAL;
  const curOff=curAnim%BELT_TOTAL;
  for(let i=belt.length-1;i>=0;i--){
    const prevTrack=(i*BELT_SPACING+prevOff)%BELT_TOTAL;
    const curTrack=(i*BELT_SPACING+curOff)%BELT_TOTAL;
    // Kulička prošla otvorem zleva doprava (bez wrap, wrap nemíří přes LAUNCH_TRACK)
    if(!(prevTrack<LAUNCH_TRACK&&curTrack>=LAUNCH_TRACK))continue;

    const ball=belt[i];
    const color=ball.ci;
    if(ball.ppu<=0){
      belt.splice(i,1);
      drainPending();
      drawBelt();drawPending();
      continue;
    }
    // Ball má co zasáhnout, pokud zbývají pixely ORdanou barvou, nebo živý blok té barvy.
    const pxNow=countPixels(grid);
    const hasBlockTarget=currentBlocks.some(b=>b.hp>0&&b.color===color);
    if((pxNow[color]||0)===0&&!hasBlockTarget){
      belt.splice(i,1);
      drainPending();
      drawBelt();drawPending();
      continue;
    }
    // Raketová koule – odpal přímo, bez kontroly dosahu / kolizí
    if(ball.rocket){
      belt.splice(i,1);
      drainPending();
      drawBelt();drawPending();
      launchRocket(color);
      noMatchPasses=0;
      stuckPassCount=0;
      setStatus('🚀 Raketa letí!');
      continue;
    }
    const avail=getAvailableColors(grid);
    // Blok té barvy je taky validní cíl (nezapočítává se do getAvailableColors, ta
    // čte jen odkryté pixely). Bez téhle větve by koule na pásu projela dál, i když
    // je vedle ní živý blok shodné barvy → cannon nikdy nedostane item té barvy.
    const hasLiveBlockOfColor=currentBlocks.some(b=>b.hp>0&&(b.kind==='mystery'||b.color===color));
    // Cannon má co střílet, jen když pickCannonShot najde čistou LoS. Jinak
    // ball krouží na pásu a čeká, až se prostor otevře — žádné předčasné
    // konzumování bez záruky výstřelu.
    const cannonHasShot=!!pickCannonShot(color,cannonX,CANNON_Y);
    if((!avail.has(color)&&!hasLiveBlockOfColor)||!cannonHasShot){
      // Špatná barva – projede dál
      noMatchPasses++;
      // Okamžitá kontrola: pokud žádná barva na pásu nesedí → nemusíme čekat na kolečko
      const beltColors=new Set(belt.map(b=>b.ci));
      const anyMatch=[...beltColors].some(c=>avail.has(c));
      if(!anyMatch||noMatchPasses>=BELT_CAP){
        noMatchPasses=0;
        if(belt.length>=BELT_CAP){endGame(false);return;}
        if(anyLeft(grid)){
          if(!checkAndWarnAmmoDeficit()) setStatus('Žádná shoda – přidej jinou barvu');
        }
      }
      continue;
    }

    // Exposed pixely + HP živých bloků té barvy (1 HP = 1 projektil). Bez bloků
    // v tomhle součtu by ball projela přes launch point bez firingu, když cílové
    // pixely jsou celé pod blokem — cannon pak nemá co spotřebovat.
    const blockHpOfColor=currentBlocks
      .filter(b=>b.hp>0&&(b.kind==='mystery'||b.color===color))
      .reduce((s,b)=>s+b.hp,0);
    const exposedCount=getReachableCountOfColor(grid,color)+blockHpOfColor;
    const alreadyFlying=particles.filter(p=>p.phase==='fly'&&p.ci===color).length;
    const inQueue=gunQueue.filter(q=>q.ci===color).length;
    const totalActive=alreadyFlying+inQueue;

    stuckPassCount=0;

    // Spotřebuj celou kouli → vystřel všech ball.ppu projektilů. Některé
    // možná nenajdou LoS hned — dispatch je odpálí na blocked úhel (nejbližší
    // target), particle fyzika je odrazí a hledá cestu. Když barva v průběhu
    // ztratí veškerý target, queue item se popne bez výstřelu (visible loss).
    noMatchPasses=0;
    loops=0;
    belt.splice(i,1);
    drainPending();
    drawBelt();drawPending();
    const count=ball.ppu;
    for(let j=0;j<count;j++){
      gunQueue.push({ci:color,color:COLORS[color]});
    }
    score+=10;
    document.getElementById('score').textContent=score;
    gamee.updateScore(score,playTime,'balloon-belt-v51');
    setStatus('Zásah!');

    if(belt.length===0&&anyLeft(grid)){
      setTimeout(()=>{
        if(!running||!anyLeft(grid))return;
        checkAndWarnAmmoDeficit();
      },1800);
    }
  }
}
function destroyPixels(colors,cm){
  for(const color of colors){
    const prev=remainingUnits[color]||0;
    let td=(cm[color]*PPU)+prev;
    while(td>0){
      const exp=getExposedPixelsOfColor(grid,color);
      if(!exp.length)break;
      exp.sort((a,b)=>b.y-a.y);
      exp.slice(0,td).forEach(p=>{grid[p.y][p.x]=-1;});
      td-=Math.min(exp.length,td);
    }
    remainingUnits[color]=td>0?td:0;
  }
}
function computeAmmoDeficit(){
  const pxCounts=countPixelsAndBlocks(grid);
  const deficits=new Array(COLORS.length).fill(0);
  for(let c=0;c<COLORS.length;c++){
    if(!pxCounts[c])continue;
    let proj=0;
    for(let col=0;col<COLS;col++)for(const s of columns[col]){
      if(!s)continue;
      if(s.type==='garage'){for(const gc of s.queue)if(gc.color===c)proj+=(gc.projectiles||UPC*PPU);}
      else if(s.color===c)proj+=(s.projectiles||UPC*PPU);
    }
    for(const b of belt)if(b.ci===c)proj+=b.ppu;
    for(const b of pending)if(b.ci===c)proj+=b.ppu;
    proj+=particles.filter(p=>p.phase==='fly'&&p.ci===c).length;
    proj+=gunQueue.filter(q=>q.ci===c).length;
    const d=pxCounts[c]-proj;
    if(d>0)deficits[c]=d;
  }
  return deficits;
}
// Detailní audit — rozpis projektilů per barva a per umístění (carrier/garage/belt/pending/gun/fly).
// Slouží k ladění, kde se projektily „ztrácejí" mezi startem a deficit varováním.
function computeAmmoAudit(){
  const pxCounts=countPixelsAndBlocks(grid);
  const rows=[];
  let totalNeed=0, totalHave=0;
  for(let c=0;c<COLORS.length;c++){
    const need=pxCounts[c]|0;
    let car=0, gar=0, blt=0, pnd=0, gq=0, fly=0;
    for(let col=0;col<COLS;col++)for(const s of columns[col]){
      if(!s)continue;
      if(s.type==='garage'){
        for(const gc of (s.queue||[])) if(gc.color===c) gar+=(gc.projectiles||UPC*PPU);
      } else if(!s.wall && s.type!=='rocket' && s.color===c){
        car+=(s.projectiles||UPC*PPU);
      }
    }
    for(const b of belt)   if(b.ci===c) blt+=b.ppu;
    for(const b of pending)if(b.ci===c) pnd+=b.ppu;
    gq = gunQueue.filter(q=>q.ci===c).length;
    fly= particles.filter(p=>p.phase==='fly'&&p.ci===c).length;
    const have=car+gar+blt+pnd+gq+fly;
    if(need||have) rows.push({c,need,have,car,gar,blt,pnd,gq,fly,diff:need-have});
    totalNeed+=need; totalHave+=have;
  }
  return {rows,totalNeed,totalHave};
}
// Tah 8: dogenerovávání nosičů za běhu bylo odstraněno. Místo toho periodicky
// počítáme deficit a hráči se zobrazí varování, pokud garáž+kolona+belt+queue
// nestačí na zbývající pixely/bloky. Start levelu MUSÍ mít dostatek — jinak
// je levelový design chybný.
function checkAndWarnAmmoDeficit(){
  if(!running) return false;
  const audit=computeAmmoAudit();
  renderAmmoAudit(audit);
  const short=audit.rows.filter(r=>r.diff>0);
  if(!short.length) return false;
  const parts=short.map(r=>'#'+r.c+' '+r.have+'/'+r.need);
  setStatus('⚠ Nedostatek ('+parts.join(', ')+') · celkem '+audit.totalHave+'/'+audit.totalNeed);
  console.warn('[BB] ammo audit', audit);
  return true;
}
function renderAmmoAudit(audit){
  const el=document.getElementById('ammo-audit');
  if(!el) return;
  if(!audit || !audit.rows.length){el.textContent='';el.hidden=true;return;}
  el.hidden=false;
  el.innerHTML='';
  const head=document.createElement('div');
  head.className='aa-total';
  head.textContent='celkem '+audit.totalHave+' / '+audit.totalNeed+' proj.';
  if(audit.totalHave<audit.totalNeed) head.classList.add('aa-bad');
  el.appendChild(head);
  for(const r of audit.rows){
    const chip=document.createElement('span');
    chip.className='aa-chip';
    if(r.diff>0) chip.classList.add('aa-bad');
    const sw=document.createElement('span');
    sw.className='aa-sw';
    sw.style.background=COLORS[r.c]||'#888';
    chip.appendChild(sw);
    const lbl=document.createElement('span');
    lbl.textContent=r.have+'/'+r.need;
    chip.appendChild(lbl);
    chip.title='barva '+r.c+': need '+r.need+' · have '+r.have+
      ' (carrier '+r.car+', garáž '+r.gar+', belt '+r.blt+', funnel '+r.pnd+', gun '+r.gq+', fly '+r.fly+')';
    el.appendChild(chip);
  }
}
function setStatus(m){document.getElementById('status').textContent=m;}
function endGame(win){
  running=false;
  if(playTimer){clearInterval(playTimer);playTimer=null;}
  gamee.updateScore(score,playTime,'balloon-belt-v51');
  gamee.gameOver(undefined,JSON.stringify({score:score,level:currentLevel,difficulty:difficulty}),undefined);
  if(win){
    spawnConfetti();
    setTimeout(spawnConfetti,280);
    setTimeout(spawnConfetti,560);
  }
  setTimeout(()=>{
    document.getElementById('overlay-title').textContent=win?'Vyhráno!':'Game Over';
    document.getElementById('overlay-msg').textContent=(win?'Obraz zničen.':'Belt zablokován.')+' Skóre: '+score;
    document.getElementById('overlay').classList.add('show');
  },win?1400:0);
}
function startLevel(){
  gameStarted=true;
  // Sync segment picker s aktuálním `difficulty` — saveState/defaultComplexity
  // mohly difficulty změnit mimo UI event. Bez toho by highlight ukazoval
  // předchozí complexity.
  document.querySelectorAll('[data-diff]').forEach(b=>{
    if(b.dataset.diff===difficulty)b.classList.add('active'); else b.classList.remove('active');
  });
  if(playTimer)clearInterval(playTimer);
  playTime=0;
  playTimer=setInterval(function(){if(!paused&&running)playTime++;},1000);
  gamee.gameStart();
  if(!beltLoopStarted){beltLoopStarted=true;lastBeltTime=null;requestAnimationFrame(beltLoop);}
  grid=makeGrid();belt=[];pending=[];nudgeTimer=0;funnelWarnTimer=0;score=0;loops=0;running=true;noMatchPasses=0;stuckPassCount=0;
  particles=[];shards=[];confetti=[];gunQueue=[];gunFireTimer=0;cannonX=LAUNCH_X;cannonAngle=-Math.PI/2;cannonLock=null;cannonSidePref=0;cannonSideShots=0;
  // Hydrate bloky z definice levelu PŘED makeColumns, aby generátor nosičů
  // započítal HP bloků do potřebných barev (přes countPixelsAndBlocks).
  const levelDef=getLevelDef(currentLevel);
  // Per-level speciality z definice levelu (editor tyto flagy spravuje).
  // Dříve byly globální toggly v UI hry — ty jsou v28 pryč, zdroj pravdy je levelDef.
  gravityOn=!!levelDef.gravity;
  rocketsOn=!!levelDef.rocketTargets;
  garageMode=levelDef.garage?'single':'off';
  currentBlocks=hydrateBlocks(levelDef.blocks);
  // Solid blok je neprůhledný — pod ním nemají být žádné pixely, jinak by
  // generátor vyrobil nosiče, které se stanou nepoužitelnými (pixely se
  // po zničení bloku stejně smažou). Pod mystery blok pixely ponecháváme
  // (po zničení se odhalí).
  for(const b of currentBlocks){
    if(b.kind!=='solid')continue;
    for(let ly=0;ly<b.h;ly++)for(let lx=0;lx<b.w;lx++){
      if(!b._mask[ly][lx])continue;
      const gx=b.x+lx, gy=b.y+ly;
      if(gy>=0&&gy<GH&&gx>=0&&gx<GW)grid[gy][gx]=-1;
    }
  }
  const _pxCountsForLevel=countPixelsAndBlocks(grid);
  columns=makeColumns(_pxCountsForLevel);
  // Když columns postavil layout, rakety + garáž už v gridu jsou → skip injekci.
  // Jinak pokračuje původní injekce do auto-generovaného gridu.
  const skipInjects=columnsFromLayout;
  // Injekce raketových nosičů – per level předdefinované 2 pozice
  const rockets=(!skipInjects&&rocketsOn)?levelDef.rocketTargets:null;
  if(rockets){
    const slots=[{col:2,row:1},{col:5,row:1}];
    for(let i=0;i<rockets.length&&i<slots.length;i++){
      const s=slots[i];
      while(columns[s.col].length<s.row)columns[s.col].push(null);
      columns[s.col].splice(s.row,0,{type:'rocket',color:rockets[i]});
    }
  }
  // Injekce garáže – drží nosiče a auto-vydává je přes nastavené směry.
  // ROOT CAUSE fix (v21): předtím `splice` nosičů dělal jagged sloupce → vznikly
  // izolované ostrůvky. Teď nahrazujeme nosiče zdmi (rectangular zůstane) a po
  // injekci validujeme connectivity; pokud selže, regenerujeme makeColumns.
  if(!skipInjects&&garageMode!=='off'&&levelDef.garage){
    const {col:gcol,carriers:gcarriers}=levelDef.garage;
    let injected=false;
    for(let attempt=0;attempt<10&&!injected;attempt++){
      if(attempt>0)columns=makeColumns(countPixelsAndBlocks(grid));
      const backup=columns.map(c=>c.map(s=>s?{...s}:s));
      // 1) Nahraď N nosičů odpovídající barvy zdmi (zachová rectangular → connectivity base).
      let allReplaced=true;
      for(const gc of gcarriers){
        let replaced=false;
        for(let c=COLS-1;c>=0&&!replaced;c--){
          for(let r=columns[c].length-1;r>=0&&!replaced;r--){
            const s=columns[c][r];
            if(s&&!s.type&&!s.wall&&s.color===gc.color){
              columns[c][r]={wall:true};
              replaced=true;
            }
          }
        }
        if(!replaced){allReplaced=false;break;}
      }
      if(!allReplaced){columns=backup;continue;}
      // 2) Garáž se přidá jako nový řádek na konec target sloupce (jagged +1 dole,
      //    pouze v jednom sloupci — neobjeví se "díra" mezi sloupci).
      if(columns[gcol].length>=MAX_ROWS){columns=backup;continue;}
      const targetRow=columns[gcol].length;
      // 3) Spočítej dostupné směry pro garáž (non-wall, non-garage sousedi v gridu).
      const validDirs=[];
      for(const d of Object.keys(GAR_DIR_VEC)){
        const [dc,dr]=GAR_DIR_VEC[d];
        const nc=gcol+dc,nr=targetRow+dr;
        if(nc<0||nc>=COLS||nr<0)continue;
        const ncol=columns[nc];
        if(!ncol||nr>=ncol.length)continue;
        const n=ncol[nr];
        if(n&&(n.wall||n.type==='garage'))continue;
        validDirs.push(d);
      }
      if(!validDirs.length){columns=backup;continue;}
      let chosenDirs;
      if(garageMode==='single'){
        chosenDirs=[validDirs[Math.floor(Math.random()*validDirs.length)]];
      } else {
        const want=2+Math.floor(Math.random()*3);
        const shuffled=validDirs.slice().sort(()=>Math.random()-0.5);
        chosenDirs=shuffled.slice(0,Math.min(want,shuffled.length));
      }
      const queue=gcarriers.map(c=>({color:c.color}));
      columns[gcol].push({type:'garage',directions:chosenDirs,queue});
      // 4) Finální BFS — každý reálný nosič musí být dosažitelný z top row.
      if(!validateColumnsReachable(columns)){columns=backup;continue;}
      injected=true;
    }
    // Pokud 10× selhalo, garáž tiše vypadne (grid zůstane bez ní — lepší než unsolvable).
  }
  // Editor hook: columns už jsou po injekcích (rakety/garáž) finální → pošleme
  // nadřazenému oknu stats s pxCounts (need) + projCounts (have per barva),
  // aby editor mohl zobrazit game-truth need-vs-have a chyby, když layout
  // nevyrobil dost projektilů.
  try{
    if(window.parent&&window.parent!==window){
      const projCounts=new Array(COLORS.length).fill(0);
      for(let col=0;col<COLS;col++)for(const s of columns[col]){
        if(!s)continue;
        if(s.type==='garage'){
          for(const gc of (s.queue||[])){
            if(typeof gc.color==='number') projCounts[gc.color]+=(gc.projectiles||UPC*PPU);
          }
        } else if(!s.wall && s.type!=='rocket' && typeof s.color==='number'){
          projCounts[s.color]+=(s.projectiles||UPC*PPU);
        }
      }
      window.parent.postMessage({
        type:'balloonbelt:level-stats',
        levelKey:currentLevel,
        difficulty:difficulty,
        pxCounts:Array.from(_pxCountsForLevel),
        projCounts:projCounts,
      },'*');
    }
  }catch(e){/* same-origin check failed, ignore */}
  // Tah 8: initial ammo-deficit check – musí proběhnout SYNCHRONNĚ dřív,
  // než intro sekvence swapne `grid` na scaffolded verzi (jinak check vidí
  // jen částečně sestavený obraz a reportuje falešný deficit).
  ammoCheckTimer=0;
  checkAndWarnAmmoDeficit();
  // I když deficit není, ukaž audit panel s totals (need/have) hned od začátku.
  renderAmmoAudit(computeAmmoAudit());
  document.getElementById('score').textContent=0;
  document.getElementById('overlay').classList.remove('show');
  introSeq++;
  if(currentLevel==='smiley'){
    // Stop-motion sestavení neutrálního smajlíka → úsměv → mrknutí → úsměv
    const finalGrid=grid;
    const mySeq=introSeq;
    const BG=3;
    const neutralGrid=makeGridSmiley('neutral');for(let i=0;i<4;i++)neutralGrid.push(new Array(GW).fill(-1));
    grid=new Array(IMG_GH);
    for(let y=0;y<IMG_GH;y++)grid[y]=new Array(GW).fill(BG);
    for(let i=0;i<4;i++)grid.push(new Array(GW).fill(-1));
    const cxf=17.5, cyf=12.5;
    const cells=[];
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const c=neutralGrid[y][x];
      if(c===-1||c===BG)continue;
      cells.push({x,y,c,d:Math.hypot(x-cxf,y-cyf)});
    }
    cells.sort((a,b)=>a.d-b.d);
    const batch=8, interval=50;
    let idx=0;
    const step=()=>{
      if(mySeq!==introSeq) return;
      for(let k=0;k<batch&&idx<cells.length;k++,idx++){
        const p=cells[idx];
        grid[p.y][p.x]=p.c;
      }
      drawGrid();
      if(idx<cells.length) setTimeout(step,interval);
      else {
        const at=(ms,fn)=>setTimeout(()=>{if(mySeq===introSeq)fn();},ms);
        const swap=v=>{
          if(v==='final'){grid=finalGrid;} else {grid=makeGridSmiley(v);for(let i=0;i<4;i++)grid.push(new Array(GW).fill(-1));}
          drawGrid();
        };
        at(350,()=>swap('final'));    // úsměv
        at(900,()=>swap('wink'));     // mrknutí
        at(1250,()=>swap('final'));   // konec
      }
    };
    setTimeout(step,120);
  } else if(currentLevel==='moon'){
    // Stop-motion build: měsíc roste zevnitř ven, mezitím naskakují hvězdy a jiskry
    const finalGrid=grid;
    const mySeq=introSeq;
    grid=makeGridMoon('empty');for(let i=0;i<4;i++)grid.push(new Array(GW).fill(-1));
    const BG=6;
    const moonCells=[], sparkCells=[];
    const cxm=18.5, cym=13.5;
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const c=finalGrid[y][x];
      if(c===-1||c===BG)continue;
      if(c===2||c===7) moonCells.push({x,y,c,d:Math.hypot(x-cxm,y-cym)});
      else sparkCells.push({x,y,c});
    }
    moonCells.sort((a,b)=>a.d-b.d);
    for(let i=sparkCells.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[sparkCells[i],sparkCells[j]]=[sparkCells[j],sparkCells[i]];}
    const sequence=[...moonCells, ...sparkCells];
    const batch=7, interval=55;
    let idx=0;
    const step=()=>{
      if(mySeq!==introSeq) return;
      for(let k=0;k<batch&&idx<sequence.length;k++,idx++){
        const p=sequence[idx];
        grid[p.y][p.x]=p.c;
      }
      drawGrid();
      if(idx<sequence.length) setTimeout(step,interval);
      else {
        grid=finalGrid;drawGrid();
        // Závěrečné zatřpytění – dvě vlny twinkle pak návrat
        const at=(ms,fn)=>setTimeout(()=>{if(mySeq===introSeq)fn();},ms);
        const swap=v=>{
          if(v==='final'){grid=finalGrid;} else {grid=makeGridMoon(v);for(let i=0;i<4;i++)grid.push(new Array(GW).fill(-1));}
          drawGrid();
        };
        at(180,()=>swap('twinkle-a'));
        at(380,()=>swap('final'));
        at(540,()=>swap('twinkle-b'));
        at(740,()=>swap('twinkle-a'));
        at(900,()=>swap('final'));
      }
    };
    setTimeout(step,120);
  } else if(currentLevel==='starwars'){
    // Stop-motion sestavení C-3PO zevnitř ven, pak smích „Ha ha ha"
    const finalGrid=grid;
    const mySeq=introSeq;
    const BG=7;
    grid=new Array(IMG_GH);
    for(let y=0;y<IMG_GH;y++)grid[y]=new Array(GW).fill(BG);
    for(let i=0;i<4;i++)grid.push(new Array(GW).fill(-1));
    const cxf=17.5, cyf=12;
    const cells=[];
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const c=finalGrid[y][x];
      if(c===-1||c===BG)continue;
      cells.push({x,y,c,d:Math.hypot(x-cxf,y-cyf)});
    }
    cells.sort((a,b)=>a.d-b.d);
    const batch=9, interval=45;
    let idx=0;
    const step=()=>{
      if(mySeq!==introSeq) return;
      for(let k=0;k<batch&&idx<cells.length;k++,idx++){
        const p=cells[idx];
        grid[p.y][p.x]=p.c;
      }
      drawGrid();
      if(idx<cells.length) setTimeout(step,interval);
      else {
        const at=(ms,fn)=>setTimeout(()=>{if(mySeq===introSeq)fn();},ms);
        const swap=v=>{
          if(v==='final'){grid=finalGrid;} else {grid=makeGridC3PO(v);for(let i=0;i<4;i++)grid.push(new Array(GW).fill(-1));}
          drawGrid();
        };
        // Ha ha ha – třikrát otevřít a zavřít pusu
        at(250,()=>swap('ha-open'));
        at(450,()=>swap('final'));
        at(650,()=>swap('ha-open'));
        at(850,()=>swap('final'));
        at(1050,()=>swap('ha-open'));
        at(1300,()=>swap('final'));
      }
    };
    setTimeout(step,120);
  } else if(currentLevel==='frog'){
    // 1) Stop-motion modrého ovalu od středu ven
    // 2) Žabka se vynoří ze středu vody (yOff klesá z ~8)
    const finalGrid=grid;
    const mySeq=introSeq;
    const empty=[];
    for(let y=0;y<IMG_GH;y++)empty.push(new Array(GW).fill(8));
    for(let i=0;i<4;i++)empty.push(new Array(GW).fill(-1));
    grid=empty;drawGrid();
    // Posbírej vodní buňky z cílové vodní mřížky, seřaď podle vzdálenosti od středu
    const waterGrid=makeGridFrog('water-only');
    const wcx=18, wcy=21;
    const waterCells=[];
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const c=waterGrid[y][x];
      if(c===2||c===3)waterCells.push({x,y,c,d:Math.hypot(x-wcx,y-wcy)});
    }
    waterCells.sort((a,b)=>a.d-b.d);
    const waterBase=[];
    for(let y=0;y<IMG_GH;y++)waterBase.push(new Array(GW).fill(8));
    for(let i=0;i<4;i++)waterBase.push(new Array(GW).fill(-1));
    let widx=0;
    const waterBatch=8, waterInt=55;
    const waterStep=()=>{
      if(mySeq!==introSeq) return;
      for(let k=0;k<waterBatch&&widx<waterCells.length;k++,widx++){
        const p=waterCells[widx];
        waterBase[p.y][p.x]=p.c;
      }
      grid=waterBase.map(r=>r.slice());
      drawGrid();
      if(widx<waterCells.length) setTimeout(waterStep,waterInt);
      else setTimeout(riseStep,280);
    };
    const offsets=[8,7,6,5,4,3,2,1,0];
    let i=0;
    const riseStep=()=>{
      if(mySeq!==introSeq) return;
      const yOff=offsets[i];
      const ng=makeGridFrog('final',yOff);
      for(let k=0;k<4;k++)ng.push(new Array(GW).fill(-1));
      grid=ng;drawGrid();
      i++;
      if(i<offsets.length) setTimeout(riseStep,170);
      else { grid=finalGrid; drawGrid(); }
    };
    setTimeout(waterStep,220);
  } else if(currentLevel==='mondrian'){
    // Intro: černé linky se nakreslí nejdřív, pak se vybarví bloky
    const finalGrid=grid;
    const mySeq=introSeq;
    const blankG=[];
    for(let y=0;y<GH;y++)blankG.push(new Array(GW).fill(-1));
    grid=blankG;drawGrid();
    const lines=[],colors=[];
    for(let y=0;y<IMG_GH;y++)for(let x=0;x<GW;x++){
      const c=finalGrid[y][x];
      if(c===7)lines.push({x,y,c});
      else if(c>=0)colors.push({x,y,c});
    }
    let li=0;
    const lineStep=()=>{
      if(mySeq!==introSeq)return;
      const batch=12;
      for(let k=0;k<batch&&li<lines.length;k++,li++)grid[lines[li].y][lines[li].x]=lines[li].c;
      drawGrid();
      if(li<lines.length)setTimeout(lineStep,30);
      else setTimeout(colorStep,180);
    };
    let ci2=0;
    const colorStep=()=>{
      if(mySeq!==introSeq)return;
      const batch=10;
      for(let k=0;k<batch&&ci2<colors.length;k++,ci2++)grid[colors[ci2].y][colors[ci2].x]=colors[ci2].c;
      drawGrid();
      if(ci2<colors.length)setTimeout(colorStep,35);
    };
    setTimeout(lineStep,150);
  }
  updateGarages();
  drawGrid();drawBelt();drawPending();drawCarriers();
  setStatus('Klikni na aktivní nosič');
}
// ── UI: Difficulty badge ────────────────────────────────────────────────────
// Badge byl odstraněn (UI cleanup v28) — funkce zůstává jen jako no-op pro
// případné volání ze staršího kódu; celý výpočet imageDifficulty se dělá
// v editoru přes clComputeLevelStatus.
function updateDifficultyBadge(){}
// ── Event listeners ─────────────────────────────────────────────────────────
function setupDOM(){
  let levelIdx=LEVELS.findIndex(l=>l.key===currentLevel);
  if(levelIdx<0)levelIdx=0;
  function syncDiffButtons(){
    document.querySelectorAll('[data-diff]').forEach(b=>{
      if(b.dataset.diff===difficulty)b.classList.add('active'); else b.classList.remove('active');
    });
  }
  function stepLevel(dir){
    levelIdx=(levelIdx+dir+LEVELS.length)%LEVELS.length;
    currentLevel=LEVELS[levelIdx].key;
    document.getElementById('level-label').textContent=LEVELS[levelIdx].label;
    // Při přepnutí levelu aplikuj designer pin (defaultComplexity). Hráčova
    // explicitní volba v segment pickeru platí jen do dalšího přepnutí levelu —
    // tím se pin designera spolehlivě propaguje. AI override půjde přes totéž.
    difficulty=resolveDefaultDifficulty(currentLevel);
    syncDiffButtons();
    startLevel();
  }
  document.getElementById('level-label').textContent=LEVELS[levelIdx].label;
  document.getElementById('restart-btn').addEventListener('click',startLevel);
  document.getElementById('level-prev').addEventListener('click',()=>stepLevel(-1));
  document.getElementById('level-next').addEventListener('click',()=>stepLevel(1));
  // Difficulty segment: sync highlight s aktuálním state a přepínání.
  syncDiffButtons();
  document.querySelectorAll('[data-diff]').forEach(b=>{
    b.addEventListener('click',()=>{
      document.querySelectorAll('[data-diff]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');difficulty=b.dataset.diff;startLevel();
    });
  });
}

// ── Animation loop ───────────────────────────────────────────────────────────
function beltLoop(ts){
  if(lastBeltTime!==null&&!paused){
    const dt=(ts-lastBeltTime)/1000;
    const prevAnim=beltAnim;
    beltAnim+=dt*50;
    // Tah 8: periodický ammo-deficit check (každé ~4 s), ukáže warning
    // pokud garáž+belt+queue nestačí na zbývající pixely a bloky.
    // Audit panel renderujeme častěji (1 s), aby hráč průběžně viděl
    // celkový stav projektilů i když zrovna není deficit.
    ammoCheckTimer+=dt;
    if(ammoCheckTimer>=4){
      ammoCheckTimer=0;
      if(running&&anyLeft(grid)) checkAndWarnAmmoDeficit();
    } else if(running){
      if(!window._ammoAuditTimer) window._ammoAuditTimer=0;
      window._ammoAuditTimer+=dt;
      if(window._ammoAuditTimer>=1){
        window._ammoAuditTimer=0;
        renderAmmoAudit(computeAmmoAudit());
      }
    }
    // Drift detector: každý frame změříme totalHave/totalNeed; když HAVE
    // klesne víc než NEED (= projektil zmizel, aniž by zničil pixel/HP), je to leak.
    if(running){
      const cur=computeAmmoAudit();
      const prev=window._driftPrev;
      if(prev){
        const dHave=cur.totalHave-prev.totalHave;
        const dNeed=cur.totalNeed-prev.totalNeed;
        // Tolerujeme NEED rozkmit z mystery Math.ceil (per-color ±1).
        if(dHave<dNeed-0){
          const flyN=particles.filter(p=>p.phase==='fly').length;
          const popN=particles.filter(p=>p.phase==='pop').length;
          console.warn('[BB-LEAK]',{dHave,dNeed,have:cur.totalHave,need:cur.totalNeed,gunQ:gunQueue.length,fly:flyN,pop:popN,belt:belt.length,pending:pending.length,prev:{have:prev.totalHave,need:prev.totalNeed}});
        }
      }
      window._driftPrev={totalHave:cur.totalHave,totalNeed:cur.totalNeed};
    }
    checkLaunchPoint(prevAnim,beltAnim);

    if(gunQueue.length>0){
      // Cannon logika (immediate dispatch):
      //  1. Drop barvy co už nemají cíl (shift) — vyčistit queue na začátku.
      //  2. Najdi první barvu v queue co má střelu s LoS (pickCannonShot).
      //  3. Když žádná LoS → force-fire první barvu co má JAKÝKOLIV target.
      //  4. Pokud nic v queue nemá target → nic nestřílí (queue už byla vyčištěná).
      // Vybraná barva se přesune na začátek queue (aby šly po sobě).
      // Drop items, jejichž barva už nemá VŮBEC žádný target — ani sealed,
      // ani blok, ani mystery. Spawn prázdný „dud" pop u hlavně, aby hráč
      // viděl, že projektil byl ztracen (visible loss).
      for(let i=gunQueue.length-1;i>=0;i--){
        if(!hasAnyTargetForColor(gunQueue[i].ci)){
          const lost=gunQueue.splice(i,1)[0];
          const muzX=cannonX+Math.cos(cannonAngle)*14;
          const muzY=CANNON_Y+Math.sin(cannonAngle)*14;
          spawnPopShards(muzX,muzY,lost.color);
        }
      }
      if(gunQueue.length===0){ gunFireTimer=0; }
    }
    if(gunQueue.length>0){
      let item=gunQueue[0];
      // cannonLock drží vybraný cíl mezi framy, aby cannon nejiffroval
      // mezi podobnými cíly. LoS se revaliduje — pokud se mezi framy zavře
      // (novým pixelem nebo blokem), lock se zahodí a pickCannonShot
      // se zavolá čerstvě.
      if(cannonLock){
        if(cannonLock.ci!==item.ci) cannonLock=null;
        else if(cannonLock.kind==='block'){
          if(!cannonLock.blockRef||cannonLock.blockRef.hp<=0) cannonLock=null;
        }
        else if(!grid[cannonLock.gy]||grid[cannonLock.gy][cannonLock.gx]!==item.ci) cannonLock=null;
        // LoS revalidace — pokud cesta od hlavně k cíli už není čistá, zahoď.
        if(cannonLock){
          const muzX=cannonLock.idealX+Math.cos(cannonLock.angle)*14;
          const muzY=CANNON_Y+Math.sin(cannonLock.angle)*14;
          const tblk=cannonLock.kind==='block'?cannonLock.blockRef:null;
          if(!simulateShotReaches(muzX,muzY,cannonLock.angle,item.ci,240,tblk)){
            cannonLock=null;
          }
        }
      }
      let shot=cannonLock;
      let chosenIdx=0;
      if(!shot){
        // 1. Zkus čistou LoS (simulate) pro front, pak alternativy v queue.
        let picked=pickCannonShot(item.ci,cannonX,CANNON_Y);
        if(!picked){
          for(let i=1;i<gunQueue.length;i++){
            const alt=pickCannonShot(gunQueue[i].ci,cannonX,CANNON_Y);
            if(alt){ picked=alt; chosenIdx=i; item=gunQueue[i]; break; }
          }
        }
        // 2. Žádná čistá LoS → blocked-angle force-fire na první queue barvu
        // co má JAKÝKOLIV target. Particle pak fyzikálně bounce-uje a hledá.
        if(!picked){
          for(let i=0;i<gunQueue.length;i++){
            if(hasAnyTargetForColor(gunQueue[i].ci)){
              const f=pickCannonShotForceBlocked(gunQueue[i].ci,cannonX,CANNON_Y);
              if(f){ picked=f; chosenIdx=i; item=gunQueue[i]; break; }
            }
          }
        }
        if(!picked) cannonIdleT+=dt; else { cannonIdleT=0; }
        if(picked){
          // Posuň vybraný item na začátek queue, aby následné výstřely šly stejné barvy.
          if(chosenIdx>0){
            const [p]=gunQueue.splice(chosenIdx,1);
            gunQueue.unshift(p);
          }
          // Debug: když je target za blokem, logujeme — hlídáme tunneling bug.
          {
            const tgx=Math.floor(picked.tx/SCALE), tgy=Math.floor(picked.ty/SCALE);
            const blocksBetween=[];
            for(const b of currentBlocks){
              if(b.hp<=0)continue;
              const bcx=(b.x+b.w/2)*SCALE, bcy=(b.y+b.h/2)*SCALE;
              const fromC=Math.hypot(bcx-cannonX,bcy-CANNON_Y);
              const fromT=Math.hypot(bcx-picked.tx,bcy-picked.ty);
              const ct=Math.hypot(picked.tx-cannonX,picked.ty-CANNON_Y);
              if(fromC<ct && fromT<ct && b.color!==item.ci && b.kind!=='mystery'){
                blocksBetween.push({col:b.color,hp:b.hp,x:b.x,y:b.y});
              }
            }
            if(blocksBetween.length) console.warn('[BB-AIM] target behind wrong-color block', {ci:item.ci, tgx, tgy, type:picked.type, kind:picked.kind, blocksBetween});
          }
          cannonLock={ci:item.ci,gx:Math.floor(picked.tx/SCALE),gy:Math.floor(picked.ty/SCALE),
                      idealX:picked.idealX,angle:picked.angle,type:picked.type,
                      kind:picked.kind||'pixel',blockRef:picked.blockRef||null};
          shot=cannonLock;
        } else {
          gunFireTimer=0;
        }
      }
      if(shot){
        const ddx=shot.idealX-cannonX;
        const step=CANNON_SPEED*dt;
        if(Math.abs(ddx)<=step) cannonX=shot.idealX;
        else cannonX+=Math.sign(ddx)*step;
        cannonAngle=shot.angle;
        if(Math.abs(shot.idealX-cannonX)<=CANNON_ARRIVE_EPS){
          gunFireTimer+=dt;
          if(gunFireTimer>=GUN_FIRE_INTERVAL){
            gunFireTimer=0;
            cannonIdleT=0;
            gunQueue.shift();
            cannonLock=null;
            cannonSideShots++;
            const a=cannonAngle+(Math.random()-0.5)*0.06;
            const muzzleX=cannonX+Math.cos(cannonAngle)*14;
            const muzzleY=CANNON_Y+Math.sin(cannonAngle)*14;
            console.log('[BB-DEBUG] cannon FIRE', {ci:item.ci, targetKind:shot.kind, tBlockColor: shot.blockRef?shot.blockRef.color:null, tBlockHP: shot.blockRef?shot.blockRef.hp:null, type:shot.type});
            particles.push({
              x:muzzleX,y:muzzleY,
              vx:Math.cos(a)*PSPEED,vy:Math.sin(a)*PSPEED,
              ci:item.ci,color:item.color,
              phase:'fly',stuckT:0,bounceStreak:0,totalT:0,
              popR:0,popX:0,popY:0,onPop:()=>{}
            });
          }
        } else {
          gunFireTimer=0;
        }
      }
    } else {
      const diff=(-Math.PI/2)-cannonAngle;
      cannonAngle+=diff*Math.min(1,dt*4);
      gunFireTimer=0;
      cannonSidePref=0;cannonSideShots=0;
    }

    updateParticles(dt);
    updatePending(dt);
  }
  lastBeltTime=ts;
  drawBelt();
  drawParticles();
  drawPending();
  requestAnimationFrame(beltLoop);
}

// ── Gamee SDK entry point (called by body onload) ────────────────────────────
function initGame(){
  // Default level = first in LEVELS (so reordering in the editor actually
  // changes which level the game opens on). The hardcoded `currentLevel='smiley'`
  // at the top of this file is just a static init value from before LEVELS
  // existed; honor the editor's order here.
  if(LEVELS[0]&&LEVELS[0].key)currentLevel=LEVELS[0].key;

  // Dev override via URL (?level=KEY&diff=easy) — for editor iframe preview.
  // Applied BEFORE setupDOM so levelIdx is correct; re-applied inside gameInit
  // callback so it also wins over any saveState data.
  // Precedence pro difficulty: URL ?diff > saveState > designer pin
  // (defaultComplexity) > 'easy'. Flag _diffFromUrl si pamatujeme, ať ho
  // saveState v callbacku nepřeválcuje.
  let _diffFromUrl=false;
  try{
    const url=new URL(location.href);
    const p=url.searchParams.get('level');
    if(p&&LEVELS.some(l=>l.key===p))currentLevel=p;
    const d=url.searchParams.get('diff');
    if(d&&['easy','medium','hard'].includes(d)){difficulty=d;_diffFromUrl=true;}
  }catch(e){}
  // Pokud URL neurčila diff, aplikuj designer pin pro aktuální level. Pokud
  // saveState má vlastní difficulty, tu aplikujeme níže v gameInit callbacku.
  if(!_diffFromUrl)difficulty=resolveDefaultDifficulty(currentLevel);
  setupDOM();
  initParticleCanvas();
  // beltLoop se spustí až ve startLevel (po inicializaci stavu) – jinak by crashnul na undefined belt/grid

  gamee.gameInit('FullScreen',{},['saveState'],function(error,data){
    if(error!==null)throw error;
    if(typeof data==='string')data=JSON.parse(data);

    if(data.saveState){
      try{
        const saved=typeof data.saveState==='string'?JSON.parse(data.saveState):data.saveState;
        // Only honor saveState.level if it still exists in LEVELS (editor may
        // have removed/renamed it). Otherwise fall back to LEVELS[0].
        let levelChanged=false;
        if(saved.level&&LEVELS.some(l=>l.key===saved.level)&&saved.level!==currentLevel){
          currentLevel=saved.level;levelChanged=true;
        }
        // saveState.difficulty platí jen když URL explicitně nepřebíjí.
        if(saved.difficulty&&!_diffFromUrl)difficulty=saved.difficulty;
        // Když saveState změnil level a nemáme URL override ani vlastní diff
        // v saveState, přepni na designer pin nového levelu.
        else if(levelChanged&&!_diffFromUrl)difficulty=resolveDefaultDifficulty(currentLevel);
      }catch(e){console.warn('saveState parse failed',e);}
    }

    gamee.emitter.addEventListener('start',function(event){
      startLevel();
      event.detail.callback();
    });
    gamee.emitter.addEventListener('pause',function(event){
      paused=true;
      event.detail.callback();
    });
    gamee.emitter.addEventListener('resume',function(event){
      paused=false;
      lastBeltTime=null;
      event.detail.callback();
    });
    gamee.emitter.addEventListener('mute',function(event){
      event.detail.callback();
    });
    gamee.emitter.addEventListener('unmute',function(event){
      event.detail.callback();
    });
    gamee.emitter.addEventListener('submit',function(event){
      gamee.updateScore(score,playTime,'balloon-belt-v51');
      event.detail.callback();
    });

    gamee.gameReady();
  });
}

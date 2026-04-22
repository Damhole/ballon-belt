const COLORS=['#3dd64a','#ff7a1a','#5bc8f5','#1b9aff','#ff4fa3','#f5d800','#8b4dff','#141414','#ffffff'];
const BELT_CAP=14;
const COLS=7;
const GW=36,GH=31,IMG_GH=27;
const UPC=4;
const PPU=10;
// Raketové nosiče – per level 2 nosiče, každý má předem danou 1 cílovou barvu (level design).
const ROCKET_TARGETS={
  smiley:[8,7],
  moon:[8,5],
  starwars:[5,1],
  frog:[0,7]
};
const GARAGE_DEFS={
  smiley:{col:3,carriers:[{color:3},{color:0},{color:4}]},
  moon:  {col:4,carriers:[{color:5},{color:2},{color:6}]},
  starwars:{col:3,carriers:[{color:5},{color:1},{color:8}]},
  frog:  {col:3,carriers:[{color:0},{color:7},{color:3}]},
};
let grid,belt,pending,columns,score,loops,running,difficulty='easy',gravityOn=false,rocketsOn=false,garageMode='off',currentLevel='smiley';
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
function nearestSameColor(ci,px,py){
  let best=null,bd=Infinity;
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    if(grid[y][x]!==ci)continue;
    const tx=x*SCALE+SCALE/2,ty=y*SCALE+SCALE/2;
    const d=(tx-px)**2+(ty-py)**2;
    if(d<bd){bd=d;best={tx,ty};}
  }
  return best;
}

// Vybere střelu pro kanon: vrátí {idealX, angle, dist, type} pro nejlepší cíl barvy ci.
// Upřednostňuje přímé zásahy, jinak zkusí odraz od levé/pravé stěny nebo stropu.
// Když nic čisté není, vrátí direct s penaltou (projektil se zkusí proflákat přes odraz).
// Zkusí najít úhel (přímý nebo odrazový), který simulací trefí cíl. Vrací {angle,type} nebo null.
function findShotFromX(idealX,cannonYPos,tx,ty,ci){
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
    if(simulateShotReaches(mx,my,tr.angle,ci)) return tr;
  }
  return null;
}

function pickCannonShot(ci,cannonXPos,cannonYPos){
  const exposed=getExposedPixelsOfColor(grid,ci);
  if(!exposed.length)return null;
  const candidates=[];
  for(const {x,y} of exposed){
    const tx=x*SCALE+SCALE/2, ty=y*SCALE+SCALE/2;
    const rawIdeal=cannonXPos+(tx-cannonXPos)*CANNON_LEAD;
    const lerpX=Math.max(CANNON_MIN_X,Math.min(CANNON_MAX_X,rawIdeal));
    const underX=Math.max(CANNON_MIN_X,Math.min(CANNON_MAX_X,tx));
    // Zkus různé pozice kanonu – od preferované (lerp) po krajní fallbacky.
    // První pozice s úspěšnou trajektorií vyhrává.
    const positions=[lerpX,underX,CANNON_MIN_X+20,CANNON_MAX_X-20];
    let found=null;
    for(const pos of positions){
      const shot=findShotFromX(pos,cannonYPos,tx,ty,ci);
      if(shot){found={idealX:pos,angle:shot.angle,type:shot.type};break;}
    }
    if(found){
      candidates.push({idealX:found.idealX,tx,ty,angle:found.angle,type:found.type});
    } else {
      // Skutečně žádná cesta – blokovaný fallback (použijeme jen pokud fakt nic lepšího není)
      candidates.push({idealX:lerpX,tx,ty,angle:Math.atan2(ty-cannonYPos,tx-lerpX),type:'blocked'});
    }
  }
  const typeWeight={direct:0,'bank-L':1,'bank-R':1,'bank-T':2,blocked:3};
  // Kanon se „rozhoduje" po CANNON_SIDE_COMMIT ranách: zjistí, kde má víc cílů (levá/pravá
  // polovina plátna) a commitne se na tu stranu. Bez kmitání po jednom projektilu, ale
  // zároveň nezanedbá druhou stranu, když tam zbývá víc kuliček.
  const midX=(CANNON_MIN_X+CANNON_MAX_X)/2;
  const pool=candidates.filter(c=>c.type!=='blocked');
  const active=pool.length?pool:candidates;
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
  const pos=randomFreePos();
  p.x=pos.x; p.y=pos.y;
  // Namíř k nejbližšímu cíli (s rozptylem) nebo náhodně
  const near=nearestSameColor(p.ci,p.x,p.y);
  if(near){
    const a=Math.atan2(near.ty-p.y,near.tx-p.x)+(Math.random()-0.5)*PSPREAD;
    p.vx=Math.cos(a)*PSPEED; p.vy=Math.sin(a)*PSPEED;
  } else {
    const a=Math.random()*Math.PI*2;
    p.vx=Math.cos(a)*PSPEED; p.vy=Math.sin(a)*PSPEED;
  }
  p.stuckT=0; p.bounceStreak=0; p.totalT=0;
}

// Odsimuluje let projektilu stejnou fyzikou jako updateParticles (odraz od stěn, pohyb dt=1/60).
// Vrátí true, když první zasažený barevný pixel = targetCi. Špatná barva = false.
function simulateShotReaches(sx,sy,angle,targetCi,maxSteps=240){
  let x=sx,y=sy;
  let vx=Math.cos(angle)*PSPEED, vy=Math.sin(angle)*PSPEED;
  const dt=1/60;
  const YMAX=GH*SCALE-2;
  for(let s=0;s<maxSteps;s++){
    let nx=x+vx*dt, ny=y+vy*dt;
    if(nx<1){nx=1; vx=Math.abs(vx);}
    else if(nx>358){nx=358; vx=-Math.abs(vx);}
    if(ny<2){ny=2; vy=Math.abs(vy);}
    else if(ny>YMAX) return false;
    const gx=Math.floor(nx/SCALE), gy=Math.floor(ny/SCALE);
    if(gy>=0&&gy<GH&&gx>=0&&gx<GW){
      const cell=grid[gy][gx];
      if(cell===targetCi) return true;
      if(cell>-1) return false;
    }
    x=nx; y=ny;
  }
  return false;
}
function hasLineOfSight(x1,y1,x2,y2,ownColor){
  // Paprsek z (x1,y1) do (x2,y2) – vrátí false pokud kříží špatnou barvu
  const dx=x2-x1,dy=y2-y1;
  const steps=Math.max(4,Math.ceil(Math.sqrt(dx*dx+dy*dy)/(SCALE*0.5)));
  for(let s=1;s<steps;s++){
    const t=s/steps;
    const gx=Math.floor((x1+dx*t)/SCALE);
    const gy=Math.floor((y1+dy*t)/SCALE);
    if(gy<0||gy>=IMG_GH||gx<0||gx>=GW)continue;
    const cell=grid[gy][gx];
    if(cell!==-1&&cell!==ownColor)return false;
  }
  return true;
}

function steerAfterBounce(p){
  const near=nearestSameColor(p.ci,p.x,p.y);
  if(!near)return;
  const dx=near.tx-p.x,dy=near.ty-p.y;
  const baseAngle=Math.atan2(dy,dx);
  if(hasLineOfSight(p.x,p.y,near.tx,near.ty,p.ci)){
    // Volná cesta → namíř k cíli s mírným rozptylem
    const angle=baseAngle+(Math.random()-0.5)*PSPREAD;
    p.vx=Math.cos(angle)*PSPEED;
    p.vy=Math.sin(angle)*PSPEED;
  } else if(p.y>=(IMG_GH-2)*SCALE){
    // V buffer zóně pod obrazcem a cesta blokována → vždy zamíř nahoru
    // s náhodným horizontálním rozptylem aby zkoušela různé vstupní sloupce
    const angle=-Math.PI/2+(Math.random()-0.5)*Math.PI*0.85;
    p.vx=Math.cos(angle)*PSPEED;
    p.vy=Math.sin(angle)*PSPEED;
  } else {
    // Uvnitř obrazce, cesta blokována → prohledej kolem překážky ±120°
    const angle=baseAngle+(Math.random()-0.5)*Math.PI*1.3;
    p.vx=Math.cos(angle)*PSPEED;
    p.vy=Math.sin(angle)*PSPEED;
  }
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
          gamee.updateScore(score,playTime,'balloon-belt-v21');
        }
        // Rázová vlna
        particles.push({phase:'pop',ci:p.ci,color:p.color,popR:0,popX:p.tx,popY:p.ty,maxPopR:42,onPop:()=>{}});
        particles.splice(i,1);
        if(running&&!anyLeft(grid)){setTimeout(()=>{if(running)endGame(true);},80);}
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

    // Celkový čas letu – absolutní pojistka proti nekonečným smyčkám
    p.totalT=(p.totalT||0)+dt;
    if(p.totalT>6.0){respawnParticle(p);}

    // Udržuj konstantní rychlost (billiard – bez wobble, přímý let)
    const spd=Math.sqrt(p.vx*p.vx+p.vy*p.vy)||1;
    p.vx=p.vx/spd*PSPEED; p.vy=p.vy/spd*PSPEED;

    // Pokud žádný pixel vlastní barvy nezbývá → pop
    const hasTarget=nearestSameColor(p.ci,p.x,p.y);
    if(!hasTarget){p.phase='pop';p.popX=p.x;p.popY=p.y;p.onPop();continue;}

    // Navrhovaná nová pozice
    let nx=p.x+p.vx*dt, ny=p.y+p.vy*dt;
    let wallBounced=false;

    // Odraz od stěn → po stěně nasměruj k cíli
    const YMAX=GH*SCALE-2;
    if(nx<1){nx=1;p.vx=Math.abs(p.vx);wallBounced=true;}
    if(nx>358){nx=358;p.vx=-Math.abs(p.vx);wallBounced=true;}
    if(ny<2){ny=2;p.vy=Math.abs(p.vy);wallBounced=true;}
    if(ny>YMAX){ny=YMAX;p.vy=-Math.abs(p.vy);wallBounced=true;}

    // Kontrola gridu
    const gx=Math.floor(nx/SCALE), gy=Math.floor(ny/SCALE);
    const cell=(gy>=0&&gy<GH&&gx>=0&&gx<GW)?grid[gy][gx]:-1;

    let anyBounce=wallBounced;

    if(cell===p.ci){
      // Vlastní barva → znič pixel
      grid[gy][gx]=-1;
      if(gravityOn)applyGravityToCol(grid,gx);
      drawGrid();
      p.phase='pop'; p.popX=nx; p.popY=ny; p.onPop();
      spawnPopShards(nx,ny,p.color);
      if(running&&!anyLeft(grid)){
        particles.forEach(q=>{if(q.phase==='fly'){q.phase='pop';q.popX=q.x;q.popY=q.y;}});
        setTimeout(()=>{if(running)endGame(true);},80);
      }
    } else if(cell>-1){
      // Špatná barva → fyzikální odraz ze strany nárazu
      const prevGx=Math.floor(p.x/SCALE),prevGy=Math.floor(p.y/SCALE);
      if(prevGx!==gx)p.vx=-p.vx;
      if(prevGy!==gy)p.vy=-p.vy;
      if(prevGx===gx&&prevGy===gy){p.vx=-p.vx;p.vy=-p.vy;}
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
  const nextColor=gunQueue.length>0?gunQueue[0].color:null;
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
function makeGrid(){
  let g;
  if(currentLevel==='moon')g=makeGridMoon();
  else if(currentLevel==='starwars')g=makeGridC3PO();
  else if(currentLevel==='frog')g=makeGridFrog();
  else if(currentLevel==='mondrian')g=makeGridMondrian();
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
  return s;
}
function anyLeft(g){
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++)if(g[y][x]!==-1)return true;
  return false;
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
function makeColumns(pxCounts){
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
      const empty=slot===null||(slot&&slot.wall===true);
      const active=!empty&&isCarrierActive(c,r);
      const hidden=!empty&&!active&&slot.hidden===true;
      const isGarage=!empty&&slot&&slot.type==='garage';
      const garageLocked=isGarage&&!active;
      const div=document.createElement('div');
      div.className='carrier '+(empty?'empty':isGarage?('garage'+(garageLocked?' locked':'')):active?'active':hidden?'hiddenq':'inactive');
      if(empty){
        div.innerHTML='';
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
        columns[nc][nr]={color:next.color,projectiles:UPC*PPU};
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
    const pxNow=countPixels(grid);
    if((pxNow[color]||0)===0){
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
    if(!avail.has(color)){
      // Špatná barva – projede dál
      noMatchPasses++;
      // Okamžitá kontrola: pokud žádná barva na pásu nesedí → nemusíme čekat na kolečko
      const beltColors=new Set(belt.map(b=>b.ci));
      const anyMatch=[...beltColors].some(c=>avail.has(c));
      if(!anyMatch||noMatchPasses>=BELT_CAP){
        noMatchPasses=0;
        if(belt.length>=BELT_CAP){endGame(false);return;}
        if(anyLeft(grid)){
          const def=computeAmmoDeficit();
          if(def.some(d=>d>0))refillCarriers();
          else setStatus('Žádná shoda – přidej jinou barvu');
        }
      }
      continue;
    }

    const exposedCount=getReachableCountOfColor(grid,color);
    const alreadyFlying=particles.filter(p=>p.phase==='fly'&&p.ci===color).length;
    const inQueue=gunQueue.filter(q=>q.ci===color).length;
    const totalActive=alreadyFlying+inQueue;

    if(exposedCount===0||totalActive>=exposedCount){
      // Dost projektilů už lítá pro aktuálně odkryté pixely – koule projede bez konzumace
      stuckPassCount++;
      if(stuckPassCount>=BELT_CAP*2){
        if(belt.length>=BELT_CAP){
          // Pás plný a žádná koule se nespotřebuje → zamčený stav, konec
          endGame(false);
          return;
        }
        if(anyLeft(grid)){
          const def=computeAmmoDeficit();
          if(def.some(d=>d>0)){
            stuckPassCount=0;
            refillCarriers();
          }
        }
      }
      continue;
    }
    stuckPassCount=0;

    // Spotřebuj celou kouli → vystřel všech ball.ppu projektilů najednou
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
    gamee.updateScore(score,playTime,'balloon-belt-v21');
    setStatus('Zásah!');

    if(belt.length===0&&anyLeft(grid)){
      setTimeout(()=>{
        if(!running||!anyLeft(grid))return;
        const def=computeAmmoDeficit();
        if(def.some(d=>d>0))refillCarriers();
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
  const pxCounts=countPixels(grid);
  const deficits=new Array(COLORS.length).fill(0);
  for(let c=0;c<COLORS.length;c++){
    if(!pxCounts[c])continue;
    let proj=0;
    for(let col=0;col<COLS;col++)for(const s of columns[col]){
      if(!s)continue;
      if(s.type==='garage'){for(const gc of s.queue)if(gc.color===c)proj+=UPC*PPU;}
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
function refillCarriers(){
  const deficits=computeAmmoDeficit();
  let added=0;
  for(let c=0;c<COLORS.length;c++){
    if(deficits[c]<=0)continue;
    for(const slot of splitIntoCarriers(c,deficits[c])){
      let shortest=0;
      for(let k=1;k<COLS;k++)if(columns[k].length<columns[shortest].length)shortest=k;
      columns[shortest].push({color:slot.color,hidden:difficulty==='hard',projectiles:slot.projectiles});
      added++;
    }
  }
  drawCarriers();
  if(added)setStatus('Záchranné nosiče doplněny (+'+added+')');
}
function setStatus(m){document.getElementById('status').textContent=m;}
function endGame(win){
  running=false;
  if(playTimer){clearInterval(playTimer);playTimer=null;}
  gamee.updateScore(score,playTime,'balloon-belt-v21');
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
  if(playTimer)clearInterval(playTimer);
  playTime=0;
  playTimer=setInterval(function(){if(!paused&&running)playTime++;},1000);
  gamee.gameStart();
  if(!beltLoopStarted){beltLoopStarted=true;lastBeltTime=null;requestAnimationFrame(beltLoop);}
  grid=makeGrid();belt=[];pending=[];nudgeTimer=0;funnelWarnTimer=0;score=0;loops=0;running=true;noMatchPasses=0;stuckPassCount=0;
  particles=[];shards=[];confetti=[];gunQueue=[];gunFireTimer=0;cannonX=LAUNCH_X;cannonAngle=-Math.PI/2;cannonLock=null;cannonSidePref=0;cannonSideShots=0;
  columns=makeColumns(countPixels(grid));
  // Injekce raketových nosičů – per level předdefinované 2 pozice
  const rockets=rocketsOn?ROCKET_TARGETS[currentLevel]:null;
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
  if(garageMode!=='off'&&GARAGE_DEFS[currentLevel]){
    const {col:gcol,carriers:gcarriers}=GARAGE_DEFS[currentLevel];
    let injected=false;
    for(let attempt=0;attempt<10&&!injected;attempt++){
      if(attempt>0)columns=makeColumns(countPixels(grid));
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
// ── Event listeners ─────────────────────────────────────────────────────────
function setupDOM(){
  const LEVELS=[{key:'smiley',label:'smajlík'},{key:'moon',label:'měsíc'},{key:'starwars',label:'C-3PO'},{key:'frog',label:'žabka'},{key:'mondrian',label:'Mondrian'}];
  let levelIdx=LEVELS.findIndex(l=>l.key===currentLevel);
  if(levelIdx<0)levelIdx=0;
  function stepLevel(dir){
    levelIdx=(levelIdx+dir+LEVELS.length)%LEVELS.length;
    currentLevel=LEVELS[levelIdx].key;
    document.getElementById('level-label').textContent=LEVELS[levelIdx].label;
    startLevel();
  }
  document.getElementById('level-label').textContent=LEVELS[levelIdx].label;
  document.getElementById('restart-btn').addEventListener('click',startLevel);
  document.getElementById('level-prev').addEventListener('click',()=>stepLevel(-1));
  document.getElementById('level-next').addEventListener('click',()=>stepLevel(1));
  document.querySelectorAll('[data-diff]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('[data-diff]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');difficulty=b.dataset.diff;startLevel();
  }));
  document.getElementById('specials-toggle').addEventListener('click',()=>{
    document.getElementById('specials-panel').classList.toggle('open');
    document.getElementById('specials-chevron').classList.toggle('open');
  });
  document.getElementById('gravity-btn').addEventListener('click',()=>{
    gravityOn=!gravityOn;
    const btn=document.getElementById('gravity-btn');
    btn.textContent=gravityOn?'zapnuto':'vypnuto';
    btn.classList.toggle('active',gravityOn);
    startLevel();
  });
  document.getElementById('rockets-btn').addEventListener('click',()=>{
    rocketsOn=!rocketsOn;
    const btn=document.getElementById('rockets-btn');
    btn.textContent=rocketsOn?'zapnuto':'vypnuto';
    btn.classList.toggle('active',rocketsOn);
    startLevel();
  });
  document.getElementById('garage-btn').addEventListener('click',()=>{
    garageMode=garageMode==='off'?'single':garageMode==='single'?'multi':'off';
    const btn=document.getElementById('garage-btn');
    const labels={off:'vypnuto',single:'1 směr',multi:'více směrů'};
    btn.textContent=labels[garageMode];
    btn.classList.toggle('active',garageMode!=='off');
    startLevel();
  });
}

// ── Animation loop ───────────────────────────────────────────────────────────
function beltLoop(ts){
  if(lastBeltTime!==null&&!paused){
    const dt=(ts-lastBeltTime)/1000;
    const prevAnim=beltAnim;
    beltAnim+=dt*50;
    checkLaunchPoint(prevAnim,beltAnim);

    if(gunQueue.length>0){
      const item=gunQueue[0];
      if(cannonLock){
        if(cannonLock.ci!==item.ci) cannonLock=null;
        else if(grid[cannonLock.gy]&&grid[cannonLock.gy][cannonLock.gx]!==item.ci) cannonLock=null;
      }
      let shot=cannonLock;
      if(!shot){
        const picked=pickCannonShot(item.ci,cannonX,CANNON_Y);
        if(picked){
          cannonLock={ci:item.ci,gx:Math.floor(picked.tx/SCALE),gy:Math.floor(picked.ty/SCALE),
                      idealX:picked.idealX,angle:picked.angle,type:picked.type};
          shot=cannonLock;
        }
      }
      if(!shot){
        gunQueue.shift();
        gunFireTimer=0;
      } else {
        const ddx=shot.idealX-cannonX;
        const step=CANNON_SPEED*dt;
        if(Math.abs(ddx)<=step) cannonX=shot.idealX;
        else cannonX+=Math.sign(ddx)*step;
        cannonAngle=shot.angle;
        if(Math.abs(shot.idealX-cannonX)<=CANNON_ARRIVE_EPS){
          gunFireTimer+=dt;
          if(gunFireTimer>=GUN_FIRE_INTERVAL){
            gunFireTimer=0;
            gunQueue.shift();
            cannonLock=null;
            cannonSideShots++;
            const a=cannonAngle+(Math.random()-0.5)*0.06;
            const muzzleX=cannonX+Math.cos(cannonAngle)*14;
            const muzzleY=CANNON_Y+Math.sin(cannonAngle)*14;
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
  setupDOM();
  initParticleCanvas();
  // beltLoop se spustí až ve startLevel (po inicializaci stavu) – jinak by crashnul na undefined belt/grid

  gamee.gameInit('FullScreen',{},['saveState'],function(error,data){
    if(error!==null)throw error;
    if(typeof data==='string')data=JSON.parse(data);

    if(data.saveState){
      try{
        const saved=typeof data.saveState==='string'?JSON.parse(data.saveState):data.saveState;
        if(saved.level)currentLevel=saved.level;
        if(saved.difficulty)difficulty=saved.difficulty;
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
      gamee.updateScore(score,playTime,'balloon-belt-v21');
      event.detail.callback();
    });

    gamee.gameReady();
  });
}

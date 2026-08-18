import pkg from 'playwright';
const { chromium, devices } = pkg;
const browser = await chromium.launch();
const errs=[], problems=[];
const check=(c,m,x)=>{ if(!c) problems.push(m+' :: '+JSON.stringify(x)); };
const ctx = await browser.newContext({ viewport:{width:396,height:900}, hasTouch:true, isMobile:true, deviceScaleFactor:3 });
const page = await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await page.goto('file://' + process.cwd() + '/harness.html');
await page.waitForTimeout(600);

const layout = await page.evaluate(()=>{
  const r=document.getElementById('kbroot').getBoundingClientRect();
  const bot=document.getElementById('sideBot').getBoundingClientRect();
  const board=document.getElementById('botBoard').getBoundingClientRect();
  return { rootW:Math.round(r.width), rootH:Math.round(r.height),
    cell:getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
    botBottom:Math.round(bot.bottom-r.top), boardW:Math.round(board.width),
    fixedCount:[...document.querySelectorAll('#kbroot *')].filter(e=>getComputedStyle(e).position==='fixed').length,
    docScrollW:document.documentElement.scrollWidth, winW:window.innerWidth };
});
check(layout.fixedCount===0,'position:fixed survived the port',layout);
check(layout.botBottom<=layout.rootH,'bottom half overflows the shell',layout);
check(layout.docScrollW<=layout.winW+1,'widget causes horizontal scroll',layout);
await page.screenshot({path:'./w-start.png'});

const snap=()=>page.evaluate(()=>{const k=window.__kb,S=k.S;const o=s=>+document.getElementById(s).dataset.owner;
  return {phase:S.phase,turn:S.turn,bottom:S.bottom,mode:S.mode,b0:S.boards[0],b1:S.boards[1],
    ownerTop:o('sideTop'),ownerBot:o('sideBot'),
    domTop:document.querySelectorAll('#topBoard .die').length,
    domBot:document.querySelectorAll('#botBoard .die').length,
    pass:document.getElementById('ovPass').classList.contains('on'),
    end:document.getElementById('ovEnd').classList.contains('on')};});
function audit(s,w){
  const tc=(s.ownerTop===0?s.b0:s.b1).flat().length, bc=(s.ownerBot===0?s.b0:s.b1).flat().length;
  check(s.domTop===tc,w+': top DOM != state',{...s});
  check(s.domBot===bc,w+': bot DOM != state',{...s});
  if(s.mode==='duo'&&s.phase==='choose') check(s.turn===s.bottom,w+': active player not on bottom',s);
}
// ---- CPU game by touch ----
// Loop budgets are generous on purpose: games are random, destruction-heavy
// endgames run long, and CI runners are slow. (A 400-tick budget flaked on CI.)
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#btnPlay'); await page.waitForTimeout(1800);
let cpuDone=false;
for(let i=0;i<1200;i++){ const s=await snap(); audit(s,'cpu'+i);
  if(s.end||s.phase==='over'){cpuDone=true;break;}
  if(s.phase==='choose'&&s.turn===1){ const lg=s.b1.map((c,j)=>c.length<3?j:-1).filter(j=>j>=0);
    await page.tap(`#botBoard .col[data-col="${lg[(Math.random()*lg.length)|0]}"]`); }
  await page.waitForTimeout(95); }
await page.waitForTimeout(1500);
await page.screenshot({path:'./w-end.png'});
const cpuEnd=await page.evaluate(()=>({shown:document.getElementById('ovEnd').classList.contains('on'),
  title:document.getElementById('endTitle').textContent,
  you:+document.getElementById('endYou').textContent,cpu:+document.getElementById('endCpu').textContent,
  realYou:window.__kb.boardTotal(window.__kb.S.boards[1]),realCpu:window.__kb.boardTotal(window.__kb.S.boards[0])}));
check(cpuEnd.you===cpuEnd.realYou&&cpuEnd.cpu===cpuEnd.realCpu,'end scores mismatch',cpuEnd);
// a decided game settles the shared board: no plate still claims a live turn,
// no column still offers itself. Both flows go through render.settleBoard().
const settled=await page.evaluate(()=>({active:document.querySelectorAll('.plate.active').length,
  legal:document.querySelectorAll('.col.legal').length,pills:document.querySelectorAll('.chip .dl.show').length}));
check(settled.active===0&&settled.legal===0&&settled.pills===0,'board still live after game over',settled);

// ---- duo game by touch ----
await page.tap('#btnMenu2'); await page.waitForTimeout(500);
await page.tap('#modeSeg button[data-m="duo"]'); await page.waitForTimeout(200);
await page.tap('#btnPlay'); await page.waitForTimeout(1200);
let handoffs=0,duoDone=false;
for(let i=0;i<1200;i++){ const s=await snap(); audit(s,'duo'+i);
  if(s.end||s.phase==='over'){duoDone=true;break;}
  if(s.pass){ const before=s.bottom; await page.tap('#ovPass'); await page.waitForTimeout(300);
    const a=await snap(); check(a.bottom!==before,'pass did not swap',{before,a}); handoffs++; continue; }
  if(s.phase==='choose'){ const bd=s.turn===0?s.b0:s.b1;
    const lg=bd.map((c,j)=>c.length<3?j:-1).filter(j=>j>=0);
    await page.tap(`#botBoard .col[data-col="${lg[(Math.random()*lg.length)|0]}"]`); }
  await page.waitForTimeout(95); }
await page.waitForTimeout(800);
await page.screenshot({path:'./w-duo.png'});
const grew=await page.evaluate(()=>document.getElementById('kbroot').getBoundingClientRect().height);
console.log(JSON.stringify({layout,cpuDone,cpuEnd,duo:{handoffs,duoDone},shellHeight:grew,problems,errs},null,2));
await browser.close();

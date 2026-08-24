import pkg from 'playwright';
const { chromium, devices } = pkg;
import { shot } from './shot.mjs';
const browser = await chromium.launch();
const errs=[], problems=[];
const check=(c,m,x)=>{ if(!c) problems.push(m+' :: '+JSON.stringify(x)); };
const ctx = await browser.newContext({ viewport:{width:396,height:900}, hasTouch:true,
  isMobile:true, deviceScaleFactor:3, locale:'en-US' });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const page = await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await page.goto('file://' + process.cwd() + '/harness.html');
await page.waitForTimeout(600);

/* The host page is deliberately opinionated. Widget CSS/state must stay below
   #kbroot: the outer custom properties, box model and page paint are sentinels
   for the old global-token, universal-reset and documentElement leaks. */
const isolation = await page.evaluate(() => {
  const root = document.getElementById('kbroot');
  const host = document.getElementById('hostSentinel');
  /* Common host class names, deliberately outside the widget. CSS containment
     does not scope selectors, so these catch an unrooted `.btn`, `.card`,
     `.die`, `.ov` or `.faceoff` in the widget's injected stylesheet. Keep the
     coordinate target here too, before the runtime-insertion observer starts. */
  const hostCases = document.createElement('div');
  hostCases.id = 'hostClassSentinels';
  hostCases.style.cssText = 'position:absolute;left:-10000px;top:0;width:120px;height:120px';
  hostCases.innerHTML = '<button id="hostBtn" class="btn">host</button>'
    + '<div id="hostCard" class="card"></div><div id="hostDie" class="die"></div>'
    + '<div id="hostOv" class="ov"></div><div id="hostFaceoff" class="faceoff"></div>'
    + '<div id="hostAim" class="col" data-col="0"></div>';
  document.body.insertBefore(hostCases, root);
  const style = (id) => getComputedStyle(document.getElementById(id));
  const hostBtn = style('hostBtn');
  const states = ['rowmode','rowswitch','face','p2turn','land','shortv','sidepts',
    'casting','castself','numerals','clock','tut'];
  window.__outsideRootAdds = [];
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node !== root) {
        window.__outsideRootAdds.push(node.id || node.className || node.tagName);
      }
    }
  }).observe(document.body, { childList: true });
  return {
    rootParent: root.parentElement.tagName,
    htmlCell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
    rootCell: getComputedStyle(root).getPropertyValue('--cell').trim(),
    hostColor: getComputedStyle(host).color,
    hostBox: getComputedStyle(host).boxSizing,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    hostClasses: {
      btn: { minWidth: hostBtn.minWidth, padding: hostBtn.padding,
        radius: hostBtn.borderRadius, weight: hostBtn.fontWeight },
      cardDisplay: style('hostCard').display,
      die: { display: style('hostDie').display, position: style('hostDie').position },
      ov: { display: style('hostOv').display, position: style('hostOv').position,
        visibility: style('hostOv').visibility, opacity: style('hostOv').opacity },
      faceoff: { display: style('hostFaceoff').display, position: style('hostFaceoff').position },
    },
    build: root.dataset.build || null,
    hostBuild: document.documentElement.dataset.build || null,
    htmlStates: states.filter((name) => document.documentElement.classList.contains(name)),
    rootStates: states.filter((name) => root.classList.contains(name)),
    owned: ['bg','vig','app','fx','flash','ovStart'].every((id) => root.contains(document.getElementById(id))),
  };
});
await page.evaluate(() => {
  for (const id of ['hostBtn', 'hostCard', 'hostDie', 'hostOv', 'hostFaceoff']) {
    document.getElementById(id)?.remove();
  }
});
check(isolation.rootParent === 'BODY' && isolation.owned, 'widget has no single owned application root', isolation);
check(isolation.htmlCell === 'host-cell' && isolation.rootCell.endsWith('px'),
  'widget sizing variables escaped onto the host root', isolation);
check(isolation.hostColor === 'rgb(17, 34, 51)' && isolation.hostBox === 'content-box' &&
  isolation.bodyBg === 'rgb(250, 249, 245)', 'widget CSS mutated host computed styles', isolation);
check(isolation.hostClasses.btn.minWidth !== '210px' && isolation.hostClasses.btn.padding !== '16px 20px' &&
  isolation.hostClasses.btn.radius !== '14px' && isolation.hostClasses.btn.weight !== '800' &&
  isolation.hostClasses.cardDisplay !== 'flex' &&
  (isolation.hostClasses.die.display !== 'grid' || isolation.hostClasses.die.position !== 'relative') &&
  isolation.hostClasses.ov.position !== 'fixed' && isolation.hostClasses.ov.visibility !== 'hidden' &&
  isolation.hostClasses.ov.opacity === '1' &&
  (isolation.hostClasses.faceoff.display !== 'grid' || isolation.hostClasses.faceoff.position !== 'fixed'),
  'widget component selectors restyled matching host classes', isolation.hostClasses);
check(/^[a-f0-9]{8}$/.test(isolation.build ?? '') && isolation.hostBuild === null,
  'widget build identity is missing, unstamped, or leaked onto the host document', isolation);
check(isolation.htmlStates.length === 0 && isolation.rootStates.length > 0,
  'game state lives on the host document instead of #kbroot', isolation);

const layout = await page.evaluate(()=>{
  const r=document.getElementById('kbroot').getBoundingClientRect();
  const bot=document.getElementById('sideBot').getBoundingClientRect();
  const board=document.getElementById('botBoard').getBoundingClientRect();
  return { rootW:Math.round(r.width), rootH:Math.round(r.height),
    cell:getComputedStyle(document.getElementById('kbroot')).getPropertyValue('--cell').trim(),
    botBottom:Math.round(bot.bottom-r.top), boardW:Math.round(board.width),
    fixedCount:[...document.querySelectorAll('#kbroot *')].filter(e=>getComputedStyle(e).position==='fixed').length,
    docScrollW:document.documentElement.scrollWidth, winW:window.innerWidth };
});
check(layout.fixedCount===0,'position:fixed survived the port',layout);
check(layout.botBottom<=layout.rootH,'bottom half overflows the shell',layout);
check(layout.docScrollW<=layout.winW+1,'widget causes horizontal scroll',layout);
await shot(page, 'w-start');

/* Exercise real lazy portal builders before the game loop: a roster overlay,
   the quit question and the shared sheet. Their paint order still depends on
   being direct siblings, now beneath the application root rather than body. */
await page.tap('#btnLearn'); await page.waitForTimeout(120);
await page.tap('#btnLearnModes'); await page.waitForSelector('#ovModes.on');
const rosterPortal = await page.evaluate(() => {
  const roster = document.getElementById('ovModes');
  const head = roster.querySelector('.shead');
  const buttons = [...head.querySelectorAll('button')];
  const back = head.querySelector('[data-learn-back="ovModes"]');
  return {
    parent: roster.parentElement.id,
    contained: document.getElementById('kbroot').contains(roster),
    nav: { buttons: buttons.length,
           backs: head.querySelectorAll('[data-learn-back="ovModes"]').length,
           glyph: back?.textContent?.trim() ?? '',
           label: back?.getAttribute('aria-label') ?? '',
           left: head.firstElementChild === back,
           noX: !buttons.some((button) => button.textContent?.includes('✕')) },
  };
});
check(rosterPortal.parent === 'kbroot' && rosterPortal.contained, 'lazy roster escaped #kbroot', rosterPortal);
check(rosterPortal.nav.buttons === 1 && rosterPortal.nav.backs === 1
  && rosterPortal.nav.glyph === '‹' && rosterPortal.nav.label === 'Back'
  && rosterPortal.nav.left && rosterPortal.nav.noX,
  'widget Game Modes does not use the one shared Learn-page Back header', rosterPortal.nav);
await page.tap('[data-learn-back="ovModes"]');
const rosterBack = await page.evaluate(() => ({
  modes: document.getElementById('ovModes').classList.contains('on'),
  learn: document.getElementById('ovLearn').classList.contains('on'),
}));
check(!rosterBack.modes && rosterBack.learn,
  'widget Game Modes Back did not close only the roster and return to HOW TO PLAY', rosterBack);
await page.tap('#btnLearnBack');

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
/* A coordinate lookup is document-global even when every selector is scoped.
   Prove the gesture accepts a real internal target, then refuses the same
   `.col[data-col]` vocabulary on the host page without spending the rune. */
const originalSetup = await page.evaluate(() => {
  const S = window.__kb.S;
  return { mode:S.mode, spell:S.spell, timer:S.timer, localMode:S.localMode,
    seat:S.seat, starter:S.starter };
});
const startWard = async () => {
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.spell = 'ward'; k.S.timer = 0; k.S.localMode = 0;
    k.S.mode = 'duo'; k.S.seat = 'face'; k.S.starter = 1;
    k.newGame();
  });
  await page.waitForFunction(() => window.__kb.S.phase === 'choose' && !window.__kb.S.busy);
};
const dragRune = async (x, y) => {
  const box = await page.locator('.rune[data-seat="1"]:not([hidden])').boundingBox();
  if (!box) throw new Error('ward rune has no visible drag target');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
};

await startWard();
const ownColumn = await page.locator('#botBoard .col[data-col="0"]').boundingBox();
if (!ownColumn) throw new Error('internal ward column has no visible target');
await dragRune(ownColumn.x + ownColumn.width / 2, ownColumn.y + ownColumn.height / 2);
await page.waitForFunction(() => window.__kb.S.phase === 'choose' && !window.__kb.S.busy &&
  window.__kb.S.spellCharges[1].ward === 0);
const internalHit = await page.evaluate(() => ({
  charge: window.__kb.S.spellCharges[1].ward,
  ward: window.__kb.S.charm.wards[1][0],
}));
check(internalHit.charge === 0 && internalHit.ward === 1,
  'root-safe hit testing rejected a real widget column', internalHit);

await startWard();
const hostTarget = await page.evaluate(() => {
  const target = document.getElementById('hostAim');
  target.style.cssText = 'position:fixed;left:10px;top:760px;width:110px;height:100px;z-index:999999;background:red';
  const box = target.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2,
    inside: document.getElementById('kbroot').contains(target) };
});
await dragRune(hostTarget.x, hostTarget.y);
await page.waitForTimeout(250);
const hostHit = await page.evaluate(() => {
  const k = window.__kb;
  document.getElementById('hostAim').removeAttribute('style');
  return { charge: k.S.spellCharges[1].ward, ward: k.S.charm.wards[1][0], armed: k.S.spellArmed };
});
check(!hostTarget.inside && hostHit.charge === 1 && hostHit.ward === 0 && hostHit.armed === null,
  'matching host markup became a widget spell target', { hostTarget, hostHit });
await page.evaluate((setup) => {
  const k = window.__kb;
  k.goHome();
  Object.assign(k.S, setup);
}, originalSetup);

// ---- CPU game by touch ----
// Loop budgets are generous on purpose: games are random, destruction-heavy
// endgames run long, and CI runners are slow. (A 400-tick budget flaked on CI.)
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#btnPlay'); await page.waitForTimeout(1800);
await page.tap('#btnLeave'); await page.waitForSelector('#ovAsk.on');
const askPortal = await page.evaluate(() => {
  const root = document.getElementById('kbroot');
  const ask = document.getElementById('ovAsk');
  const visibleButtons = [...ask.querySelectorAll('.askcard > button')].filter((button) => {
    const rect = button.getBoundingClientRect();
    return !button.hidden && rect.width > 0 && rect.height > 0;
  });
  const alternate = document.getElementById('btnAskAlt');
  return {
    parent: ask.parentElement.id,
    top: root.lastElementChild.id,
    alternateContained: !!alternate && root.contains(alternate),
    order: visibleButtons.map((button) => button.textContent.trim()),
  };
});
check(askPortal.parent === 'kbroot' && askPortal.top === 'ovAsk'
  && askPortal.alternateContained
  && askPortal.order.join(' -> ') === 'Keep playing -> Restart duel -> Quit duel',
  'widget ask portal escaped, lost overlay order, or lost its contained restart action', askPortal);
await page.tap('#btnAskNo');
await page.tap('#rec .rchip'); await page.waitForSelector('.faceoff');
const sheetPortal = await page.evaluate(() => {
  const sheet = document.querySelector('.faceoff');
  return { parent: sheet.parentElement.id, position: getComputedStyle(sheet).position };
});
check(sheetPortal.parent === 'kbroot' && sheetPortal.position === 'absolute',
  'widget sheet escaped the root or stayed viewport-fixed', sheetPortal);
await page.tap('.fograb'); await page.waitForSelector('.faceoff', { state:'detached' });

let cpuDone=false;
for(let i=0;i<1200;i++){ const s=await snap(); audit(s,'cpu'+i);
  if(s.end||s.phase==='over'){cpuDone=true;break;}
  if(s.phase==='choose'&&s.turn===1){ const lg=s.b1.map((c,j)=>c.length<3?j:-1).filter(j=>j>=0);
    await page.tap(`#botBoard .col[data-col="${lg[(Math.random()*lg.length)|0]}"]`); }
  await page.waitForTimeout(95); }
await page.waitForTimeout(1500);
await shot(page, 'w-end');
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
await page.tap('#btnEndQuiet'); await page.waitForTimeout(500);   // the result's one secondary: back to the setup screen
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
await shot(page, 'w-duo');
const grew=await page.evaluate(()=>document.getElementById('kbroot').getBoundingClientRect().height);
const portalAudit = await page.evaluate(() => ({
  outsideAdds: window.__outsideRootAdds,
  overlaysOutside: [...document.querySelectorAll('.ov,.faceoff,.runeghost')]
    .filter((node) => !document.getElementById('kbroot').contains(node))
    .map((node) => node.id || node.className),
}));
check(portalAudit.outsideAdds.length === 0 && portalAudit.overlaysOutside.length === 0,
  'runtime inserted app UI outside #kbroot', portalAudit);

/* The standalone entry uses the same canonical root, but still owns the full
   viewport and keeps its fixed geometry. This catches fixes that isolate the
   widget by accidentally turning the PWA into a 640px container too. */
const standalonePage = await ctx.newPage();
standalonePage.on('pageerror',e=>errs.push('STANDALONE PAGEERROR: '+e.message));
standalonePage.on('console',m=>{ if(m.type()==='error') errs.push('STANDALONE CONSOLE: '+m.text()); });
await standalonePage.goto('file://' + process.cwd() + '/knucklebones-neon.html');
await standalonePage.waitForTimeout(500);
const standalone = await standalonePage.evaluate(() => {
  const root = document.getElementById('kbroot');
  const rr = root.getBoundingClientRect(), app = document.getElementById('app');
  const states = ['land','shortv','sidepts','numerals','clock','tut','casting','castself'];
  return {
    root: { x:rr.x, y:rr.y, width:rr.width, height:rr.height },
    viewport: { width:innerWidth, height:innerHeight },
    appFixed: getComputedStyle(app).position,
    rootCell: getComputedStyle(root).getPropertyValue('--cell').trim(),
    htmlCell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
    htmlStates: states.filter((name) => document.documentElement.classList.contains(name)),
    owned: ['bg','vig','app','fx','flash','ovStart'].every((id) => root.contains(document.getElementById(id))),
  };
});
check(standalone.owned && standalone.appFixed === 'fixed', 'standalone layers left the canonical root/viewport model', standalone);
check(Math.abs(standalone.root.width-standalone.viewport.width)<1 &&
  Math.abs(standalone.root.height-standalone.viewport.height)<1 && standalone.root.x===0 && standalone.root.y===0,
  'standalone #kbroot no longer covers the viewport', standalone);
check(standalone.rootCell.endsWith('px') && standalone.htmlCell === '' && standalone.htmlStates.length === 0,
  'standalone state or sizing variables escaped #kbroot', standalone);
await standalonePage.close();

console.log(JSON.stringify({isolation,layout,portals:{rosterPortal,askPortal,sheetPortal,portalAudit},
  cpuDone,cpuEnd,duo:{handoffs,duoDone},shellHeight:grew,standalone,problems,errs},null,2));
await browser.close();

import pkg from 'playwright';
const { chromium } = pkg;
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + process.cwd() + '/knucklebones.html');
await p.waitForTimeout(400);
const r = await p.evaluate(() => {
  // two implementations of the same function, timed head to head in one page
  function countOf(col,v){ let k=0; for(let i=0;i<col.length;i++) if(col[i]===v) k++; return k; }
  function colScoreHelper(col){ let s=0; for(let v=1;v<=6;v++){ const k=countOf(col,v); if(k) s+=v*k*k; } return s; }
  function colScoreInline(col){
    let s=0;
    for(let v=1;v<=6;v++){ let k=0; for(let i=0;i<col.length;i++) if(col[i]===v) k++; if(k) s+=v*k*k; }
    return s;
  }
  const cols=[[],[4],[4,4],[1,2,3],[6,6,6],[2,5],[3,3,1]];
  const time=(fn)=>{
    let sink=0;
    const t0=performance.now();
    for(let r=0;r<300000;r++) sink+=fn(cols[r%cols.length]);
    return { ms:+(performance.now()-t0).toFixed(1), sink };
  };
  time(colScoreHelper); time(colScoreInline);            // warm the JIT
  const h1=time(colScoreHelper), i1=time(colScoreInline);
  const h2=time(colScoreHelper), i2=time(colScoreInline);
  // and the real search, repeated, to see variance
  const k=window.__kb, st=[[[2],[5,5],[]],[[3],[],[1,6]]];
  const runs=[];
  for(let n=0;n<5;n++){
    const t0=performance.now();
    for(let i=0;i<8;i++) k.searchRoot(st.map(b=>b.map(c=>c.slice())),0,1+(i%6),4);
    runs.push(+((performance.now()-t0)/8).toFixed(1));
  }
  return { helper:[h1.ms,h2.ms], inline:[i1.ms,i2.ms], sameResult:h1.sink===i1.sink, searchRuns:runs };
});
console.log(JSON.stringify(r,null,2));
await b.close();

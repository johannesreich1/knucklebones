import pkg from 'playwright';
import { servedBase } from '../../serve.mjs';
import { createVisit } from './harness/visit.mjs';
const { webkit } = pkg;
const URL = await servedBase();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub,aud:'authenticated',role:'authenticated',is_anonymous:true,exp:Math.floor(Date.now()/1000)+3600})}.stub`;
const GUEST_ID = '00000000-0000-4000-8000-00000000beef';
const SESSION = { access_token: jwt(GUEST_ID), token_type:'bearer', expires_in:3600,
  expires_at: Math.floor(Date.now()/1000)+3600, refresh_token:'stub',
  user:{ id:GUEST_ID, aud:'authenticated', role:'authenticated', email:null, is_anonymous:true,
         created_at:new Date().toISOString(), app_metadata:{}, user_metadata:{}, identities:[] } };
const browser = await webkit.launch();
const visit = createVisit({ browser, URL, SESSION, GUEST_ID });
const run = await visit({
  named: true, ladderNearBottom: true, viewport: { width: 390, height: 844 },
  skipStandardProbes: true,
  probe: async (page) => {
    await page.evaluate(() => {
      window.__o = [];
      const tick = () => {
        const b = document.querySelector('#ovOnline .pbody');
        const l = document.querySelector('#onLadderList');
        if (b && l && !document.getElementById('onLadder')?.hidden) {
          const me = l.querySelector('.lrow.me');
          window.__o.push({
            t: Math.round(performance.now()),
            top: Math.round(b.scrollTop),
            slots: l.querySelectorAll('[data-slot]').length,
            pad: Math.round(parseFloat(l.style.paddingTop) || 0),
            meTop: me ? Math.round(me.getBoundingClientRect().top) : null,
          });
        }
        if (window.__o.length < 60) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.click('#btnLadder');
    await page.waitForTimeout(2200);
    return page.evaluate(() => window.__o.filter((r, i, a) =>
      i === 0 || r.top !== a[i-1].top || r.slots !== a[i-1].slots || r.meTop !== a[i-1].meTop));
  },
});
console.log(JSON.stringify(run.probeResult, null, 0));
await browser.close();

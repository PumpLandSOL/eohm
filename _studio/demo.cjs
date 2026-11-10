// eOHM real-app demo: drives the live local site (landing → app → bond quote → stake → calculator), 1920x1080 @ 30fps.
// needs the server running: node server/index.js   then: node _studio/demo.cjs
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process'), { open, sleep } = require('./cdp.cjs');
const SITE = process.env.SITE || 'http://localhost:8286', B = path.join(__dirname, '..', 'brand'), FPS = 30;
(async () => {
  const FR = path.join(os.tmpdir(), 'eohm-demo'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
  const c = await open('about:blank', 1920, 1080, 9300 + Math.floor(Math.random() * 90)); await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  let n = 0; const snap = async () => c.shot(path.join(FR, 'f_' + String(n++).padStart(5, '0') + '.jpg'), 'jpeg');
  const hold = async (sec) => { const k = Math.round(sec * FPS); for (let i = 0; i < k; i++) await snap(); };   // each shot = one frame (content is live, ticks between shots)
  const go = async (u) => { await c.send('Page.navigate', { url: SITE + u }); await sleep(2200); await c.ev('document.fonts.ready.then(()=>1)'); await c.ev("document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in'));1"); };
  const scrollTo = async (y, sec) => { const y0 = await c.ev('scrollY'), k = Math.round(sec * FPS); for (let i = 1; i <= k; i++) { const p = i / k, e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; await c.ev(`scrollTo(0,${y0 + (y - y0) * e})`); await snap(); } };
  const ev = (js) => c.ev(js);
  await go('/'); await hold(2.4);
  const yHow = await ev("document.getElementById('how').offsetTop-40"), yBonds = await ev("document.getElementById('bonds').offsetTop-40"), yCmp = await ev("document.getElementById('compare').offsetTop-40");
  await scrollTo(yHow, 1.2); await hold(1.4); await scrollTo(yBonds, 1.2); await hold(1.6); await scrollTo(yCmp, 1.0); await hold(1.4);
  await go('/app'); await hold(2.4);
  await ev("document.querySelector('[data-view=bond]').click();1"); await hold(0.8);
  for (const s of ['2', '2.', '2.5']) { await ev(`(()=>{const e=document.getElementById('bondAmt_hype');e.value='${s}';e.dispatchEvent(new Event('input'));e.focus()})()`); await hold(0.35); }
  await hold(1.4);
  for (const s of ['1', '10', '100', '1000']) { await ev(`(()=>{const e=document.getElementById('bondAmt_usdc');e.value='${s}';e.dispatchEvent(new Event('input'))})()`); await hold(0.3); }
  await hold(1.4);
  await ev("document.querySelector('[data-view=stake]').click();1"); await hold(1.8);
  await ev("document.querySelector('[data-view=calc]').click();1"); await hold(0.6);
  for (let d = 30; d <= 180; d += 10) { await ev(`(()=>{const e=document.getElementById('calcDays');e.value=${d};e.dispatchEvent(new Event('input'))})()`); await hold(0.1); }
  await hold(1.4);
  await ev("document.querySelector('[data-view=dash]').click();1"); await hold(2.0);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FR, 'f_%05d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', path.join(B, 'eohm-app-demo.mp4')]);
  fs.rmSync(FR, { recursive: true, force: true }); console.log('OK eohm-app-demo', (n / FPS).toFixed(1) + 's'); c.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

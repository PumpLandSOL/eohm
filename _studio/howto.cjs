// eOHM how-to: real app, step captions + highlight rings, 1920x1080 @ 30fps. Needs the local server: node server/index.js
// A stand-in EIP-6963 wallet ("Rabby") is announced so the connect + stake screens can be shown; it signs nothing.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process'), { open, sleep } = require('./cdp.cjs');
const SITE = process.env.SITE || 'http://localhost:8286', B = path.join(__dirname, '..', 'brand'), FPS = 30;
const OVERLAY = `(()=>{if(document.getElementById('hx'))return;const s=document.createElement('style');s.textContent=\`#hx{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:999;background:rgba(4,16,13,.94);border:2px solid #50e3c2;border-radius:16px;padding:18px 30px;display:flex;gap:18px;align-items:center;box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 40px rgba(80,227,194,.2);font-family:'Inter Tight',sans-serif;transition:opacity .25s}#hx .n{font:600 18px 'IBM Plex Mono';color:#04100d;background:#97fce4;border-radius:8px;padding:6px 12px}#hx .t{font:800 34px 'Inter Tight';color:#e9f6f2;letter-spacing:-.02em}#hx .d{font:400 20px 'IBM Plex Mono';color:#9ab8b0;margin-top:2px}.hring{outline:3px solid #97fce4!important;outline-offset:6px;border-radius:10px;box-shadow:0 0 0 10px rgba(151,252,228,.12),0 0 40px rgba(151,252,228,.4)!important;transition:outline .2s}\`;document.head.appendChild(s);const d=document.createElement('div');d.id='hx';d.innerHTML='<span class=n></span><div><div class=t></div><div class=d></div></div>';document.body.appendChild(d)})()`;
const FAKE = `(()=>{const p={isRabby:true,request:async({method})=>method==='eth_requestAccounts'||method==='eth_accounts'?['0x5e0d0000000000000000000000000000000c1a55']:method==='eth_chainId'?'0x1863d':null,on(){}};window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'rabby',name:'Rabby Wallet',rdns:'io.rabby',icon:''},provider:p}}))})()`;
(async () => {
  const FR = path.join(os.tmpdir(), 'eohm-howto'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
  const c = await open('about:blank', 1920, 1080, 9400 + Math.floor(Math.random() * 90)); await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  let n = 0; const snap = () => c.shot(path.join(FR, 'f_' + String(n++).padStart(5, '0') + '.jpg'), 'jpeg');
  const hold = async (sec) => { for (let i = 0; i < Math.round(sec * FPS); i++) await snap(); };
  const ev = (js) => c.ev(js);
  const cap = (num, t, d) => ev(`(()=>{const h=document.getElementById('hx');h.style.opacity=1;h.querySelector('.n').textContent=${JSON.stringify(num)};h.querySelector('.t').textContent=${JSON.stringify(t)};h.querySelector('.d').textContent=${JSON.stringify(d)}})()`);
  const ring = (sel) => ev(`(()=>{document.querySelectorAll('.hring').forEach(e=>e.classList.remove('hring'));${sel ? `const e=document.querySelector(${JSON.stringify(sel)});if(e)e.classList.add('hring')` : ''}})()`);
  const type = async (id, text, per = 0.12) => { for (let i = 1; i <= text.length; i++) { await ev(`(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(text.slice(0, i))};e.dispatchEvent(new Event('input'))})()`); await hold(per); } };
  await c.send('Page.navigate', { url: SITE + '/app' }); await sleep(2400); await ev('document.fonts.ready.then(()=>1)'); await ev(OVERLAY); await ev("localStorage.removeItem('eohm_w');1");
  await cap('HOW TO', 'Stake eOHM in 4 steps', 'elysiumohm.com/app · Elysium mainnet'); await hold(2.6);
  await ev(FAKE); await cap('STEP 1', 'Connect Rabby or MetaMask', 'Elysium is added to your wallet automatically'); await ring('#connectBtn'); await hold(1.8);
  await ev("document.getElementById('connectBtn').click();1"); await sleep(250); await ring('.wpick .wbox2'); await hold(2.4);
  await ev("document.querySelector('.wpick button[data-i=\"0\"]').click();1"); await sleep(400); await ring('#connectBtn'); await hold(1.6);
  await ev("document.querySelector('[data-view=stake]').click();1"); await ring('#stakeAmt'); await cap('STEP 2', 'Enter how much eOHM to stake', 'minimum 300,000 eOHM · it goes straight to the treasury'); await hold(0.8);
  await type('stakeAmt', '500000'); await hold(1.2); await ring('#stakeBtn'); await cap('STEP 3', 'Hit Stake and confirm in your wallet', 'seOHM is credited once Elysium confirms the transfer'); await hold(2.6);
  await ring('#yRebase'); await cap('STEP 4', 'Watch it compound', 'every 5 minutes the index steps up · your seOHM grows'); await hold(2.6);
  await ev("document.querySelector('[data-view=bond]').click();1"); await ring('#bondCards .bond'); await cap('NO eOHM YET?', 'Bond HYPE for eOHM below market', '7% off · 5-day vest · claim & stake in one click'); await hold(0.6);
  await type('bondAmt_hype', '2.5', 0.25); await ring('#bondOut_hype'); await hold(2.4);
  await ev("document.querySelector('[data-view=dash]').click();1"); await ring(null); await cap('eOHM', 'The first OHM fork on Elysium', 'elysiumohm.com · @ElysiumOHM'); await hold(2.8);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FR, 'f_%05d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', path.join(B, 'eohm-howto.mp4')]);
  fs.rmSync(FR, { recursive: true, force: true }); console.log('OK eohm-howto', (n / FPS).toFixed(1) + 's'); c.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

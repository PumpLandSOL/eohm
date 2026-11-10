// eOHM ($eOHM) — OHM-style (3,3) staking + bonding + treasury protocol on Elysium, Hyperliquid's L2.
// Bonds are paid in real HYPE or USDC on Elysium mainnet and verified on-chain before anything is credited.
// Fixed supply => rebases do not mint on-chain. The index, the seOHM ledger and the bond vesting
// run in this server; deposits, bond payments and the treasury itself are real and read from Elysium.
// Staked $eOHM and bond payments sit in the treasury wallet; payouts are sent from it.
// Dependency-free: Node http + crypto.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const BOOT_TS = Date.now();
const PORT = process.env.PORT || 8286;
const ROOT = path.join(__dirname, '..');
const TOKEN = process.env.TOKEN_TICKER || 'eOHM';
const DATA_PATH = process.env.DATA_PATH || path.join(ROOT, 'data.json');
const EOHM_MINT = process.env.EOHM_MINT || '';  // $eOHM on Elysium — staking opens when this is set
// staking custody: real $eOHM deposits land here (key held offline by the operator — never on this server)
const TREASURY_WALLET = process.env.TREASURY_WALLET || '0x6A690F711928E8b938Fb5FE38F6fc2B8164Abc97';
const USDC = (process.env.USDC_ADDR || '0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65').toLowerCase();  // native USDC on Elysium (6 dp)
const WHYPE = (process.env.WHYPE_ADDR || '0xba876237b0f021a6c6d852d6c26e107997cc5e81').toLowerCase();
const EXPLORER = process.env.EXPLORER || 'https://elysium.kinetiq.xyz/explorer';
const ADMIN_KEY = process.env.ADMIN_KEY || '';  // set to enable /api/withdrawals admin export
const MIN_STAKE = +(process.env.MIN_STAKE || 300000);  // minimum $eOHM per stake deposit
const LOCK_SEC = +(process.env.LOCK_SEC || 3600);      // stake lock: must stay staked at least this long before unstaking
// Elysium mainnet — balances are read here directly so the app shows the truth
// no matter which chain the user's wallet is parked on.
const RPC_URL = process.env.RPC_URL || 'https://rpc.elysium.kinetiq.xyz';
const CHAIN_ID = +(process.env.CHAIN_ID || 99901);
async function rpc(method, params) {
  const r = await fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
const REBASE_SEC = +(process.env.REBASE_SEC || 300);           // epoch length (5 min)
// Dynamic APY (OHM-style reflexive emissions): rich when the pool is small, decaying as it fills.
// apy = APY_MIN + (APY_MAX - APY_MIN) * HALF / (HALF + totalStaked)
// => empty pool ≈ APY_MAX; at HALF staked it's the midpoint; large pool → APY_MIN.
const APY_MAX = +(process.env.APY_MAX || 50000);   // ceiling, near-empty pool
const APY_MIN = +(process.env.APY_MIN || 6000);    // floor, deep pool
const APY_HALF = +(process.env.APY_HALF || 4e6);   // staked $eOHM at the halfway point
const APY_TARGET = APY_MAX;                          // legacy alias (banner copy / startup log)
// 24-HOUR APY BOOST: while active, APY is floored at BOOST_APY (old-school ponzi numbers).
// Arm it by setting BOOST_UNTIL to a unix-ms timestamp (or BOOST_HOURS from boot); off by default.
const BOOST_APY = +(process.env.BOOST_APY || 250000);
const BOOST_UNTIL_ENV = +(process.env.BOOST_UNTIL || 0);
const BOOST_HOURS = +(process.env.BOOST_HOURS || 0);
const TOTAL_SUPPLY = +(process.env.TOTAL_SUPPLY || 1e9);       // fixed supply at launch
let TOKEN_PRICE = +(process.env.TOKEN_PRICE || 0.005);         // $ per eOHM — overridden by the live pool price below
// live price: once EOHM_MINT is set, mark to the real Elysium pool (deepest pair wins)
async function pollPrice() {
  if (!EOHM_MINT) return;
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + EOHM_MINT, { headers: { accept: 'application/json' } });
    if (!r.ok) return;
    const pairs = ((await r.json()).pairs || []).filter((p) => p.chainId === (process.env.DEX_CHAIN || 'elysium') && +p.priceUsd > 0);
    pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    if (pairs[0]) TOKEN_PRICE = +pairs[0].priceUsd;
  } catch (e) { /* keep last good */ }
}
pollPrice(); setInterval(pollPrice, 60000);
// The treasury wallet holds every staked $eOHM, so its on-chain balance IS the total staked pool.
// We read it directly — the off-chain ledger's own tally can reset on redeploy, this cannot.
let treasuryStaked = 0;
let HYPE_USD = +(process.env.HYPE_USD || 0), treasuryHype = 0, treasuryUsdc = 0;
// HYPE price: Hyperliquid's own mid price first (keyless), CoinGecko as the fallback
async function pollHype() {
  try { const j = await (await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(10000) })).json(); const p = +j.HYPE; if (p > 0) { HYPE_USD = p; return; } } catch (e) {}
  try { const j = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd', { signal: AbortSignal.timeout(10000) })).json(); if (j.hyperliquid && j.hyperliquid.usd > 0) HYPE_USD = j.hyperliquid.usd; } catch (e) {}
}
pollHype(); setInterval(pollHype, 30000);
async function pollTreasury() {
  try { treasuryHype = Number(BigInt(await rpc('eth_getBalance', [TREASURY_WALLET, 'latest']))) / 1e18; } catch (e) {}
  try { treasuryUsdc = Number(BigInt(await rpc('eth_call', [{ to: USDC, data: '0x70a08231' + TREASURY_WALLET.slice(2).toLowerCase().padStart(64, '0') }, 'latest']))) / 1e6; } catch (e) {}
  if (!EOHM_MINT) return;
  try {
    const hex = await rpc('eth_call', [{ to: EOHM_MINT, data: '0x70a08231' + TREASURY_WALLET.slice(2).toLowerCase().padStart(64, '0') }, 'latest']);
    treasuryStaked = Number(BigInt(hex)) / 1e18;
  } catch (e) { /* keep last good */ }
}
pollTreasury(); setInterval(pollTreasury, 30000);
const SEED_BALANCE = +(process.env.SEED_BALANCE || 0);       // ledger balance starts at zero: every eOHM comes from a real deposit or bond
// per-rebase rate derived from target APY
const REBASES_YR = 31557600 / REBASE_SEC;
// current APY from the live pool, and the per-rebase rate derived from it
// staked value from the COMMITTED index (no live fraction) — avoids a liveIndex→rate cycle
// pool = real staked $eOHM in the treasury (falls back to the ledger tally before the first poll)
function poolStaked() { return treasuryStaked > 0 ? treasuryStaked : db.totalAgons * db.index; }
// boost window: env-armed, or persisted in the ledger once armed via admin
function boostUntil() { return Math.max(BOOST_UNTIL_ENV, db.boostUntil || 0, BOOST_HOURS > 0 ? BOOT_TS + BOOST_HOURS * 3600e3 : 0); }
function boostActive() { return Date.now() < boostUntil(); }
const FIXED_APY = +(process.env.FIXED_APY || 250000);  // pin the displayed/emission APY; set 0 to use dynamic
function currentApy(ts) {
  if (FIXED_APY > 0) return FIXED_APY;
  const s = ts == null ? poolStaked() : ts;
  const base = APY_MIN + (APY_MAX - APY_MIN) * (APY_HALF / (APY_HALF + Math.max(0, s)));
  return boostActive() ? Math.max(base, BOOST_APY) : base;
}
function currentRate(ts) { return Math.pow(1 + currentApy(ts) / 100, 1 / REBASES_YR) - 1; }
const BONDS = [
  { id: 'hype', name: 'HYPE', discount: +(process.env.BOND_HYPE_DISC || 0.07), vestDays: 5, asset: 'native', dec: 18, min: +(process.env.BOND_HYPE_MIN || 0.1) },
  { id: 'usdc', name: 'USDC', discount: +(process.env.BOND_USDC_DISC || 0.05), vestDays: 5, asset: USDC, dec: 6, min: +(process.env.BOND_USDC_MIN || 5) },
  { id: 'whype', name: 'WHYPE', discount: +(process.env.BOND_WHYPE_DISC || 0.08), vestDays: 5, asset: WHYPE, dec: 18, min: +(process.env.BOND_HYPE_MIN || 0.1) },
];
const bondUsd = (m, amt) => (m.id === 'usdc' ? amt : amt * HYPE_USD);

// ---------- state ----------
let db = { index: 1, epoch: 0, lastRebase: Date.now(), treasury: +(process.env.TREASURY_SEED || 0), totalAgons: 0, wallets: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))); } catch (e) {}
if (!db.wallets) db.wallets = {};
if (!db.tape) db.tape = [];
if (!db.withdrawals) db.withdrawals = [];
if (!db.bondTx) db.bondTx = [];   // every bond payment tx hash ever credited (no double credit)
const treasuryUsd = () => Math.max(db.treasury, treasuryHype * HYPE_USD + treasuryUsdc);  // pending unstake payouts, settled manually from the treasury
// migration: wallets seeded under the old 1k cap get topped up to the new seed
for (const w of Object.values(db.wallets)) if (w.seeded && w.balance <= 1000) w.balance += SEED_BALANCE - 1000;
// the Stampede: rolling tape of protocol actions, newest first
function tapePush(type, wallet, amount) {
  db.tape.unshift({ t: Date.now(), type, w: wallet.slice(0, 4) + '…' + wallet.slice(-4), amount: +(+amount).toFixed(2) });
  if (db.tape.length > 60) db.tape.length = 60;
}
let saveT = null; function save() { if (saveT) return; saveT = setTimeout(() => { saveT = null; try { fs.writeFileSync(DATA_PATH, JSON.stringify(db)); } catch (e) {} }, 800); }
const isWallet = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);

function rebase() { db.index *= (1 + currentRate()); db.epoch++; db.lastRebase = Date.now(); save(); }
// catch up missed epochs on boot
(function catchup() { const missed = Math.floor((Date.now() - db.lastRebase) / 1000 / REBASE_SEC); for (let i = 0; i < Math.min(missed, 10000); i++) rebase(); })();

function liveIndex() { const frac = (Date.now() - db.lastRebase) / 1000 / REBASE_SEC; return db.index * (1 + currentRate() * Math.max(0, Math.min(1, frac))); }
function W(addr) { return db.wallets[addr] || (db.wallets[addr] = { balance: SEED_BALANCE, agons: 0, bonds: [], seeded: true }); }
function stakedOf(w, idx) { return w.agons * (idx || liveIndex()); }
function totalStaked(idx) { return db.totalAgons * (idx || liveIndex()); }
const circulating = () => TOTAL_SUPPLY;

function metrics() {
  const idx = liveIndex();
  // total staked = the treasury's real on-chain $eOHM balance (authoritative pool)
  const ts = poolStaked();
  const leaderboard = Object.entries(db.wallets).map(([a, w]) => ({ a, staked: w.agons * idx }))
    .filter((x) => x.staked > 0.001).sort((x, y) => y.staked - x.staked).slice(0, 8)
    .map((x) => ({ wallet: x.a.slice(0, 4) + '…' + x.a.slice(-4), staked: x.staked, share: ts > 0 ? x.staked / ts : 0 }));
  const backing = treasuryUsd() / circulating();
  // runway: days the treasury can fund current reward emissions (rewards per day in $ vs treasury)
  const rate = currentRate(ts); const rewardsPerDay = ts * (Math.pow(1 + rate, 86400 / REBASE_SEC) - 1) * TOKEN_PRICE;
  // nothing staked => nothing emitting => runway is undefined, not zero. null so the UI can say so.
  const runway = rewardsPerDay > 0 ? treasuryUsd() / rewardsPerDay : null;
  return {
    token: TOKEN, apy: currentApy(ts), rate: rate, index: +idx.toFixed(6), epoch: db.epoch,
    totalStaked: ts, circulating: circulating(), stakingRatio: ts / circulating(),
    treasury: treasuryUsd(), treasuryOnchain: { hype: treasuryHype, usdc: treasuryUsdc, hypeUsd: HYPE_USD, wallet: TREASURY_WALLET }, bondedUsd: db.treasury, backingPerToken: backing, price: TOKEN_PRICE, marketCap: TOKEN_PRICE * circulating(),
    runwayDays: runway, rebaseSec: REBASE_SEC, nextRebaseIn: Math.max(0, REBASE_SEC - (Date.now() - db.lastRebase) / 1000),
    bonds: BONDS.map((b) => ({ id: b.id, name: b.name, discount: b.discount, vestDays: b.vestDays, price: TOKEN_PRICE * (1 - b.discount), asset: b.asset, dec: b.dec, min: b.min, assetUsd: b.id === 'usdc' ? 1 : HYPE_USD })),
    leaderboard, stakers: leaderboard.length, mint: EOHM_MINT, tape: db.tape.slice(0, 12),
    boost: boostActive() ? { apy: BOOST_APY, until: boostUntil(), secondsLeft: Math.ceil((boostUntil() - Date.now()) / 1000) } : null,
  };
}
function account(addr) {
  const w = W(addr); const idx = liveIndex();
  const now = Date.now();
  const bonds = w.bonds.filter((b) => !b.done).map((b) => {
    const pct = Math.max(0, Math.min(1, (now - b.start) / (b.end - b.start)));
    const claimable = b.payout * pct - b.claimed;
    return { market: b.market, payout: b.payout, claimable: Math.max(0, claimable), pct, endsIn: Math.max(0, (b.end - now) / 1000) };
  });
  const pendingOut = db.withdrawals.filter((x) => x.wallet === addr && x.status === 'pending').reduce((s, x) => s + x.amount, 0);
  return { wallet: addr, balance: w.balance, staked: stakedOf(w, idx), index: +idx.toFixed(6),
    nextReward: stakedOf(w, idx) * currentRate(), bonds, seeded: !!w.seeded, pendingOut,
    lockRemaining: Math.max(0, Math.ceil(((w.lockUntil || 0) - Date.now()) / 1000)) };
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function serve(req, res) { let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/client/landing.html'; if (u === '/app' || u === '/app/') u = '/client/index.html'; if (u === '/docs' || u === '/docs/') u = '/client/docs.html'; const f = path.normalize(path.join(ROOT, u)); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); } fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); }); }
function json(res, c, o) { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); }); }

http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/config') return json(res, 200, { token: TOKEN, rebaseSec: REBASE_SEC, apy: APY_TARGET, mint: EOHM_MINT, treasury: TREASURY_WALLET, minStake: MIN_STAKE, lockSec: LOCK_SEC, chainId: CHAIN_ID, rpcUrl: RPC_URL, network: 'elysium', explorer: EXPLORER, usdc: USDC, whype: WHYPE, hypeUsd: HYPE_USD });
  if (u === '/api/metrics') return json(res, 200, metrics());
  if (req.method === 'POST' && u === '/api/balance') { const d = await body(req); if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'bad wallet' }); if (!EOHM_MINT) return json(res, 200, { balance: 0, prelaunch: true }); try { const hex = await rpc('eth_call', [{ to: EOHM_MINT, data: '0x70a08231' + d.wallet.slice(2).toLowerCase().padStart(64, '0') }, 'latest']); return json(res, 200, { balance: Number(BigInt(hex)) / 1e18 }); } catch (e) { return json(res, 200, { error: 'rpc unavailable' }); } }
  if (req.method === 'POST' && u === '/api/account') { const d = await body(req); if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'connect a valid EVM wallet' }); return json(res, 200, account(d.wallet)); }
  // stake = a real on-chain $eOHM transfer to the treasury. The server VERIFIES the tx on
  // Elysium — it must exist, have succeeded, be a transfer() of $eOHM from this wallet
  // to the treasury — and credits seOHM for the ACTUAL on-chain amount, not the client's claim.
  if (req.method === 'POST' && u === '/api/stake') {
    const d = await body(req); if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'bad wallet' });
    if (!EOHM_MINT) return json(res, 200, { error: 'staking opens the moment $eOHM launches on Elysium — bond HYPE or USDC now to get eOHM at a discount' });
    if (!/^0x[0-9a-fA-F]{64}$/.test(d.txHash || '')) return json(res, 200, { error: 'missing deposit tx — stake sends $eOHM to the treasury first' });
    const txHash = d.txHash.toLowerCase();
    if (db.tape.some((e) => e.tx === txHash)) return json(res, 200, { error: 'deposit already credited' });
    let amt;
    try {
      const [tx, rc] = await Promise.all([rpc('eth_getTransactionByHash', [txHash]), rpc('eth_getTransactionReceipt', [txHash])]);
      if (!tx || !rc) return json(res, 200, { error: 'deposit not found on Elysium — nothing was credited' });
      if (rc.status !== '0x1') return json(res, 200, { error: 'deposit transaction failed on-chain' });
      if ((tx.to || '').toLowerCase() !== EOHM_MINT.toLowerCase()) return json(res, 200, { error: 'not a $eOHM transfer' });
      if ((tx.from || '').toLowerCase() !== d.wallet.toLowerCase()) return json(res, 200, { error: 'deposit was not sent from your wallet' });
      // decode transfer(address to, uint256 value): 0xa9059cbb + to(32) + value(32)
      const inp = (tx.input || '').toLowerCase();
      if (!inp.startsWith('0xa9059cbb') || inp.length < 138) return json(res, 200, { error: 'not a token transfer' });
      const to = '0x' + inp.slice(34, 74);
      if (to !== TREASURY_WALLET.toLowerCase()) return json(res, 200, { error: 'deposit did not go to the treasury' });
      amt = Number(BigInt('0x' + inp.slice(74, 138))) / 1e18;
    } catch (e) { return json(res, 200, { error: 'could not verify deposit — try again in a moment' }); }
    if (!(amt > 0)) return json(res, 200, { error: 'zero-value deposit' });
    if (amt < MIN_STAKE) return json(res, 200, { error: 'below minimum — deposit was ' + amt.toLocaleString() + ', minimum is ' + MIN_STAKE.toLocaleString() + ' $eOHM' });
    const w = W(d.wallet); const idx = liveIndex(); const ag = amt / idx; w.agons += ag; db.totalAgons += ag;
    w.lockUntil = Date.now() + LOCK_SEC * 1000;  // fresh deposit (re)locks the position for the minimum
    tapePush('stake', d.wallet, amt); db.tape[0].tx = txHash; db.tape[0].ag = ag; db.tape[0].addr = d.wallet; save();
    return json(res, 200, { ok: true, ...account(d.wallet) });
  }
  // operator: re-verify every credited stake against the chain and reverse any that don't check out.
  if (u === '/api/admin/reverify') {
    const q = new URL(req.url, 'http://x').searchParams; if (!ADMIN_KEY || q.get('key') !== ADMIN_KEY) return json(res, 403, { error: 'nope' });
    const reversed = [];
    for (const e of db.tape) {
      if (e.type !== 'stake' || !e.tx || e.bad) continue;
      let ok = false;
      try {
        const tx = await rpc('eth_getTransactionByHash', [e.tx]); const rc = await rpc('eth_getTransactionReceipt', [e.tx]);
        const inp = tx && (tx.input || '').toLowerCase();
        ok = !!(tx && rc && rc.status === '0x1' && (tx.to || '').toLowerCase() === EOHM_MINT.toLowerCase()
          && inp && inp.startsWith('0xa9059cbb') && ('0x' + inp.slice(34, 74)) === TREASURY_WALLET.toLowerCase());
      } catch (x) { continue; /* leave untouched if RPC is flaky */ }
      if (!ok) {
        const addr = e.addr; const ag = e.ag != null ? e.ag : (e.amount / liveIndex());
        if (addr && db.wallets[addr]) { db.wallets[addr].agons = Math.max(0, db.wallets[addr].agons - ag); }
        db.totalAgons = Math.max(0, db.totalAgons - ag);
        e.bad = true; reversed.push({ wallet: e.w, amount: e.amount, tx: e.tx });
      }
    }
    save(); return json(res, 200, { reversed, count: reversed.length });
  }
  // unstake = join the withdrawal queue; payouts are sent manually from the treasury wallet.
  if (req.method === 'POST' && u === '/api/unstake') { const d = await body(req); if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'bad wallet' }); const w = W(d.wallet); const lockLeft = Math.ceil(((w.lockUntil || 0) - Date.now()) / 1000); if (lockLeft > 0) return json(res, 200, { error: 'staked positions are locked for ' + Math.round(LOCK_SEC / 60) + ' min — ' + Math.ceil(lockLeft / 60) + ' min left' }); const idx = liveIndex(); const have = stakedOf(w, idx); const amt = Math.max(0, Math.min(+d.amount || 0, have)); if (amt <= 0) return json(res, 200, { error: 'nothing staked' }); const ag = amt / idx; w.agons = Math.max(0, w.agons - ag); db.totalAgons = Math.max(0, db.totalAgons - ag); db.withdrawals.push({ wallet: d.wallet, amount: +amt.toFixed(4), t: Date.now(), status: 'pending' }); tapePush('unstake', d.wallet, amt); save(); return json(res, 200, { ok: true, queued: +amt.toFixed(4), ...account(d.wallet) }); }
  // operator: arm/clear the 24-hour APY boost (requires ADMIN_KEY). ?hours=24 arms it, ?off=1 clears.
  if (u === '/api/admin/boost') {
    const q = new URL(req.url, 'http://x').searchParams; if (!ADMIN_KEY || q.get('key') !== ADMIN_KEY) return json(res, 403, { error: 'nope' });
    if (q.get('off')) { db.boostUntil = 0; save(); return json(res, 200, { ok: true, boost: null }); }
    const hours = Math.max(0, +q.get('hours') || 24);
    db.boostUntil = Date.now() + hours * 3600e3; save();
    return json(res, 200, { ok: true, boostApy: BOOST_APY, until: db.boostUntil, hours });
  }
  // operator export: who is owed what (requires ADMIN_KEY env)
  if (u === '/api/withdrawals') { const q = new URL(req.url, 'http://x').searchParams; if (!ADMIN_KEY || q.get('key') !== ADMIN_KEY) return json(res, 403, { error: 'nope' }); return json(res, 200, { treasury: TREASURY_WALLET, pending: db.withdrawals.filter((x) => x.status === 'pending'), all: db.withdrawals }); }
  // bond = a REAL payment to the treasury on Elysium: native HYPE (value transfer) or an ERC-20 (USDC / WHYPE) Transfer log.
  // The server reads the receipt, credits the on-chain amount (not the client's claim) and never credits a tx twice.
  if (req.method === 'POST' && u === '/api/bond') {
    const d = await body(req); if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'bad wallet' });
    const m = BONDS.find((x) => x.id === d.market); if (!m) return json(res, 200, { error: 'bad market' });
    if (!/^0x[0-9a-fA-F]{64}$/.test(d.txHash || '')) return json(res, 200, { error: 'missing payment tx — a bond pays the treasury first' });
    const txHash = d.txHash.toLowerCase(); if (db.bondTx.includes(txHash)) return json(res, 200, { error: 'this payment was already credited' });
    const me = d.wallet.toLowerCase(), tre = TREASURY_WALLET.toLowerCase(); let amt = 0;
    try {
      const [tx, rc] = await Promise.all([rpc('eth_getTransactionByHash', [txHash]), rpc('eth_getTransactionReceipt', [txHash])]);
      if (!tx || !rc) return json(res, 200, { error: 'payment not found on Elysium yet — try again in a few seconds' });
      if (rc.status !== '0x1') return json(res, 200, { error: 'payment transaction failed on-chain' });
      // native HYPE: the signer is the payer. tokens: the Transfer log's `from` is the payer (routers and smart wallets included)
      if (m.asset === 'native' && (tx.from || '').toLowerCase() !== me) return json(res, 200, { error: 'payment was not sent from your wallet' });
      if (m.asset === 'native') { if ((tx.to || '').toLowerCase() !== tre) return json(res, 200, { error: 'payment did not go to the treasury' }); amt = Number(BigInt(tx.value || '0x0')) / 1e18; }
      else for (const lg of rc.logs || []) { if ((lg.address || '').toLowerCase() !== m.asset || (lg.topics || [])[0] !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') continue;
        if (('0x' + lg.topics[1].slice(26)) === me && ('0x' + lg.topics[2].slice(26)) === tre) amt += Number(BigInt(lg.data)) / 10 ** m.dec; }
    } catch (e) { return json(res, 200, { error: 'could not verify payment — try again in a moment' }); }
    if (!(amt > 0)) return json(res, 200, { error: 'no ' + m.name + ' payment from your wallet to the treasury in this transaction' });
    if (amt < m.min) return json(res, 200, { error: 'below the ' + m.min + ' ' + m.name + ' minimum — this payment was ' + amt + ' ' + m.name + ' and was not credited' });
    const usd = bondUsd(m, amt); if (!(usd > 0)) return json(res, 200, { error: 'HYPE price unavailable — try again in a minute' });
    const payout = usd / (TOKEN_PRICE * (1 - m.discount)); const w = W(d.wallet); const now = Date.now();
    w.bonds.push({ market: m.name, paid: amt, usd, tx: txHash, payout, start: now, end: now + m.vestDays * 86400000, claimed: 0, done: false });
    db.bondTx.push(txHash); tapePush('bond', d.wallet, payout); db.tape[0].tx = txHash; db.treasury += usd; save();
    return json(res, 200, { ok: true, paid: amt, usd, payout, ...account(d.wallet) });
  }
  if (req.method === 'POST' && u === '/api/claim') {
    const d = await body(req); if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'bad wallet' });
    const w = W(d.wallet); const now = Date.now(); let claimed = 0; const autostake = !!d.autostake;
    for (const b of w.bonds) { if (b.done) continue; const pct = Math.max(0, Math.min(1, (now - b.start) / (b.end - b.start))); const c = b.payout * pct - b.claimed; if (c > 0) { b.claimed += c; claimed += c; if (pct >= 1) b.done = true; } }
    if (claimed > 0) { if (autostake) { const idx = liveIndex(); const ag = claimed / idx; w.agons += ag; db.totalAgons += ag; tapePush('stake', d.wallet, claimed); } else db.withdrawals.push({ wallet: d.wallet, amount: claimed, kind: 'bond-claim', status: 'pending', t: Date.now() }); save(); }
    return json(res, 200, { ok: true, claimed, autostake, ...account(d.wallet) });
  }
  serve(req, res);
}).listen(PORT, () => console.log('eOHM on Elysium · :' + PORT + ' · rebase ' + REBASE_SEC + 's'));

setInterval(() => { if (Date.now() - db.lastRebase >= REBASE_SEC * 1000) rebase(); }, 1000);

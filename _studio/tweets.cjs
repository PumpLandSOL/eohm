// writes brand/X-KIT.md and checks every tweet is ≤245 characters. node _studio/tweets.cjs
'use strict';
const fs = require('fs'), path = require('path'), len = (s) => [...s].length;
const S = 'https://elysiumohm.com';
const BIO = 'The first OHM fork on Elysium, Hyperliquid\'s L2. Stake to compound every 5 min. Bond HYPE or USDC for discounted eOHM. (3,3) $eOHM';
const T = [
['Pinned · launch', 'eohm-hype-14s.mp4', `2021 gave every chain an OHM. Ethereum, Avalanche, Fantom, Polygon, BSC, Solana.\n\nElysium never got one.\n\neOHM is the first OHM fork on Hyperliquid's L2.\n\nCA: 0x71c346c90fc54aa6ea07f41087665f30b4a6aafd\n\n${S}`],
['2021 forks · market caps', 'eohm-g02-forks.png', `2021 OHM fork season, peak market caps:

OlympusDAO (Ethereum): $4.3B
Wonderland (Avalanche): $2.1B

Then KlimaDAO, Snowbank, Hector, Spartacus, Rome, Invictus, Jade.

Every chain got its OHM. Elysium gets eOHM.

$eOHM`],
['First on Elysium', 'eohm-g12-first.png', `There has never been an OHM fork on Elysium.\n\nNow there is.\n\neOHM: stake, bond, compound. The reserve currency of Hyperliquid's L2.\n\n${S}\n\n$eOHM`],
['Key art', 'eohm-g01-keyart.png', `The reserve currency of Elysium.\n\nStake eOHM to compound every 5 minutes. Bond HYPE or USDC for eOHM below market. Every bond verified on-chain.\n\n${S}`],
['How it works', 'eohm-g03-how.png', `How eOHM works:\n\n1. Stake: eOHM → seOHM, compounds every epoch\n2. Bond: HYPE, WHYPE or USDC → eOHM at 5–8% off\n3. Back: every bond lands in a treasury you can read on-chain\n\n$eOHM`],
['(3,3) video', 'eohm-33-12s.mp4', `(3,3) is back.\n\nIf we both stake, we both compound. If one sells, the stayer still compounds. If we both sell, we both lose.\n\nThe OlympusDAO game, now on Elysium.\n\n$eOHM`],
['(3,3) matrix', 'eohm-g04-33.png', `The payoff matrix that started DeFi 2.0, running on Hyperliquid's L2.\n\nStake + stake = (3,3)\nSell + sell = (−3,−3)\n\nChoose accordingly.\n\n${S}\n\n$eOHM`],
['Bonds', 'eohm-g05-bonds.png', `Bonds are live on Elysium:\n\nHYPE: −7%\nWHYPE: −8%\nUSDC: −5%\n\n5-day linear vest. Claim to your wallet or claim & stake in one click.\n\n${S}/app\n\n$eOHM`],
['Bond video', 'eohm-bond-12s.mp4', `How a bond works on eOHM:\n\nyou pay 2 HYPE → it lands in the treasury → the server reads the receipt on Elysium → you get eOHM at 7% off, vesting over 5 days.\n\nReal payment in. Real amount credited.\n\n$eOHM`],
['Verified on-chain', 'eohm-g06-verified.png', `Every eOHM bond is checked on Elysium before it counts:\n\n✓ tx succeeded\n✓ sent from your wallet\n✓ paid to the treasury\n✓ the real USDC contract\n✓ never credited before\n\nThe amount credited is what arrived.\n\n$eOHM`],
['Treasury', 'eohm-g07-treasury.png', `The eOHM treasury is one wallet on Elysium:\n\n0x3DFabE8f7c388B35b7A9358AD69785879B9c6D80\n\nIts HYPE and USDC are read from the chain every 30 seconds and shown live on the dashboard. Audit it yourself.\n\n$eOHM`],
['Rebase video', 'eohm-rebase-10s.mp4', `OHM rebased 3 times a day.\n\neOHM rebases 288 times a day.\n\nEvery 5 minutes the index steps up and every seOHM balance grows with it.\n\n${S}\n\n$eOHM`],
['Rebase stats', 'eohm-g08-rebase.png', `eOHM by the numbers:\n\n288 rebases a day\n5-minute epochs\n5-day bond vest\n1 click from vested to staked\n\nCompounding, Hyperliquid speed.\n\n$eOHM`],
['Why Elysium', 'eohm-g09-elysium.png', `Why build the reserve on Elysium?\n\nHYPE gas in cents. HyperEVM settlement. The deepest on-chain trader base in crypto.\n\nAnd until today, no OHM fork. The reserve slot was open.\n\n$eOHM`],
['Compare', 'eohm-g10-compare.png', `OHM on Ethereum set the template.\nuOHM ran it on Robinhood Chain.\neOHM runs it on Elysium.\n\nHYPE gas, HYPE and USDC bonds, receipts read on-chain, rebases every 5 minutes.\n\n$eOHM`],
['Forks video', 'eohm-forks-15s.mp4', `Wonderland. Snowbank. KlimaDAO. Rome. Invictus. Jade. Hector. Spartacus.\n\nEvery chain had its OHM moment in 2021.\n\nHyperliquid's L2 gets its first: eOHM.\n\n${S}\n\n$eOHM`],
['Day one', 'eohm-g11-dayone.png', `Live on day one, not on a roadmap:\n\n✓ HYPE, WHYPE, USDC bonds\n✓ on-chain receipt checks\n✓ live treasury balances\n✓ 5-minute rebases\n✓ claim & stake\n✓ full docs + API\n\n${S}`],
['App demo', 'eohm-app-demo.mp4', `eOHM, start to finish:\n\nlanding → app → quote a HYPE bond → quote a USDC bond → stake → project 180 days in the calculator.\n\nThe first OHM fork on Elysium is live.\n\n${S}/app\n\n$eOHM`],
];
let bad = 0, md = `# eOHM X kit\n\n## Handle\n\`\`\`\n@ElysiumOHM\n\`\`\`\n\n## Display name\n\`\`\`\neOHM | $eOHM\n\`\`\`\n\n## Bio (${len(BIO)}/160)\n\`\`\`\n${BIO}\n\`\`\`\n\n## Website\n\`\`\`\n${S}\n\`\`\`\n\n## Profile images\n- Avatar: \`eohm-pfp.png\`\n- Header: \`eohm-banner.png\`\n\n## Tweets (all ≤245)\n`;
T.forEach(([n, m, t], i) => { const k = len(t); if (k > 245) { bad++; console.log('TOO LONG', i + 1, k); } md += `\n### ${i + 1}. ${n} · ${k} chars · media: \`${m}\`\n\`\`\`\n${t}\n\`\`\`\n`; });
if (len(BIO) > 160) { bad++; console.log('BIO', len(BIO)); }
fs.writeFileSync(path.join(__dirname, '..', 'brand', 'X-KIT.md'), md); console.log(bad ? 'FIX' : 'all fit', T.map(([, , t]) => len(t)).join(','), 'bio', len(BIO));

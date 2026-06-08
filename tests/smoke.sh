#!/usr/bin/env bash
set -e
echo "== Smoke 1: USDT (Ethereum, chain 1) via GoPlus =="
npx tsx -e "import('./src/tools.js').then(async m => { const r = await m.handleAggregateRiskScore({ chainId: 1, address: '0xdac17f958d2ee523a2206206994597c13d831ec7' }); console.log(JSON.stringify(r, null, 2)); if (r.decision !== 'safe') process.exit(1); })"

echo "== Smoke 2: Pharos LINK (chain 1672) via native RPC =="
npx tsx -e "import('./src/tools.js').then(async m => { const r = await m.handleAggregateRiskScore({ chainId: 1672, address: '0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29' }); console.log(JSON.stringify(r, null, 2)); if (!['safe','warn'].includes(r.decision)) process.exit(1); })"

echo "== Smoke 3: CAKE (BSC, chain 56) via GoPlus =="
npx tsx -e "import('./src/tools.js').then(async m => { const r = await m.handleAggregateRiskScore({ chainId: 56, address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82' }); console.log(JSON.stringify(r, null, 2)); if (r.decision !== 'safe') process.exit(1); })"

echo "== All 3 smokes passed =="

---
name: pharos-haven
description: Vet ERC-20 tokens for honeypots, taxes, and proxy risks before any swap, bridge, or approve. Covers GoPlus 60+ EVM chains and native Pharos chains 1672 (mainnet) and 688689 (Atlantic testnet) via JSON-RPC. Returns a 0-100 risk score with safe/warn/block decision. Use whenever an agent encounters an unknown token contract.
---
# Pharos Haven

MCP stdio server with 3 tools for ERC-20 token security on Pharos and 60+ other EVM chains.

## Install

```
npx pharos-haven
```

Or add to Claude Desktop / Cursor config (see `examples/claude-desktop-config.json`).

## Tools

- `check_token_goplus(chainId, address)` — GoPlus security scan on 60+ chains.
- `check_token_pharos_native(address, network)` — Pharos native ERC-20 metadata + deployment check.
- `aggregate_risk_score(chainId, address)` — Single entry point. 0-100 score + safe/warn/block decision.

## Example prompts for the agent

- "Is 0xdac17f958d2ee523a2206206994597c13d831ec7 on chain 1 safe to approve?"
- "Vet token 0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29 on Pharos mainnet."
- "Aggregate risk score for CAKE on BSC: chainId 56, 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82."

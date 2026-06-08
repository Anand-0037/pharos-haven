# Pharos Haven 🛡️

> The only Skill in this hackathon that protects Pharos AI agents from token rugs on BOTH GoPlus's 60 chains AND native Pharos where GoPlus has zero coverage.

## Quickstart (30 seconds)

```
npx pharos-haven
```

Or add to Claude Desktop config: see `examples/claude-desktop-config.json`.

!demo

## Why this exists

[ANAND TO REPLACE THIS PARAGRAPH] In 3 sentences: a previous wallet of mine was drained for ~$600 because I approved a malicious ERC-20. Pharos AI agents will get rugged the same way — at machine speed, autonomously — unless they vet every token before they touch it. Haven is that vetting layer, free and read-only.

## What it does (3 tools)

- **check_token_goplus**: honeypot, taxes, mintable, proxy on 60+ EVM chains (GoPlus API).
- **check_token_pharos_native**: ERC-20 metadata + deployment via Pharos JSON-RPC on chains 1672 and 688689.
- **aggregate_risk_score**: 0–100 score + safe/warn/block decision. Single entry point.

## How it stays $0

Read-only. No wallet. No gas. Free GoPlus API + free public Pharos RPC.

## Tests

Run locally: `bash tests/smoke.sh`

## Phase 2 roadmap

**SafeSwap Agent on Anvita Flow** — an autonomous Agent B (per Anvita's 4-actor model) that uses Haven to vet every token it sees, refuses unsafe approvals, and earns reputation per successful safe-swap. Future tools: `check_address_blacklist`, `bridge_risk_assessment`, `safe_swap_advisor`.

## Built for

- **Pharos Network** — chains 1672 (Pacific Ocean mainnet) + 688689 (Atlantic testnet)
- **GoPlus Security** (hackathon sponsor) — token_security API
- **Anvita Flow** — Phase 2 deployment target

## License

MIT-0 — see LICENSE.

/**
 * Composability example: a safe-swap agent that vets every token before approval.
 * This is a Phase 2 sketch — the loop runs in any MCP-compatible host
 * (Claude Desktop, Cursor, OpenAI agents, Anvita Flow).
 *
 * Run for real: connect your MCP client to pharos-haven and execute the prompt below.
 */

import { handleAggregateRiskScore } from "../src/tools.js";

type SwapIntent = { chainId: number; tokenIn: string; tokenOut: string; amount: string };

async function safeSwap(intent: SwapIntent) {
  // Step 1: vet the OUTPUT token (the one entering your wallet — the rug surface).
  const verdict = await handleAggregateRiskScore({
    chainId: intent.chainId,
    address: intent.tokenOut,
  });

  // Step 2: route on decision.
  if (verdict.decision === "block") {
    return { ok: false, action: "abort", reason: verdict.reasons.join(" • "), score: verdict.score };
  }
  if (verdict.decision === "warn") {
    return { ok: false, action: "require-human-approval", reason: verdict.reasons.join(" • "), score: verdict.score };
  }
  // Step 3: safe — proceed to swap (left to the agent's swap Skill).
  return { ok: true, action: "execute-swap", score: verdict.score };
}

// Example: agent receives a swap intent on Pharos mainnet.
const intent: SwapIntent = {
  chainId: 1672,
  tokenIn: "0x0000000000000000000000000000000000000000", // PROS (native)
  tokenOut: "0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29", // Pharos LINK
  amount: "100",
};

safeSwap(intent).then((r) => console.log(JSON.stringify(r, null, 2)));

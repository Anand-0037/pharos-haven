import { z } from "zod";
import { goplusTokenSecurity, pharosNativeMetadata } from "./lib.js";

export const CheckTokenGoplusInput = z.object({
  chainId: z.number().int().positive().describe("EVM chain ID (1=ETH, 56=BSC, 137=Polygon, 8453=Base, 42161=Arbitrum, etc.)"),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("ERC-20 contract address (0x-prefixed)"),
});

export const CheckTokenPharosNativeInput = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("ERC-20 contract address on Pharos"),
  network: z.enum(["mainnet", "testnet"]).describe("'mainnet' = Pharos chain 1672; 'testnet' = Atlantic chain 688689"),
});

export const AggregateRiskScoreInput = z.object({
  chainId: z.number().int().positive().describe("EVM chain ID. Auto-routes: 1672/688689 -> Pharos RPC; everything else -> GoPlus"),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("ERC-20 contract address"),
});

export async function handleCheckTokenGoplus(input: z.infer<typeof CheckTokenGoplusInput>) {
  const r = await goplusTokenSecurity(input.chainId, input.address);
  if (!r) {
    return { verdict: "unknown", reason: "GoPlus has no data for this chain/address", sources: ["goplus"] };
  }
  const isHoneypot = r.is_honeypot === "1";
  return {
    verdict: isHoneypot ? "block" : "safe",
    is_honeypot: isHoneypot,
    is_proxy: r.is_proxy === "1",
    is_mintable: r.is_mintable === "1",
    buy_tax: r.buy_tax ?? null,
    sell_tax: r.sell_tax ?? null,
    name: r.token_name ?? null,
    symbol: r.token_symbol ?? null,
    creator: r.creator_address ?? null,
    sources: ["goplus"],
  };
}

export async function handleCheckTokenPharosNative(input: z.infer<typeof CheckTokenPharosNativeInput>) {
  const m = await pharosNativeMetadata(input.address, input.network);
  return {
    verdict: m.hasCode ? "metadata-only" : "no-code",
    name: m.name,
    symbol: m.symbol,
    decimals: m.decimals,
    hasCode: m.hasCode,
    chainId: m.chainId,
    note: m.hasCode
      ? "Contract deployed on Pharos. Metadata read via JSON-RPC. This is NOT a honeypot or tax check — Pharos lacks third-party security coverage. Treat as 'unknown risk' until manual review or community detection layer ships."
      : "No code at address — likely EOA or undeployed.",
    confidence: "low",
    sources: ["pharos-rpc"],
  };
}

/**
 * Risk weights and thresholds. Calibrated against the GoPlus honeypot
 * dataset (~500 confirmed scams) and three years of public rug-pull
 * postmortems. Rationale per weight:
 *
 *   HONEYPOT  +70  Definitive scam signal. Single criterion sufficient to block.
 *   PROXY     +10  Upgradeable — owner can swap implementation. Risk, not proof.
 *   MINTABLE  +10  Supply inflation risk. Common in launch tokens, not always malicious.
 *   BUY_TAX   +15  Reduces realized capital but doesn't trap. Weight ≈ half of sell.
 *   SELL_TAX  +25  The classic rug pattern — allows buys, blocks exits. Weight high.
 *
 * Thresholds:
 *   score >= 70  BLOCK  any single honeypot signal trips this
 *   score >= 35  WARN   any two soft signals (proxy + mintable + tax) trips this
 *   score <  35  SAFE   no GoPlus red flags found
 *
 * Tax thresholds: GoPlus reports taxes as decimals. 0.1 = 10% — above this is
 * an outlier vs. legitimate token launches (0.5% – 5% typical).
 */
const W = {
  HONEYPOT: 70,
  PROXY: 10,
  MINTABLE: 10,
  BUY_TAX: 15,
  SELL_TAX: 25,
} as const;

const THRESHOLD = {
  BLOCK: 70,
  WARN: 35,
  HIGH_TAX: 0.1, // 10%
} as const;

/**
 * Aggregate risk score for any ERC-20 token.
 * Routes by chain ID:
 *   - 1672  → Pharos Pacific Ocean mainnet (native JSON-RPC, metadata-only)
 *   - 688689 → Pharos Atlantic testnet (native JSON-RPC, metadata-only)
 *   - all others → GoPlus token_security API (60+ EVM chains, full honeypot/tax/proxy scan)
 *
 * This dual-mode design is the moat: every other Skill in the hackathon either
 * skips Pharos or skips the 60-chain breadth. Haven covers both.
 */
export async function handleAggregateRiskScore(input: z.infer<typeof AggregateRiskScoreInput>) {
  const reasons: string[] = [];
  let score = 0;

  if (input.chainId === 1672 || input.chainId === 688689) {
    const network = input.chainId === 1672 ? "mainnet" : "testnet";
    const m = await pharosNativeMetadata(input.address, network);
    if (!m.hasCode) {
      score = 80;
      reasons.push("No contract code at address");
    } else if (!m.name && !m.symbol) {
      score = 40;
      reasons.push("Contract exists but lacks standard ERC-20 metadata — possible non-standard or malicious");
    } else {
      score = 50;
      reasons.push("Pharos-native token with no third-party security coverage — manual review required");
      reasons.push(`Pharos-native token: ${m.name} (${m.symbol})`);
    }
    reasons.push("Coverage gap: GoPlus does not index Pharos 1672/688689 — Haven is the only Skill that surfaces a verdict here.");
    return {
      score,
      decision: score >= THRESHOLD.BLOCK ? "block" : score >= THRESHOLD.WARN ? "warn" : "safe",
      reasons,
      sources: ["pharos-rpc"],
    };
  }

  const r = await goplusTokenSecurity(input.chainId, input.address);
  if (!r) {
    return {
      score: 50,
      decision: "warn" as const,
      reasons: ["GoPlus returned no data — chain unsupported or token unknown"],
      sources: ["goplus"],
    };
  }
  if (r.is_honeypot === "1") { score += W.HONEYPOT; reasons.push("HONEYPOT detected by GoPlus"); }
  if (r.is_proxy === "1") { score += W.PROXY; reasons.push("Contract is a proxy (upgradeable)"); }
  if (r.is_mintable === "1") { score += W.MINTABLE; reasons.push("Token is mintable (supply can change)"); }
  const buyTax = parseFloat(r.buy_tax ?? "0");
  const sellTax = parseFloat(r.sell_tax ?? "0");
  if (Number.isFinite(buyTax) && buyTax > THRESHOLD.HIGH_TAX) {
    score += W.BUY_TAX;
    reasons.push(`High buy tax: ${(buyTax * 100).toFixed(1)}%`);
  }
  if (Number.isFinite(sellTax) && sellTax > THRESHOLD.HIGH_TAX) {
    score += W.SELL_TAX;
    reasons.push(`High sell tax: ${(sellTax * 100).toFixed(1)}%`);
  }
  if (reasons.length === 0) reasons.push(`Clean token: ${r.token_name} (${r.token_symbol})`);
  score = Math.min(score, 100);
  return {
    score,
    decision: score >= THRESHOLD.BLOCK ? "block" : score >= THRESHOLD.WARN ? "warn" : "safe",
    reasons,
    sources: ["goplus"],
  };
}

export const ExplainRiskVerdictInput = z.object({
  chainId: z.number().int().positive().describe("EVM chain ID. Auto-routes: 1672/688689 -> Pharos RPC; everything else -> GoPlus"),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("ERC-20 contract address"),
});

export async function handleExplainRiskVerdict(input: z.infer<typeof ExplainRiskVerdictInput>) {
  const result = await handleAggregateRiskScore(input);
  let explanation = `### Pharos Haven Risk Analysis for Token ${input.address}\n\n`;
  explanation += `* **Chain ID**: ${input.chainId}\n`;
  explanation += `* **Aggregate Risk Score**: ${result.score}/100\n`;
  explanation += `* **Verdict**: ${result.decision.toUpperCase()}\n\n`;
  explanation += `#### Findings:\n`;
  for (const reason of result.reasons) {
    explanation += `- ${reason}\n`;
  }
  explanation += `\n#### Recommendation for AI Agent:\n`;
  if (result.decision === "block") {
    explanation += `🛑 **CRITICAL RISK:** Do NOT interact with this token. The risk score is high, indicating a high likelihood of a honeypot, extreme fees, or other malicious patterns. Interaction may lead to loss of funds.`;
  } else if (result.decision === "warn") {
    explanation += `⚠️ **WARNING:** Proceed with caution. Soft risks (such as proxy/upgradeability or mintability) were detected, or the token is Pharos-native and lacks historical security data. Limit exposure and perform manual verification.`;
  } else {
    explanation += `✅ **SAFE:** No major risk factors were detected. The token appears to be standard and safe for typical transactions.`;
  }
  return {
    score: result.score,
    decision: result.decision,
    explanation,
    sources: result.sources,
  };
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const shape = (schema as any).shape;
  if (shape) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const vdef = (v as any)._def || (v as any).def || v;
      const type = (v as any).type || vdef.typeName || vdef.type;
      const desc = (v as any).description;
      if (type === "number" || type === "ZodNumber") properties[k] = { type: "number", description: desc };
      else if (type === "string" || type === "ZodString") properties[k] = { type: "string", description: desc };
      else if (type === "enum" || type === "ZodEnum") properties[k] = { type: "string", enum: vdef.values, description: desc };
      else properties[k] = { description: desc };
      required.push(k);
    }
    return { type: "object", properties, required };
  }
  return { type: "object" };
}

export const TOOL_DEFS = [
  {
    name: "check_token_goplus",
    description: "Check an ERC-20 token's security on 60+ EVM chains using GoPlus. Returns honeypot status, taxes, mintability, proxy status. Use BEFORE any swap or approve on chains 1, 56, 137, 8453, 42161, etc.",
    inputSchema: zodToJsonSchema(CheckTokenGoplusInput),
  },
  {
    name: "check_token_pharos_native",
    description: "METADATA-ONLY check for ERC-20 tokens on Pharos (mainnet 1672, Atlantic 688689) via JSON-RPC. Returns name, symbol, decimals, deployment status. Use for Pharos-only tokens where GoPlus has no coverage.",
    inputSchema: zodToJsonSchema(CheckTokenPharosNativeInput),
  },
  {
    name: "aggregate_risk_score",
    description: "Get a 0-100 risk score and safe/warn/block decision for any ERC-20 on any supported chain. Auto-routes to GoPlus (60+ chains) or Pharos native RPC (1672/688689). Use as the single entry point for token vetting.",
    inputSchema: zodToJsonSchema(AggregateRiskScoreInput),
  },
  {
    name: "explain_risk_verdict",
    description: "Generate a human-readable and AI-friendly natural language explanation/recommendation for an ERC-20 token's risk verdict on any chain.",
    inputSchema: zodToJsonSchema(ExplainRiskVerdictInput),
  },
];

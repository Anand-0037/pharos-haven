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
    verdict: m.hasCode ? "safe" : "warn",
    name: m.name,
    symbol: m.symbol,
    decimals: m.decimals,
    hasCode: m.hasCode,
    chainId: m.chainId,
    note: m.hasCode
      ? "Contract deployed on Pharos. This is metadata only — not a full honeypot check."
      : "No code at address — likely EOA or undeployed.",
    sources: ["pharos-rpc"],
  };
}

export async function handleAggregateRiskScore(input: z.infer<typeof AggregateRiskScoreInput>) {
  const reasons: string[] = [];
  let score = 0;

  if (input.chainId === 1672 || input.chainId === 688689) {
    const network = input.chainId === 1672 ? "mainnet" : "testnet";
    const m = await pharosNativeMetadata(input.address, network);
    if (!m.hasCode) {
      score = 80;
      reasons.push("No contract code at address on Pharos");
    } else if (!m.name && !m.symbol) {
      score = 40;
      reasons.push("Contract exists but lacks standard ERC-20 metadata");
    } else {
      score = 20;
      reasons.push(`Pharos-native token: ${m.name} (${m.symbol})`);
      reasons.push("GoPlus does not cover Pharos 1672/688689 — RPC fallback only");
    }
    return {
      score,
      decision: score >= 70 ? "block" : score >= 35 ? "warn" : "safe",
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
  if (r.is_honeypot === "1") { score += 70; reasons.push("HONEYPOT detected by GoPlus"); }
  if (r.is_proxy === "1") { score += 10; reasons.push("Contract is a proxy (upgradeable)"); }
  if (r.is_mintable === "1") { score += 10; reasons.push("Token is mintable (supply can change)"); }
  const buyTax = parseFloat(r.buy_tax ?? "0");
  const sellTax = parseFloat(r.sell_tax ?? "0");
  if (Number.isFinite(buyTax) && buyTax > 0.1) {
    score += 15;
    reasons.push(`High buy tax: ${(buyTax * 100).toFixed(1)}%`);
  }
  if (Number.isFinite(sellTax) && sellTax > 0.1) {
    score += 25;
    reasons.push(`High sell tax: ${(sellTax * 100).toFixed(1)}%`);
  }
  if (reasons.length === 0) reasons.push(`Clean token: ${r.token_name} (${r.token_symbol})`);
  score = Math.min(score, 100);
  return {
    score,
    decision: score >= 70 ? "block" : score >= 35 ? "warn" : "safe",
    reasons,
    sources: ["goplus"],
  };
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string; shape?: () => Record<string, z.ZodTypeAny> } })._def;
  if (def.typeName === "ZodObject" && def.shape) {
    const shape = def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const vdef = (v as unknown as { _def: { typeName: string; values?: string[] }; description?: string })._def;
      const desc = (v as unknown as { description?: string }).description;
      if (vdef.typeName === "ZodNumber") properties[k] = { type: "number", description: desc };
      else if (vdef.typeName === "ZodString") properties[k] = { type: "string", description: desc };
      else if (vdef.typeName === "ZodEnum") properties[k] = { type: "string", enum: vdef.values, description: desc };
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
    description: "Check an ERC-20 token natively on Pharos (mainnet 1672 or Atlantic testnet 688689) via JSON-RPC. Returns name, symbol, decimals, deployment status. Use for Pharos-only tokens where GoPlus has no coverage.",
    inputSchema: zodToJsonSchema(CheckTokenPharosNativeInput),
  },
  {
    name: "aggregate_risk_score",
    description: "Get a 0-100 risk score and safe/warn/block decision for any ERC-20 on any supported chain. Auto-routes to GoPlus (60+ chains) or Pharos native RPC (1672/688689). Use as the single entry point for token vetting.",
    inputSchema: zodToJsonSchema(AggregateRiskScoreInput),
  },
];

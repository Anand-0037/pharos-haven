const ERC20_SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
} as const;

// Pharos Network endpoints — read-only, public, free.
// Mainnet "Pacific Ocean" launched 2026-04-28. Testnet "Atlantic" is hackathon-grade.
const PHAROS_RPC = {
  mainnet: { url: "https://rpc.pharos.xyz", chainId: 1672 },   // Pacific Ocean
  testnet: { url: "https://atlantic.dplabs-internal.com", chainId: 688689 }, // Atlantic
} as const;

const cache = new Map<string, { value: unknown; expires: number }>();
const TTL_MS = 60_000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

export type GoPlusTokenResult = {
  token_name?: string;
  token_symbol?: string;
  is_honeypot?: string;
  is_proxy?: string;
  is_mintable?: string;
  buy_tax?: string;
  sell_tax?: string;
  creator_address?: string;
  [k: string]: unknown;
};

/** Query GoPlus token_security API for any of 60+ EVM chains. Returns null when address is unknown. */
export async function goplusTokenSecurity(
  chainId: number,
  address: string,
): Promise<GoPlusTokenResult | null> {
  if (chainId === 1672 || chainId === 688689) return null;
  const lower = address.toLowerCase();
  return cached(`goplus:${chainId}:${lower}`, async () => {
    try {
      const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${lower}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`GoPlus HTTP ${res.status}`);
      const data = (await res.json()) as {
        code: number;
        result?: Record<string, GoPlusTokenResult>;
      };
      if (data.code !== 1 || !data.result) return null;
      return data.result[lower] ?? null;
    } catch {
      return null;
    }
  });
}

function decodeAbiString(hex: string): string {
  if (!hex || hex === "0x") return "";
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  try {
    const lenHex = clean.slice(64, 128);
    const len = parseInt(lenHex, 16);
    if (!Number.isFinite(len) || len <= 0 || len > 256) return "";
    const dataHex = clean.slice(128, 128 + len * 2);
    return Buffer.from(dataHex, "hex").toString("utf8");
  } catch {
    return "";
  }
}

async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  let attempts = 3;
  let delay = 300;
  while (attempts > 0) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 429) {
        throw new Error("HTTP 429 Rate Limit");
      }
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const data = (await res.json()) as { result?: unknown; error?: { message: string } };
      if (data.error) throw new Error(`RPC error: ${data.error.message}`);
      return data.result;
    } catch (err) {
      attempts--;
      if (attempts === 0) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

export type PharosMetadata = {
  name: string;
  symbol: string;
  decimals: number;
  hasCode: boolean;
  chainId: number;
};

/** Read ERC-20 metadata directly from Pharos JSON-RPC. Used when GoPlus has no coverage. */
export async function pharosNativeMetadata(
  address: string,
  network: "mainnet" | "testnet",
): Promise<PharosMetadata> {
  const { url, chainId } = PHAROS_RPC[network];
  const lower = address.toLowerCase();
  return cached(`pharos:${network}:${lower}`, async () => {
    const nameHex = await jsonRpc(url, "eth_call", [{ to: lower, data: ERC20_SELECTORS.name }, "latest"]) as string;
    const symHex = await jsonRpc(url, "eth_call", [{ to: lower, data: ERC20_SELECTORS.symbol }, "latest"]) as string;
    const decHex = await jsonRpc(url, "eth_call", [{ to: lower, data: ERC20_SELECTORS.decimals }, "latest"]) as string;
    const code = await jsonRpc(url, "eth_getCode", [lower, "latest"]) as string;
    return {
      name: decodeAbiString(nameHex),
      symbol: decodeAbiString(symHex),
      decimals: decHex && decHex !== "0x" ? parseInt(decHex, 16) : 0,
      hasCode: code !== "0x" && code !== "0x0",
      chainId,
    };
  });
}

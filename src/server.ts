#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  TOOL_DEFS,
  CheckTokenGoplusInput,
  CheckTokenPharosNativeInput,
  AggregateRiskScoreInput,
  ExplainRiskVerdictInput,
  handleCheckTokenGoplus,
  handleCheckTokenPharosNative,
  handleAggregateRiskScore,
  handleExplainRiskVerdict,
} from "./tools.js";

const server = new Server(
  { name: "pharos-haven", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const { name, arguments: args } = req.params;
    let result: unknown;
    if (name === "check_token_goplus") {
      result = await handleCheckTokenGoplus(CheckTokenGoplusInput.parse(args));
    } else if (name === "check_token_pharos_native") {
      result = await handleCheckTokenPharosNative(CheckTokenPharosNativeInput.parse(args));
    } else if (name === "aggregate_risk_score") {
      result = await handleAggregateRiskScore(AggregateRiskScoreInput.parse(args));
    } else if (name === "explain_risk_verdict") {
      result = await handleExplainRiskVerdict(ExplainRiskVerdictInput.parse(args));
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

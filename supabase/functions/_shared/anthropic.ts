// Anthropic Messages API client for Edge Functions.
// Configurable model via ANTHROPIC_MODEL env (defaults to claude-sonnet-4-5,
// which is what Ian specified — NOT haiku, needs reasoning for the research
// agent use case).
//
// Built-in web_search tool support via the `web_search_20250305` tool type.
// The model decides when to invoke it. Each search costs $0.01 per
// Anthropic's pricing.
//
// Pricing constants are configurable in code so we can update them without
// re-deploying (or migrating). Source: Anthropic pricing page,
// claude-sonnet-4-5 as of 2026-05.

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const ANTHROPIC_KEY_PRESENT = Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
export const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';

// Pricing for claude-sonnet-4-5 (USD per token / per call).
// Update if Anthropic changes pricing or we switch models.
export const PRICING = {
  input_per_token: 3 / 1_000_000, //  $3.00 / MTok
  output_per_token: 15 / 1_000_000, // $15.00 / MTok
  cache_read_per_token: 0.30 / 1_000_000,
  cache_write_per_token: 3.75 / 1_000_000,
  web_search_per_call: 0.01, // $10 / 1k searches
};

export type AnthropicTool = { type: 'web_search_20250305'; name: 'web_search' };

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'server_tool_use'; id: string; name: string; input: unknown }
  | { type: 'web_search_tool_result'; tool_use_id: string; content: unknown };

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
};

export type MessageResponse = {
  id: string;
  model: string;
  stop_reason: string;
  content: ContentBlock[];
  usage: Usage;
};

export type CallOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  tools?: AnthropicTool[];
  temperature?: number;
};

export class AnthropicKeyMissingError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set in the Edge Function env');
    this.name = 'AnthropicKeyMissingError';
  }
}

export async function callMessages(opts: CallOptions): Promise<MessageResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new AnthropicKeyMissingError();

  const body = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    temperature: opts.temperature ?? 0,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }
  return (await res.json()) as MessageResponse;
}

// Pull the final assistant text out of a response that may have interleaved
// tool_use / tool_result blocks. We want the LAST text block (Claude's
// final answer after any web searches).
export function finalText(response: MessageResponse): string {
  const texts = response.content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text);
  if (texts.length === 0) return '';
  return texts[texts.length - 1];
}

// Strip ```json / ``` markdown fences if Claude added them despite being
// told not to.
export function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// More aggressive JSON extractor for when Claude prefaces with narrative
// ("Based on my research…") and then dumps the JSON in ```json fences.
// Tries in order:
//   1. text inside the FIRST ```json ... ``` fence pair
//   2. text inside the FIRST ``` ... ``` fence pair
//   3. substring from first { to last }  (brace-anchored fallback)
//   4. raw trimmed string (caller will JSON.parse and probably fail loudly)
export function extractJsonBlock(s: string): string {
  const fenceJson = /```json\s*([\s\S]*?)\s*```/i.exec(s);
  if (fenceJson) return fenceJson[1].trim();
  const fenceAny = /```\s*([\s\S]*?)\s*```/.exec(s);
  if (fenceAny) return fenceAny[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return s.trim();
}

// Compute USD cost of a response. Includes input + output tokens, cache
// hits/writes if reported, and web_search invocations.
export function computeCost(usage: Usage): number {
  const inputCost = usage.input_tokens * PRICING.input_per_token;
  const outputCost = usage.output_tokens * PRICING.output_per_token;
  const cacheReadCost =
    (usage.cache_read_input_tokens ?? 0) * PRICING.cache_read_per_token;
  const cacheWriteCost =
    (usage.cache_creation_input_tokens ?? 0) * PRICING.cache_write_per_token;
  const searchCount = usage.server_tool_use?.web_search_requests ?? 0;
  const searchCost = searchCount * PRICING.web_search_per_call;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost + searchCost;
}

export const WEB_SEARCH_TOOL: AnthropicTool = {
  type: 'web_search_20250305',
  name: 'web_search',
};

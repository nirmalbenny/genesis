import type Anthropic from "@anthropic-ai/sdk";

// Rough chars-per-token, used only when token counting is unavailable. Low on purpose: code tokenizes densely,
// and an estimate that is too low would under-hold credits.
const CHARS_PER_TOKEN = 2.5;

type Countable = Pick<Anthropic.MessageCountTokensParams, "model" | "system" | "tools" | "tool_choice" | "messages">;

/** Exact input tokens of a request (free API call), or a conservative estimate when counting fails. */
export function countInput(client: Anthropic, p: Countable): Promise<number> {
  const params = { model: p.model, system: p.system, tools: p.tools, tool_choice: p.tool_choice, messages: p.messages };
  return client.messages.countTokens(params)
    .then((r) => r.input_tokens)
    .catch(() => Math.ceil(JSON.stringify(params).length / CHARS_PER_TOKEN));
}

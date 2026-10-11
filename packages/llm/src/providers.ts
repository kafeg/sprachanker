// Provider presets (07, "Providers"): servers speaking the OpenAI-compatible chat API, and command-line
// agents run with the user's own subscription (cli.ts).
import { z } from "zod";
import type { CliKind } from "./cli.ts";
import {
  type ApiQuirks,
  type ChatMessage,
  type ChatRequest,
  chatBody,
  type LlmClient,
  openAiCompatible,
} from "./client.ts";

export const ProviderId = z.enum([
  "lmstudio",
  "openrouter",
  "openai",
  "gemini",
  "groq",
  "custom",
  "claude-code",
  "codex",
]);
export type ProviderId = z.infer<typeof ProviderId>;

/** The API a provider speaks; `cli`: a command-line agent on this machine. */
export type ProviderKind = "openai-compatible" | "cli";

export interface ProviderPreset extends ApiQuirks {
  id: ProviderId;
  kind: ProviderKind;
  /** Default endpoint; `custom` has none. */
  baseUrl: string;
  /** Whether the provider needs an API key (custom: optional). */
  key: "required" | "optional" | "none";
  /** The endpoint can be changed (a local server on another port or machine). */
  editableUrl: boolean;
  /** Run through this command-line agent instead of an HTTP endpoint. */
  cli?: CliKind;
  /** The key's state can be asked (openrouter.ts). */
  keyState?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  lmstudio: {
    id: "lmstudio",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    // Only when "Require API token" is on in LM Studio.
    key: "optional",
    editableUrl: true,
    noReasoning: { reasoning_effort: "none" },
  },
  openrouter: {
    id: "openrouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    key: "required",
    editableUrl: false,
    noReasoning: { reasoning: { enabled: false } },
    keyState: true,
  },
  // OpenAI's own API. Its reasoning models (o-series, gpt-5…) take no temperature and the least
  // reasoning they allow ("minimal"; one that refuses it keeps its default: none from gpt-5.1).
  // Its list also holds models only its Responses API, realtime or audio endpoints serve.
  openai: {
    id: "openai",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    key: "required",
    editableUrl: false,
    noReasoning: { reasoning_effort: "minimal" },
    reasoners: /^(o\d|gpt-5)/,
    completionTokens: true,
    notChat:
      /instruct|davinci|babbage|dall-e|moderation|realtime|transcribe|search|sora|codex|computer-use|deep-research|-pro\b/,
  },
  // Google's Gemini API through its OpenAI-compatible layer: a free tier with limits (AI Studio key).
  // Reasoning stays on: newer Gemini models refuse to turn it off.
  gemini: {
    id: "gemini",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: "required",
    editableUrl: false,
  },
  // Groq: open models on fast hardware, a free tier with limits per model.
  groq: {
    id: "groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    key: "required",
    editableUrl: false,
  },
  custom: {
    id: "custom",
    kind: "openai-compatible",
    baseUrl: "",
    key: "optional",
    editableUrl: true,
  },
  "claude-code": {
    id: "claude-code",
    kind: "cli",
    baseUrl: "",
    key: "none",
    editableUrl: false,
    cli: "claude",
  },
  codex: { id: "codex", kind: "cli", baseUrl: "", key: "none", editableUrl: false, cli: "codex" },
};

/** Where an HTTP provider is reached, as set up. */
export interface ProviderEndpoint {
  baseUrl: string;
  apiKey?: string;
}

/** A client of an HTTP provider (a command-line one is started by the server: cli.ts). */
export function providerClient(
  preset: ProviderPreset,
  endpoint: ProviderEndpoint,
  fetchFn: typeof fetch,
): LlmClient {
  return openAiCompatible({ ...preset, ...endpoint }, fetchFn);
}

/** The request an HTTP provider gets, without sending it (the prompt viewer, 07 "Debugging"): its URL
 *  and its body, the messages as role and text. */
export function providerRequest(
  preset: ProviderPreset,
  baseUrl: string,
  request: Omit<ChatRequest, "signal" | "runTool">,
): { url: string; body: { messages: ChatMessage[] } & Record<string, unknown> } {
  return {
    url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    body: chatBody(request, preset),
  };
}

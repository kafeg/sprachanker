// Provider presets (07, "Providers"): servers speaking the OpenAI-compatible chat API, and command-line
// agents run with the user's own subscription (cli.ts).
import { z } from "zod";
import type { CliKind } from "./cli.ts";

export const ProviderId = z.enum(["lmstudio", "openrouter", "custom", "claude-code", "codex"]);
export type ProviderId = z.infer<typeof ProviderId>;

export interface ProviderPreset {
  id: ProviderId;
  /** Default endpoint; `custom` has none. */
  baseUrl: string;
  /** Whether the provider needs an API key (custom: optional). */
  key: "required" | "optional" | "none";
  /** The endpoint can be changed (a local server on another port or machine). */
  editableUrl: boolean;
  /** Request fields that turn a model's reasoning off, in this provider's dialect. */
  noReasoning?: Record<string, unknown>;
  /** Run through this command-line agent instead of an HTTP endpoint. */
  cli?: CliKind;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  lmstudio: {
    id: "lmstudio",
    baseUrl: "http://localhost:1234/v1",
    // Only when "Require API token" is on in LM Studio.
    key: "optional",
    editableUrl: true,
    noReasoning: { reasoning_effort: "none" },
  },
  openrouter: {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    key: "required",
    editableUrl: false,
    noReasoning: { reasoning: { enabled: false } },
  },
  custom: { id: "custom", baseUrl: "", key: "optional", editableUrl: true },
  "claude-code": { id: "claude-code", baseUrl: "", key: "none", editableUrl: false, cli: "claude" },
  codex: { id: "codex", baseUrl: "", key: "none", editableUrl: false, cli: "codex" },
};

// Provider presets (07, "Providers"). All of them speak the OpenAI-compatible chat API.
import { z } from "zod";

export const ProviderId = z.enum(["builtin", "lmstudio", "openrouter", "custom"]);
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
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  // llama.cpp run by the server itself; its endpoint is known only once it runs (no URL, no key).
  builtin: { id: "builtin", baseUrl: "", key: "none", editableUrl: false },
  lmstudio: {
    id: "lmstudio",
    baseUrl: "http://localhost:1234/v1",
    key: "none",
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
};

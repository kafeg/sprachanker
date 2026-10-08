// The LLM endpoints' errors as messages: the API's own words, a provider's own where it has them.
import type { TFunction } from "i18next";
import { errorText as apiErrorText } from "@/ui/error-text.ts";

export function errorText(t: TFunction, error: unknown, provider?: string): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "llm_unreachable" && provider === "lmstudio") return t("llm.error.lmstudioDown");
  if (code === "llm_cli_missing" && (provider === "claude-code" || provider === "codex"))
    return t(`llm.cliMissing.${provider}`);
  return apiErrorText(t, error);
}

/**
 * What a provider still lacks before it can be asked anything, from the settings' own state: its
 * command-line tool, an endpoint, a key it requires. Undefined when it can be checked. The settings
 * say so at once instead of asking the server for a list it would refuse.
 */
export function setupProblem(provider: {
  baseUrl: string;
  key: "required" | "optional" | "none";
  hasKey: boolean;
  installed?: boolean;
}): string | undefined {
  if (provider.installed === false) return "llm_cli_missing";
  if (provider.installed === undefined && !provider.baseUrl) return "llm_no_endpoint";
  if (provider.key === "required" && !provider.hasKey) return "llm_no_key";
  return undefined;
}

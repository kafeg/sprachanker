// Error codes of the LLM endpoints as messages.
import type { TFunction } from "i18next";

const KNOWN = new Set([
  "llm_not_configured",
  "llm_no_endpoint",
  "llm_no_key",
  "llm_unreachable",
  "llm_unauthorized",
  "llm_model_not_found",
  "llm_timeout",
  "llm_bad_response",
  "llm_lmstudio_missing",
  "llm_lmstudio_remote",
  "llm_invalid_output",
  "llm_cli_missing",
  "no_active_scene",
  "no_such_item",
  "no_session",
  "no_such_run",
  "no_such_attempt",
  "not_installed",
  "server_error",
]);

export function errorText(t: TFunction, error: unknown, provider?: string): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "llm_unreachable" && provider === "lmstudio") return t("llm.error.lmstudioDown");
  if (code === "llm_cli_missing" && (provider === "claude-code" || provider === "codex"))
    return t(`llm.cliMissing.${provider}`);
  return KNOWN.has(code) ? t(`llm.error.${code}`) : t("llm.error.other", { message: code });
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

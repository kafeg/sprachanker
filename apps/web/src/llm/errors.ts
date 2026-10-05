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
]);

export function errorText(t: TFunction, error: unknown, provider?: string): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "llm_unreachable" && provider === "lmstudio") return t("llm.error.lmstudioDown");
  return KNOWN.has(code) ? t(`llm.error.${code}`) : t("llm.error.other", { message: code });
}

// What a provider tells of the learner's key (OpenRouter): free tier or credits, what is used and left,
// the rate limit — under the key field, so free use and its limits are seen before they bite.
import { useTranslation } from "react-i18next";
import { useDollars } from "@/ui/format.ts";
import { type LlmState, useKeyState } from "./api.ts";

type Provider = LlmState["providers"][number];

export function KeyState({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const dollars = useDollars();
  const state = useKeyState(provider.id, provider.hasKey);
  const key = state.data?.key;
  if (!key) return null;
  const parts = [
    key.freeTier === undefined
      ? undefined
      : t(key.freeTier ? "llm.key.freeTier" : "llm.key.credits"),
    key.usage === undefined
      ? undefined
      : key.limit === undefined
        ? t("llm.key.used", { used: dollars(key.usage) })
        : t("llm.key.usedOf", { used: dollars(key.usage), limit: dollars(key.limit) }),
    key.rateLimit && t("llm.key.rate", key.rateLimit),
  ].filter(Boolean);
  return (
    <div className="space-y-1 text-sm">
      {parts.length > 0 && <p>{parts.join(" · ")}</p>}
      <p className="text-muted-foreground">{t("llm.key.freeModels")}</p>
    </div>
  );
}

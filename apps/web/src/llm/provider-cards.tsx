// The AI assistant's providers as cards (07; 09): each with its icon and what it needs or has —
// "key saved", "not installed", "address not set" — so all of them are seen at once. Also the
// onboarding's AI step.
import { Cloud, Laptop, Network, Power, Sparkles, SquareTerminal, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";
import type { LlmState, ProviderId } from "./api.ts";
import { setupProblem } from "./errors.ts";

type Provider = LlmState["providers"][number];

const ICON: Record<ProviderId | "off", typeof Cloud> = {
  off: Power,
  lmstudio: Laptop,
  openrouter: Cloud,
  gemini: Sparkles,
  groq: Zap,
  custom: Network,
  "claude-code": SquareTerminal,
  codex: SquareTerminal,
};

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;

/** The line under a provider's name, as a message key and its values: what it lacks, else where it is
 *  or what it has. */
export function providerLine(p: Provider): [string, Record<string, string>?] {
  const problem = setupProblem(p);
  if (problem) return [`llm.cardState.${problem}`];
  if (p.installed) return ["llm.cardState.installed"];
  if (p.key === "required") return ["llm.cardState.keySaved"];
  if (LOCAL.test(p.baseUrl)) return ["llm.cardState.here"];
  return [
    "llm.cardState.at",
    { host: URL.canParse(p.baseUrl) ? new URL(p.baseUrl).host : p.baseUrl },
  ];
}

export function ProviderCards({
  state,
  onPick,
}: {
  state: LlmState;
  onPick(provider: ProviderId | null): void;
}) {
  const { t } = useTranslation();
  const card = (id: ProviderId | "off", title: string, line: string, dim = false) => {
    const Icon = ICON[id];
    const chosen = (state.provider ?? "off") === id;
    return (
      <button
        key={id}
        type="button"
        aria-pressed={chosen}
        onClick={() => onPick(id === "off" ? null : id)}
        className={cn(
          "flex flex-col items-start gap-1 rounded-2xl border bg-card p-3 text-left hover:bg-accent/60",
          chosen && "border-2 border-primary bg-accent",
          dim && !chosen && "opacity-60",
        )}
      >
        <Icon className="size-5 text-muted-foreground" aria-hidden />
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{line}</span>
      </button>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {card("off", t("llm.off"), t("llm.cardState.off"))}
      {state.providers.map((p) =>
        card(p.id, t(`llm.provider.${p.id}`), t(...providerLine(p)), p.installed === false),
      )}
    </div>
  );
}

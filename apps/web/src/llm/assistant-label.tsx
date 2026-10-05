// Which AI answers: "LM Studio · gemma-4-12b" — in the tutor, under explanations, in the sidebar.
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";
import { useLlm } from "./api.ts";

/** Provider and model of the default route, or undefined when the assistant is off. */
export function useAssistantLabel(): string | undefined {
  const { t } = useTranslation();
  const llm = useLlm().data;
  if (!llm?.provider || !llm.model) return undefined;
  // "google/gemma-4-12b" → "gemma-4-12b": the publisher adds nothing here.
  return `${t(`llm.provider.${llm.provider}`)} · ${llm.model.split("/").pop()}`;
}

/** A small line naming the assistant; links to its settings. */
export function AssistantLabel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = useAssistantLabel();
  return (
    <Link
      to="/settings"
      title={t("llm.title")}
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Sparkles className="size-4 shrink-0" />
      <span className="truncate">{label ?? t("llm.off")}</span>
    </Link>
  );
}

// Which AI answers: "LM Studio · gemma-4-12b" — in the tutor, under explanations, in the sidebar.
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip.tsx";
import { cn } from "@/ui/utils.ts";
import { useLlm } from "./setup-api.ts";

/** "google/gemma-4-12b" → "gemma-4-12b": the publisher adds nothing here. */
export const modelName = (model: string) => model.slice(model.lastIndexOf("/") + 1);

/** Provider and model of the default route, or undefined when the assistant is off. */
export function useAssistantLabel(): string | undefined {
  const { t } = useTranslation();
  const llm = useLlm().data;
  if (!llm?.provider || !llm.model) return undefined;
  return `${t(`llm.provider.${llm.provider}`)} · ${modelName(llm.model)}`;
}

/** A small line naming the assistant; where to change it says a hint (not a link: a lesson is not left
 *  for the settings by a tap on a label). */
export function AssistantLabel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = useAssistantLabel();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground",
            className,
          )}
        >
          <Sparkles className="size-4 shrink-0" />
          <span className="truncate">{label ?? t("llm.off")}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("llm.changeInSettings")}</TooltipContent>
    </Tooltip>
  );
}

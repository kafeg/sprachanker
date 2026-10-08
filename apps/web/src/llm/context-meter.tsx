// The tutor's context gauge: how much of the model's window the next request takes, and whether the
// start of the conversation still fits — so the learner knows when to start a new chat.
import { useTranslation } from "react-i18next";
import { Progress } from "@/ui/components/progress.tsx";
import { useCompact } from "@/ui/format.ts";
import { cn } from "@/ui/utils.ts";
import { type TutorPromptRequest, useTutorContext } from "./api.ts";

export function ContextMeter({ request, turns }: { request: TutorPromptRequest; turns: number }) {
  const { t } = useTranslation();
  const compact = useCompact();
  const usage = useTutorContext(request, turns).data;
  if (!usage) return null;
  const used = usage.tokens + usage.reply;
  const share = usage.window ? used / usage.window : 0;
  const forgetting = usage.kept < usage.total;
  const tight = forgetting || share > 0.85;
  return (
    <div className="space-y-1 px-4 pt-2" title={t("tutor.contextHint")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">
          {usage.window
            ? t("tutor.context", { used: compact(usage.tokens), window: compact(usage.window) })
            : t("tutor.contextSize", { used: compact(usage.tokens) })}
        </span>
        {usage.window && (
          <Progress
            value={Math.min(100, share * 100)}
            className={cn("h-1.5 flex-1", tight && "[&>*]:bg-wrong")}
          />
        )}
        {usage.total > 0 && (
          <span className="shrink-0">
            {t("tutor.remembers", { kept: usage.kept, total: usage.total })}
          </span>
        )}
      </div>
      {tight && <p className="text-xs text-wrong">{t("tutor.contextFull")}</p>}
    </div>
  );
}

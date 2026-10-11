// Who reads a language aloud (08; 09), named where a line is to be listened to, as the AI's model is:
// "Read by Piper · thorsten". Where to change it says a hint (not a link: a lesson is not left by a
// tap on a label); nothing reading the language says so.
import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip.tsx";
import { cn } from "@/ui/utils.ts";
import { useSpeaker } from "./speaker.ts";

export function ReadByLabel({ lang, className }: { lang: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const by = useSpeaker().readBy(lang);
  const text = !by
    ? t("speech.readByNone", { language: languageName(lang, i18n.language) })
    : by.voice
      ? t("speech.readBy", { engine: by.engine, voice: by.voice })
      : t("speech.readByEngine", { engine: by.engine });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground",
            className,
          )}
        >
          <Volume2 className="size-4 shrink-0" />
          <span className="truncate">{text}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("speech.readByHint")}</TooltipContent>
    </Tooltip>
  );
}

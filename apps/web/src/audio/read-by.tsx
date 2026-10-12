// Who reads a language aloud (08; 09), named where a line is to be listened to, as the AI's model is:
// "Read by Piper · thorsten" — a dialogue read by two voices, both: "Read by Piper · thorsten and
// eva"; a text whose people have their own voices, each of them. Where to change it says a hint (not a link: a lesson is not left by a tap on a label), shown
// on hover, on focus and on a tap; nothing reading the language says so. Nothing is named while the
// server is still asked what it reads.
import { Volume2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip.tsx";
import { cn } from "@/ui/utils.ts";
import type { Alt } from "./speak.ts";
import { useSpeaker } from "./speaker.ts";

export function ReadByLabel({
  lang,
  two = false,
  named,
  className,
}: {
  lang: string;
  /** Read by two voices of the language where there are two (a dialogue's speakers): both named —
   *  the main one and the other as its parts ask for it (`alt`), or two others (a pair: neither is
   *  the main one's). */
  two?: Alt | readonly [Alt, Alt] | false;
  /** The server's voices that read it (a text's people's), by id: all named where the server reads
   *  the language. */
  named?: readonly string[];
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const speaker = useSpeaker();
  const [open, setOpen] = useState(false);
  if (speaker.asking) return null;
  const [first, second] = Array.isArray(two) ? two : [undefined, two];
  const by = speaker.readBy(lang, first);
  const other = second ? speaker.readBy(lang, second)?.voice : undefined;
  const list = (names: string[]) =>
    new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(names);
  const voices =
    named && by && by.engine !== "device"
      ? list([...new Set(named.map(speaker.voiceName))])
      : by?.voice && other && other !== by.voice
        ? list([by.voice, other])
        : by?.voice;
  const text = !by
    ? t("speech.readByNone", { language: languageName(lang, i18n.language) })
    : voices
      ? t("speech.readBy", { engine: by.engine, voice: voices })
      : t("speech.readByEngine", { engine: by.engine });
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-start text-sm text-muted-foreground pointer-coarse:min-h-11",
            className,
          )}
        >
          <Volume2 className="size-4 shrink-0" />
          <span className="truncate">{text}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("speech.readByHint")}</TooltipContent>
    </Tooltip>
  );
}

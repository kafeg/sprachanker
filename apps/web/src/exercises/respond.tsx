// respond: a free answer (a translation, a sentence of one's own), typed or said (08: what was heard
// goes into the box, the recording kept with the answer). Without a rubric it is not scored:
// after checking, the model answer(s) of the course are shown to compare with. A translation into the
// learner's language (`answerIn: "learner"`) has its model answers in the locale item.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSpeechHost } from "@/audio/context.ts";
import { DictateButton } from "@/audio/dictate.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { ANSWER_BOX, SpecialLetters } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

export function Respond({ item, locale, answer, onAnswer, outcome }: RendererProps<"respond">) {
  const target = useTargetLang();
  const { t, i18n } = useTranslation();
  const learner = item.answerIn === "learner";
  const lang = learner ? i18n.language : target;
  const reference = [...item.reference, ...(locale?.reference ?? [])];
  const scope = useRef<HTMLDivElement>(null);
  const host = useSpeechHost();
  // Said: the words heard join what is typed; the take is kept as the spoken answer.
  const said = async (heard: string, take: Parameters<NonNullable<typeof host>["save"]>[0]) => {
    const text = answer?.text.trim() ? `${answer.text.trimEnd()} ${heard}` : heard;
    const recording = host ? await host.save(take).catch(() => undefined) : undefined;
    onAnswer({ text, ...(recording && { speech: { recording, transcript: heard } }) });
  };
  return (
    <div ref={scope} className="space-y-3">
      <div className="flex items-start gap-2">
        <Textarea
          rows={2}
          lang={lang}
          value={answer?.text ?? ""}
          disabled={!!outcome}
          placeholder={t("ex.respondPlaceholder")}
          onChange={(e) => onAnswer({ ...answer, text: e.target.value })}
          className={ANSWER_BOX}
        />
        {!outcome && lang && (
          <DictateButton lang={lang} onText={(heard, take) => void said(heard, take)} />
        )}
      </div>
      {!outcome && !learner && <SpecialLetters scope={scope} />}
      {outcome && reference.length > 0 && (
        <div className="rounded-xl bg-muted px-4 py-3">
          <p className="text-sm font-medium text-muted-foreground">
            {t("ex.reference", { count: reference.length })}
          </p>
          <ul className="mt-1 space-y-1">
            {reference.map((r) => (
              <li key={r} lang={lang} className="text-lg">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Understanding, a practice step of the lesson (04, "AI practice in courses"; 09): a short text the
// model wrote from the words known, in the language learnt. A dialogue or an announcement is heard
// first — read aloud by the profile's voice (a dialogue's two speakers by two voices where there are
// two), who reads it named, played, paused, played again as often as wanted — and answered by ear
// with the text hidden; then the text opens, its glossed words marked, and its reading questions
// follow. A text to read (a menu, a notice) is shown from the start. Answers are checked by the
// server's engine. Without a voice for the language the text is shown to read, the step saying what
// listening needs. The lesson's earlier texts are listed under it.
import { heardFirst, understandingStage } from "@sprachanker/engine";
import type { UnderstandingText } from "@sprachanker/schema";
import { Headphones, Pause, Play, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useListening } from "@/audio/listening.ts";
import { ReadByLabel } from "@/audio/read-by.tsx";
import type { Alt, SpokenPart } from "@/audio/speak.ts";
import { useSpeaker } from "@/audio/speaker.ts";
import { type Gender, nameGender, otherSpeaker } from "@/audio/voice-genders.ts";
import { languageName } from "@/i18n/index.ts";
import type { LessonSlotContext } from "@/lesson/slots.ts";
import {
  UnderstandingLines,
  UnderstandingQuestionCard,
  UnderstoodText,
  understandingScore,
} from "@/library/understanding-text.tsx";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { HistoryList } from "@/ui/history.tsx";
import { Panel, panelClass } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import {
  type Understood,
  useAnswerUnderstanding,
  useStartUnderstanding,
  useUnderstanding,
} from "./api.ts";
import { modelName } from "./assistant-label.tsx";
import { ErrorLine, StartPrompt, Thinking } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

/** A text's speakers in the order they first speak. */
const speakersOf = (text: UnderstandingText) => [
  ...new Set(text.lines.flatMap((l) => (l.speaker ? [l.speaker] : []))),
];

/** The speaker the language's other voice reads — the one whose name says the main voice does not
 *  suit them, else the second to speak — and how: a voice of their gender where their name says it
 *  (two women: another woman's voice). */
const otherOf = (
  text: UnderstandingText,
  main: Gender | undefined,
): { speaker: string; alt: Alt } | undefined => {
  const second = otherSpeaker(speakersOf(text), main);
  return second === undefined ? undefined : { speaker: second, alt: nameGender(second) ?? true };
};

/** The text as it is read aloud: a line each, one speaker by the language's other voice. */
const partsOf = (text: UnderstandingText, lang: string, main: Gender | undefined): SpokenPart[] => {
  const other = otherOf(text, main);
  return text.lines.map((l) => ({
    text: l.text,
    lang,
    ...(other && l.speaker === other.speaker && { alt: other.alt }),
  }));
};

/** The text to listen to: who reads it, play or pause, from the start, which line, how often heard. */
function Listen({ text, lang }: { text: UnderstandingText; lang: string }) {
  const { t } = useTranslation();
  const speaker = useSpeaker();
  const main = speaker.gender(lang);
  const parts = partsOf(text, lang, main);
  const listening = useListening(parts);
  const going = listening.playing || listening.at > 0;
  return (
    <div className={cn(panelClass, "space-y-3 p-4")}>
      <ReadByLabel lang={lang} two={otherOf(text, main)?.alt ?? false} />
      <div className="flex flex-wrap items-center gap-2">
        {listening.playing ? (
          <Button onClick={listening.pause}>
            <Pause /> {t("player.pause")}
          </Button>
        ) : (
          <Button onClick={listening.play}>
            <Play className="rtl:-scale-x-100" />{" "}
            {listening.at > 0 ? t("understanding.resume") : t("understanding.listen")}
          </Button>
        )}
        <Button variant="outline" disabled={!going} onClick={listening.replay}>
          <RotateCcw /> {t("understanding.replay")}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {listening.playing && speaker.waiting
            ? t("speech.starting")
            : going
              ? t("understanding.line", { n: listening.at + 1, total: parts.length })
              : listening.plays > 0 && t("understanding.heard", { count: listening.plays })}
        </span>
      </div>
    </div>
  );
}

/** The latest text: heard, answered by ear, then read with its reading questions. */
function CurrentText({
  text,
  ids,
  preparing,
  onNew,
  onDone,
  onStored,
}: {
  text: Understood;
  ids: LessonSlotContext;
  preparing: boolean;
  onNew(): void;
  onDone?(): void;
  onStored?(): Promise<void> | void;
}) {
  const { t, i18n } = useTranslation();
  const lang = useRequiredTargetLang();
  const when = useDateFormat("dayTime");
  const speaker = useSpeaker();
  const answer = useAnswerUnderstanding(ids.lessonKey);
  const given = (n: number) => text.answers.find((a) => a.question === n);
  const { stage, listening, reading } = understandingStage(text.result, (n) => !!given(n));
  const heard = heardFirst(text.result);
  const canHear = speaker.canRead(lang);
  // Nothing here reads it aloud: the text heard first is read instead, all its questions with it.
  const readInstead = heard && !canHear;
  // Shown once answered by ear; at once to read.
  const shown = !heard || readInstead || stage !== "listening";
  const toRead = readInstead ? [...listening, ...reading] : reading;
  const send = (n: number, value: unknown) =>
    answer.mutate(
      { ...ids, language: i18n.language, id: text.id, question: n, answer: value },
      {
        onSuccess: async (after) => {
          const done = understandingStage(after.result, (k) =>
            after.answers.some((a) => a.question === k),
          );
          // The run read again first: a last answer wrong puts going over mistakes in the plan
          // before the step is done (the lesson is not completed without it).
          await Promise.resolve(onStored?.()).catch(() => undefined);
          if (done.stage === "done") onDone?.();
        },
      },
    );
  const question = (n: number) => {
    const q = text.result.questions[n];
    return (
      q && (
        <UnderstandingQuestionCard
          key={n}
          question={q}
          id={`${text.id}-${n}`}
          given={given(n)}
          onAnswer={(value) => send(n, value)}
        />
      )
    );
  };
  const score = understandingScore(text.result, text.answers);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-xl font-bold">{text.result.title}</h2>
        <PromptButton request={() => ({ understanding: { ...ids, language: i18n.language } })} />
        <Button variant="outline" loading={preparing} disabled={preparing} onClick={onNew}>
          {preparing ? t("understanding.writing") : t("understanding.new")}
        </Button>
      </div>
      <p>
        {text.result.situation}{" "}
        <span className="text-sm text-muted-foreground">
          · {t(`understanding.kind.${text.result.kind}`)} · {when.format(text.ts)} ·{" "}
          {modelName(text.model)}
        </span>
      </p>
      {heard && canHear && <Listen text={text.result} lang={lang} />}
      {heard && !canHear && (
        <p className="text-sm text-muted-foreground">
          {t("understanding.noVoice", { language: languageName(lang, i18n.language) })}
        </p>
      )}
      {!readInstead && listening.length > 0 && (
        <section className="space-y-3">
          {!shown && <h3 className="font-semibold">{t("understanding.byEar")}</h3>}
          {listening.map(question)}
        </section>
      )}
      {shown && (
        <Panel title={t("understanding.text")}>
          <UnderstandingLines text={text.result} lang={lang} />
        </Panel>
      )}
      {shown && toRead.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold">{t("understanding.readNow")}</h3>
          {toRead.map(question)}
        </section>
      )}
      {stage === "done" && <p className="font-semibold">{t("understanding.result", score)}</p>}
      <ErrorLine error={answer.error} />
    </>
  );
}

/** Earlier texts of the lesson, newest first; one opens to be read again with its answers. */
function PastTexts({ texts }: { texts: Understood[] }) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const when = useDateFormat("dayTime");
  return (
    <HistoryList
      title={t("understanding.past")}
      items={texts}
      keyOf={(text) => text.id}
      summary={(text) => (
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate">{text.result.title}</span>
            <span className="block text-sm text-muted-foreground">
              {t("understanding.result", understandingScore(text.result, text.answers))}
            </span>
          </span>
          <span className="text-sm text-muted-foreground">{when.format(text.ts)}</span>
        </span>
      )}
      detail={(text) => (
        <UnderstoodText id={text.id} text={text.result} answers={text.answers} lang={lang} />
      )}
    />
  );
}

/** The lesson's Understanding step: the latest text (or a start), then the earlier ones; `onDone`
 *  once a text's questions are all answered, `onStored` once an answer is kept in the run. */
export function UnderstandingStep({
  onDone,
  onStored,
  ...ids
}: LessonSlotContext & { onDone?(): void; onStored?(): Promise<void> | void }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const start = useStartUnderstanding(ids.lessonKey);
  const state = useUnderstanding(ids.lessonKey, start.isPending);
  if (!llm.data?.model || !state.data) return null;
  const [current, ...past] = state.data.texts;
  // Asked from here, or still being written on the server since before this page was opened.
  const preparing = start.isPending || state.data.preparing;
  const write = () => {
    if (!preparing) start.mutate({ ...ids, language: i18n.language });
  };
  return (
    <div className="space-y-4">
      {current ? (
        <CurrentText
          key={current.id}
          text={current}
          ids={ids}
          preparing={preparing}
          onNew={write}
          onDone={onDone}
          onStored={onStored}
        />
      ) : (
        <StartPrompt
          intro={t("understanding.intro")}
          label={preparing ? t("understanding.writing") : t("understanding.start")}
          icon={Headphones}
          loading={preparing}
          onStart={write}
        />
      )}
      {preparing && (
        <Thinking
          label={t(`understanding.step.${state.data.step ?? "writing"}`)}
          className="text-sm"
        />
      )}
      <ErrorLine error={start.error} onRetry={preparing ? undefined : write} />
      <PastTexts texts={past} />
    </div>
  );
}

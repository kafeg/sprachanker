// Reading and Listening, practice steps of the lesson (04, "AI practice in courses"; 09): a short text
// the AI made on the lesson's topic, in the language learnt. Listening's text (a conversation, a
// message, a story told) is heard first — read aloud by the server's voices its people were given (a
// voice of each one's gender; the device's voices by gender where the server reads nothing), played,
// paused, played again as often as wanted — and all its questions answered by ear; then the text
// opens with its glossed words. Reading's text (a letter, a chat, a notice, a story) is shown with its
// questions. Answers are checked by the server's engine. Without a voice for the language a text to
// hear is shown to read, the step saying what listening needs. The step's earlier texts are listed
// under it.
import {
  castVoices,
  type Gender,
  heardFirst,
  speakerVoices,
  understandingStage,
} from "@sprachanker/engine";
import type { UnderstandingText } from "@sprachanker/schema";
import { BookOpenText, Headphones, Pause, Play, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useListening } from "@/audio/listening.ts";
import { ReadByLabel } from "@/audio/read-by.tsx";
import type { Alt, SpokenPart } from "@/audio/speak.ts";
import { useSpeaker } from "@/audio/speaker.ts";
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
  busyMaking,
  type PracticeStep,
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

/** A number in [0, 1) drawn again and again from a seed (mulberry32): a text's voices drawn alike on
 *  every reading of it. */
function seeded(seed: string) {
  let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Speaker = ReturnType<typeof useSpeaker>;

/** The server's voice of each of a text's people where the server reads the language: those the
 *  text was given when made (with the engine it was made for, the voices still here), the others
 *  drawn now by gender and age. */
function serverVoicesOf(id: string, text: UnderstandingText, lang: string, speaker: Speaker) {
  const here = speaker.serverVoices(lang);
  if (!here?.voices.length || !text.people?.length) return {};
  const kept = Object.fromEntries(
    Object.entries(text.voices?.engine === here.engine ? text.voices.by : {}).filter(([, v]) =>
      here.voices.includes(v),
    ),
  );
  const left = text.people.filter((p) => !kept[p.name]);
  const cast = castVoices(here.engine, left, here.voices, seeded(id), Object.values(kept));
  return { ...kept, ...cast };
}

/** The text as it is read aloud: a line each, by its speaker's server voice — or, read by the
 *  device, another voice of their gender (their own where the text has its people, else where their
 *  name says it: voice-genders' `speakerVoices`). */
const partsOf = (
  text: UnderstandingText,
  lang: string,
  main: Gender | undefined,
  voices: Record<string, string>,
): SpokenPart[] => {
  const genders = new Map(text.people?.map((p) => [p.name, p.gender]));
  const alts = speakerVoices(
    speakersOf(text),
    main,
    genders.size ? (name) => genders.get(name) : undefined,
  );
  return text.lines.map((l) => {
    const alt = l.speaker === undefined ? undefined : alts[l.speaker];
    const voice = l.speaker === undefined ? undefined : voices[l.speaker];
    return { text: l.text, lang, ...(alt !== undefined && { alt }), ...(voice && { voice }) };
  });
};

/** Which voices the label names: the main one and another, or two others (neither is the main's). */
const twoOf = (parts: SpokenPart[]): Alt | [Alt, Alt] | false => {
  const alts = [...new Set(parts.flatMap((p) => (p.alt === undefined ? [] : [p.alt])))];
  return alts.length >= 2 ? [alts[0] as Alt, alts[1] as Alt] : (alts[0] ?? false);
};

/** The text to listen to: who reads it, play or pause, from the start, which line, how often heard. */
function Listen({ id, text, lang }: { id: string; text: UnderstandingText; lang: string }) {
  const { t } = useTranslation();
  const speaker = useSpeaker();
  const main = speaker.gender(lang);
  const voices = serverVoicesOf(id, text, lang, speaker);
  const parts = partsOf(text, lang, main, voices);
  const listening = useListening(parts);
  const going = listening.playing || listening.at > 0;
  const named = [...new Set(Object.values(voices))];
  return (
    <div className={cn(panelClass, "space-y-3 p-4")}>
      <ReadByLabel lang={lang} two={twoOf(parts)} named={named.length ? named : undefined} />
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
  step,
  text,
  ids,
  preparing,
  onNew,
  onDone,
  onStored,
}: {
  step: PracticeStep;
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
  const answer = useAnswerUnderstanding(ids.lessonKey, step);
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
        <PromptButton
          request={() => ({ understanding: { ...ids, language: i18n.language, step } })}
        />
        <Button variant="outline" loading={preparing} disabled={preparing} onClick={onNew}>
          {preparing ? t("understanding.writing") : t("understanding.new")}
        </Button>
      </div>
      <p>
        {text.result.situation}{" "}
        <span className="text-sm text-muted-foreground">
          {/* A text before the two steps says what it was; a step's own needs no word. */}
          {!text.result.step && <>· {t(`understanding.kind.${text.result.kind}`)} </>}·{" "}
          {when.format(text.ts)} · {modelName(text.model)}
        </span>
      </p>
      {heard && canHear && <Listen id={text.id} text={text.result} lang={lang} />}
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

/** The lesson's Reading or Listening step: the latest text (or a start; made ahead as the lesson
 *  started, it is there or on its way), then the earlier ones; `onDone` once a text's questions are
 *  all answered, `onStored` once an answer is kept in the run. */
export function UnderstandingStep({
  step,
  onDone,
  onStored,
  ...ids
}: LessonSlotContext & {
  step: PracticeStep;
  onDone?(): void;
  onStored?(): Promise<void> | void;
}) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const start = useStartUnderstanding(ids.lessonKey, step);
  const state = useUnderstanding(ids.lessonKey, step, start.isPending);
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
          step={step}
          text={current}
          ids={ids}
          preparing={preparing}
          onNew={write}
          onDone={onDone}
          onStored={onStored}
        />
      ) : (
        <StartPrompt
          intro={t(
            step === "reading" ? "understanding.introReading" : "understanding.introListening",
          )}
          label={preparing ? t("understanding.writing") : t("understanding.start")}
          icon={step === "reading" ? BookOpenText : Headphones}
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
      <ErrorLine
        error={busyMaking(start.error) ? null : start.error}
        onRetry={preparing ? undefined : write}
      />
      <PastTexts texts={past} />
    </div>
  );
}

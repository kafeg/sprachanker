// Reading and Listening, practice steps of the lesson, done as an
// exercise is: what the text is (a letter, a voice message — nothing of what it says) and the task;
// Listening's recording in the course's player (made by the server from its lines, each person by the
// voice they were given: their gender; on the device, voices by gender, where the server reads
// nothing), Reading's text; the questions answered, then Check in the step bar. Checked, each question
// shows its outcome and what the text was about opens — its title and situation in the learner's
// language, Listening's text with its glossed words —, and the score. Without a voice for the language a
// text to hear is shown to read, the step saying what listening needs. The step's earlier texts are
// listed under it.
import {
  answerComplete,
  type Gender,
  heardFirst,
  speakerVoices,
  textVoices,
  understandingExercise,
} from "@sprachanker/engine";
import type { UnderstandingText } from "@sprachanker/schema";
import { BookOpenText, Headphones, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListening } from "@/audio/listening.ts";
import { ReadByLabel } from "@/audio/read-by.tsx";
import type { Alt, SpokenPart } from "@/audio/speak.ts";
import { useSpeaker } from "@/audio/speaker.ts";
import { languageName } from "@/i18n/index.ts";
import type { LessonSlotContext, PracticePrimary } from "@/lesson/slots.ts";
import {
  UnderstandingLines,
  UnderstandingQuestionCard,
  UnderstoodText,
  understandingScore,
} from "@/library/understanding-text.tsx";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { HistoryList } from "@/ui/history.tsx";
import { AudioPlayer } from "@/ui/media.tsx";
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
  useUnderstandingAudio,
} from "./api.ts";
import { modelName } from "./assistant-label.tsx";
import { ErrorLine, StartPrompt, Thinking } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

/** A text's speakers in the order they first speak. */
const speakersOf = (text: UnderstandingText) => [
  ...new Set(text.lines.flatMap((l) => (l.speaker ? [l.speaker] : []))),
];

type Speaker = ReturnType<typeof useSpeaker>;

/** The server's voice of each of a text's people where the server reads the language (engine
 *  `textVoices`: the server's recording reads it alike). */
const serverVoicesOf = (id: string, text: UnderstandingText, lang: string, speaker: Speaker) =>
  textVoices(id, text.people ?? [], text.voices, speaker.serverVoices(lang));

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

/** The text heard on this device (the server reads nothing of the language): who reads it, play or
 *  pause, from the start, which line, how often heard. */
function DeviceListen({ id, text, lang }: { id: string; text: UnderstandingText; lang: string }) {
  const { t } = useTranslation();
  const speaker = useSpeaker();
  const main = speaker.gender(lang);
  const parts = partsOf(text, lang, main, serverVoicesOf(id, text, lang, speaker));
  const listening = useListening(parts);
  const going = listening.playing || listening.at > 0;
  return (
    <div className={cn(panelClass, "space-y-3 p-4")}>
      <ReadByLabel lang={lang} two={twoOf(parts)} />
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

/** The text to listen to: the server's recording of it (its people's voices) in the course's player —
 *  its timeline, "back 5 s", the speed —, who reads it named; read on this device where the server
 *  reads nothing of the language. */
function Listen({
  id,
  text,
  lessonKey,
}: {
  id: string;
  text: UnderstandingText;
  lessonKey: LessonSlotContext["lessonKey"];
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const speaker = useSpeaker();
  const onServer = !!speaker.serverVoices(lang);
  const audio = useUnderstandingAudio(lessonKey, id, onServer);
  if (!onServer) return <DeviceListen id={id} text={text} lang={lang} />;
  const named = [...new Set(Object.values(serverVoicesOf(id, text, lang, speaker)))];
  return (
    <div className="space-y-2">
      <ReadByLabel lang={lang} named={named.length ? named : undefined} />
      {audio.data ? (
        <AudioPlayer src={audio.data} label={t("understanding.recording")} />
      ) : audio.error ? (
        <ErrorLine error={audio.error} onRetry={() => void audio.refetch()} />
      ) : (
        <Thinking label={t("understanding.preparingAudio")} className="text-sm" />
      )}
    </div>
  );
}

/** The latest text, as an exercise is done: what it is and the task, the recording to hear (Listening)
 *  or the text to read (Reading), its questions answered — then Check, in the step bar. Checked, each
 *  question shows its outcome, and what the text was about opens: its title and situation, Listening's
 *  text with its glossed words, the score. */
function CurrentText({
  step,
  text,
  ids,
  preparing,
  onNew,
  onDone,
  onStored,
  setPrimary,
}: {
  step: PracticeStep;
  text: Understood;
  ids: LessonSlotContext;
  preparing: boolean;
  onNew(): void;
  onDone?(): void;
  onStored?(): Promise<void> | void;
  setPrimary?(primary: PracticePrimary | null): void;
}) {
  const { t, i18n } = useTranslation();
  const lang = useRequiredTargetLang();
  const when = useDateFormat("dayTime");
  const speaker = useSpeaker();
  const answer = useAnswerUnderstanding(ids.lessonKey, step);
  const [drafts, setDrafts] = useState<Record<number, unknown>>({});
  const [sending, setSending] = useState(false);
  const r = text.result;
  const given = (n: number) => text.answers.find((a) => a.question === n);
  const open = r.questions.flatMap((_, n) => (given(n) ? [] : [n]));
  const checked = open.length === 0;
  const done = r.questions.filter(
    (q, n) => given(n) || answerComplete(understandingExercise(q), 0, drafts[n]),
  ).length;
  const heard = heardFirst(r);
  const canHear = speaker.canRead(lang);
  // Nothing here reads it aloud: the text heard first is read instead.
  const readInstead = heard && !canHear;
  // The text above the questions: a text to read, or one nothing here reads aloud; a text heard opens
  // under them once checked.
  const textAbove = !heard || readInstead;
  const check = async () => {
    setSending(true);
    try {
      for (const n of open)
        await answer.mutateAsync({
          ...ids,
          language: i18n.language,
          id: text.id,
          question: n,
          answer: drafts[n],
        });
      // The run read again first: the step's mark follows its answers.
      await Promise.resolve(onStored?.()).catch(() => undefined);
      onDone?.();
    } catch {
      // The error is said under the questions; Check again sends what is left.
    } finally {
      setSending(false);
    }
  };
  const checkRef = useRef(check);
  checkRef.current = check;
  const ready = done === r.questions.length && !sending;
  useEffect(() => {
    if (!setPrimary) return;
    setPrimary(
      checked
        ? null
        : {
            label: t("lesson.check"),
            disabled: !ready,
            note:
              done < r.questions.length
                ? t("lesson.answerAll", { done, total: r.questions.length })
                : undefined,
            run: () => void checkRef.current(),
          },
    );
  }, [setPrimary, checked, ready, done, r.questions.length, t]);
  useEffect(() => () => setPrimary?.(null), [setPrimary]);
  const score = understandingScore(r, text.answers);
  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        <div className="me-auto min-w-0 space-y-1">
          {/* What it is, nothing of what it says: the title and situation come once it is checked
              (a text before the two steps has no setting: its situation, as it had). */}
          <p className="text-lg font-semibold">{r.setting ?? (checked ? r.title : r.situation)}</p>
          <p className="text-muted-foreground">
            {t(step === "reading" ? "understanding.task.reading" : "understanding.task.listening")}
          </p>
        </div>
        <PromptButton
          request={() => ({ understanding: { ...ids, language: i18n.language, step } })}
        />
        <Button variant="outline" loading={preparing} disabled={preparing} onClick={onNew}>
          {preparing ? t("understanding.writing") : t("understanding.new")}
        </Button>
      </div>
      {heard && canHear && <Listen id={text.id} text={r} lessonKey={ids.lessonKey} />}
      {readInstead && (
        <p className="text-sm text-muted-foreground">
          {t("understanding.noVoice", { language: languageName(lang, i18n.language) })}
        </p>
      )}
      {textAbove && (
        <Panel title={t("understanding.text")}>
          <UnderstandingLines text={r} lang={lang} />
        </Panel>
      )}
      <section className="space-y-3">
        {r.questions.map((q, n) => (
          <UnderstandingQuestionCard
            // biome-ignore lint/suspicious/noArrayIndexKey: a text's questions, fixed order
            key={n}
            question={q}
            id={`${text.id}-${n}`}
            given={given(n)}
            draft={drafts[n]}
            onDraft={sending ? undefined : (a) => setDrafts((d) => ({ ...d, [n]: a }))}
          />
        ))}
      </section>
      <ErrorLine error={answer.error} />
      {checked && (
        <section className="space-y-3">
          <p className="font-semibold">{t("understanding.result", score)}</p>
          <div>
            <h3 className="text-lg font-bold">{r.title}</h3>
            <p>
              {r.situation}{" "}
              <span className="text-sm text-muted-foreground">
                {!r.step && <>· {t(`understanding.kind.${r.kind}`)} </>}· {when.format(text.ts)} ·{" "}
                {modelName(text.model)}
              </span>
            </p>
          </div>
          {!textAbove && (
            <Panel title={t("understanding.text")}>
              <UnderstandingLines text={r} lang={lang} />
            </Panel>
          )}
        </section>
      )}
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
  setPrimary,
  ...ids
}: LessonSlotContext & {
  step: PracticeStep;
  onDone?(): void;
  onStored?(): Promise<void> | void;
  /** The step bar's main button while the questions wait for Check. */
  setPrimary?(primary: PracticePrimary | null): void;
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
          setPrimary={setPrimary}
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

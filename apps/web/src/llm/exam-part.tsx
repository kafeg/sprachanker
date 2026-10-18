// An exam's speaking part said through from its script (owner, 2026-10-12: as the real part runs —
// no live partner, no wait for the model between lines): "Begin the part" has the script written once
// from the Teil's cards; the examiner's and the partner's lines show and are read aloud by voices of
// their gender as they come, up to the learner's next place; the learner says it (its hint shown in
// practice, never in a mock exam) and keeps it, the next lines coming. Once every place is said the
// part is the answer: practice sends it with Check in the step bar, a mock exam as it is. Answered,
// each line said is shown with the script's good line under it; a line typed (nothing could hear
// it) is marked typed. The Teil's time (owner, 2026-10-18) runs while it is the learner's turn — not
// while the others' lines are read, nor while a take is heard — and is shown; in a mock exam the
// examiner ends the part when it is over (what is being said taken as it is), in practice it is
// only said. The router provides it to the exam run (exams/slots.ts); without an assistant the part
// is answered aloud as any open answer.
import type { ExamPart, RespondAnswer, SaidLine } from "@sprachanker/schema";
import { Keyboard, Mic, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SpokenPart } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { useSpeaker } from "@/audio/speaker.ts";
import type { ConversationContext } from "@/exams/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { clock } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useExamPart } from "./api.ts";
import { DialogueLine, type LineState } from "./dialogue-line.tsx";
import { ErrorLine, StartPrompt, Thinking } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

/** A place for the learner to talk at length (a monologue, a presentation): a take as long as the
 *  Teil's time (3 minutes where it has none). */
const LONG_LINE = 120;
const LONG_MS = 180_000;

/** The time each part has used, by its script: kept while the page is open (a mock exam's part left
 *  and opened again goes on with its time). */
const used = new Map<string, number>();

/** The part's answer: the lines said, a line each, with their takes (typed ones marked); ended by
 *  the examiner when its time ran out. */
const answerOf = (said: SaidLine[], timeUp: boolean): RespondAnswer => ({
  text: said.map((s) => s.transcript.trim()).join("\n"),
  lines: said,
  ...(timeUp && { timeUp: true }),
});

export function ExamPartView({
  runId,
  itemKey,
  events,
  onStored,
  onSaid,
  hints,
  said,
  checked,
  seconds,
  timed,
}: ConversationContext) {
  const { t, i18n } = useTranslation();
  const make = useExamPart();
  const request = { runId, itemKey, language: i18n.language };
  const script = events.findLast(
    (e) => e.type === "llm_verdict" && e.payload.task === "exam_part" && e.itemKey === itemKey,
  );
  const part =
    script?.type === "llm_verdict" && script.payload.task === "exam_part"
      ? script.payload.result
      : undefined;
  const begin = () =>
    make.mutate(request, { onSuccess: ({ event }) => event && onStored([event as never]) });
  if (!part)
    return (
      <div className="space-y-3">
        <StartPrompt
          intro={t("exams.conversation.intro")}
          label={t("exams.conversation.start")}
          icon={Mic}
          loading={make.isPending}
          onStart={begin}
        />
        {make.isPending && <Thinking label={t("talk.step.writing")} className="text-sm" />}
        <ErrorLine error={make.error} onRetry={begin} />
      </div>
    );
  return (
    <Said
      key={script?.id}
      part={part}
      id={script?.id ?? itemKey}
      hints={hints}
      initial={said}
      checked={checked}
      onSaid={onSaid}
      prompt={request}
      {...(seconds ? { seconds } : {})}
      timed={!!timed}
    />
  );
}

function Said({
  part,
  id,
  hints,
  initial,
  checked,
  onSaid,
  prompt,
  seconds,
  timed,
}: {
  part: ExamPart;
  id: string;
  hints: boolean;
  /** What was said already (the answer given, a draft): shown again as it was. */
  initial?: RespondAnswer;
  checked: boolean;
  onSaid(answer: RespondAnswer | undefined): void;
  prompt: { runId: string; itemKey: string; language: string };
  /** The Teil's time. */
  seconds?: number;
  /** The examiner ends the part when its time is over (a mock exam). */
  timed: boolean;
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const speaker = useSpeaker();
  const engine = speaker.serverVoices(lang)?.engine;
  const places = part.lines.flatMap((l, n) => (l.speaker === "learner" ? [n] : []));
  // What was said: as it was (an answer given, a draft), then as it is said now.
  const [said, setSaid] = useState<SaidLine[]>(() => initial?.lines ?? []);
  // What was said as it is this moment (a line kept in the same moment the time ran out).
  const saidNow = useRef(said);
  saidNow.current = said;
  // Ended by the examiner, its time over (a mock exam's): no place more.
  const [ended, setEnded] = useState(!!initial?.timeUp);
  const done = checked;
  const next = done || ended ? undefined : places[said.length];
  // The lines shown: up to the learner's next place (all of them once every place is said); a part
  // ended there, then its closing line (the script's last, where it is the examiner's).
  const cut = ended ? places[said.length] : undefined;
  const closing = part.lines.length - 1;
  const shown = part.lines.flatMap((l, n) =>
    n < (cut ?? next ?? part.lines.length) ||
    (cut !== undefined && n === closing && l.speaker === "examiner")
      ? [n]
      : [],
  );
  const voiceOf = (speaker: "examiner" | "partner"): SpokenPart["voice"] =>
    part.voices && part.voices.engine === engine ? part.voices[speaker] : undefined;
  const spoken = (line: ExamPart["lines"][number]): SpokenPart => {
    const who = line.speaker === "partner" ? "partner" : "examiner";
    const gender = who === "partner" ? part.partner?.gender : part.examiner.gender;
    const voice = voiceOf(who);
    return { text: line.text, lang, ...(gender && { alt: gender }), ...(voice && { voice }) };
  };
  // The newest lines read aloud as they come (the opening once the part begins: a tap began it);
  // those shown when the page came back are not read again. While they are read, the learner's time
  // does not run.
  const heard = useRef(said.length || ended ? (shown.at(-1) ?? -1) : -1);
  const [reading, setReading] = useState(false);
  /** The latest reading: one cut short by the next does not end the next's. */
  const readingNow = useRef(0);
  useEffect(() => {
    if (done) return;
    const last = shown.at(-1) ?? -1;
    if (last <= heard.current) return;
    const lines = shown
      .filter((n) => n > heard.current)
      .map((n) => part.lines[n] as ExamPart["lines"][number])
      .filter((l) => l.speaker !== "learner");
    heard.current = last;
    if (!lines.length) return;
    setReading(true);
    const n = ++readingNow.current;
    void speaker
      .say(`${id}-${last}`, lines.map(spoken))
      .finally(() => n === readingNow.current && setReading(false));
  });

  // The Teil's time: it runs at the learner's turn, but while a take is heard.
  const limit = seconds ? seconds * 1000 : undefined;
  const [spent, setSpent] = useState(() => used.get(id) ?? 0);
  const [line, setLine] = useState<LineState>("idle");
  const running = limit !== undefined && next !== undefined && !reading && line !== "hearing";
  useEffect(() => {
    if (!running) return;
    let last = Date.now();
    const add = () => {
      const now = Date.now();
      const by = now - last;
      last = now;
      setSpent((s) => {
        used.set(id, s + by);
        return s + by;
      });
    };
    const tick = setInterval(add, 250);
    return () => {
      clearInterval(tick);
      add();
    };
  }, [running, id]);
  const left = limit === undefined ? undefined : Math.max(0, limit - spent);
  const over = left === 0;
  // Over in a mock exam: what is being said is taken as it is, then the examiner ends the part.
  const ending = timed && over && next !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once the line is taken
  useEffect(() => {
    if (!ending || line !== "idle") return;
    setEnded(true);
    onSaid(answerOf(saidNow.current, true));
  }, [ending, line]);

  const name = (speaker: string) =>
    speaker === "partner"
      ? (part.partner?.name ?? t("exams.conversation.partner"))
      : t("exams.conversation.examiner");
  const nextLine = next === undefined ? undefined : part.lines[next];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {left !== undefined && !done ? (
          <p
            role="timer"
            className={cn(
              "flex items-center gap-1.5 text-sm tabular-nums",
              over ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            <Timer className="size-4 shrink-0" />
            {over
              ? timed
                ? t("exams.conversation.ended")
                : t("exams.conversation.overPractice")
              : t("exams.conversation.left", { time: clock(Math.ceil(left / 1000)) })}
          </p>
        ) : (
          <span />
        )}
        <PromptButton request={{ conversation: prompt }} />
      </div>
      <ol className="space-y-3">
        {shown.map((n) => {
          const l = part.lines[n] as ExamPart["lines"][number];
          const mine = l.speaker === "learner";
          const place = places.indexOf(n);
          const said_ = mine ? said[place] : undefined;
          return (
            <li key={n} className={cn("flex", mine && "justify-end")}>
              <div
                className={cn(
                  "max-w-[85%] space-y-1 rounded-2xl px-4 py-2",
                  mine ? "bg-primary/15" : l.speaker === "partner" ? "bg-accent" : "bg-muted",
                )}
              >
                {mine ? (
                  <>
                    {hints && l.hint && <p className="text-sm text-muted-foreground">{l.hint}</p>}
                    <p {...inLang(lang)} className="text-lg">
                      {said_?.transcript}
                    </p>
                    {said_?.typed && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Keyboard className="size-3.5" /> {t("exams.conversation.typed")}
                      </p>
                    )}
                    {done && (
                      <p className="text-sm text-muted-foreground">
                        {t("talk.model")}:{" "}
                        <span {...inLang(lang)} className="text-foreground">
                          {l.text}
                        </span>
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex items-start gap-2">
                    <p {...inLang(lang)} className="text-lg">
                      <span className="text-sm font-semibold text-muted-foreground">
                        {name(l.speaker)}:{" "}
                      </span>
                      {l.text}
                    </p>
                    <SpeakButton parts={[spoken(l)]} label={l.text} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {nextLine && (
        <Panel className="space-y-2 p-0">
          <p className="px-4 pt-3 font-medium">
            {t("talk.yourTurn")}
            {hints && nextLine.hint && <span className="font-normal">: {nextLine.hint}</span>}
          </p>
          <DialogueLine
            lang={lang}
            busy={false}
            sendLabel={t("talk.keep")}
            {...(nextLine.text.length > LONG_LINE && { maxMs: limit ?? LONG_MS })}
            onState={setLine}
            keepAtOnce={ending}
            onSend={(heard, sent) => {
              const now: SaidLine[] = [
                ...said,
                {
                  transcript: heard.text,
                  ...(heard.recording && { recording: heard.recording }),
                  ...(!heard.spoken && { typed: true as const }),
                },
              ];
              setSaid(now);
              // Every place said: the part is the answer (practice: sent with Check).
              if (now.length === places.length) onSaid(answerOf(now, false));
              sent();
            }}
          />
        </Panel>
      )}
      {!done && !ended && said.length > 0 && (
        <Button
          variant="outline"
          onClick={() => {
            heard.current = -1;
            setSaid([]);
            // Practice begins its time again; a mock exam's goes on.
            if (!timed) {
              used.delete(id);
              setSpent(0);
            }
            onSaid(undefined);
          }}
        >
          {t("talk.restart")}
        </Button>
      )}
    </div>
  );
}

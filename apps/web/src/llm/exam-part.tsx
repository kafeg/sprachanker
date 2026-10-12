// An exam's speaking part said through from its script (owner, 2026-10-12: as the real part runs —
// no live partner, no wait for the model between lines): "Begin the part" has the script written once
// from the Teil's cards; the examiner's and the partner's lines show and are read aloud by voices of
// their gender as they come, up to the learner's next place; the learner says it (its hint shown in
// practice, never in a mock exam) and keeps it, the next lines coming. Once every place is said the
// part is the answer: practice sends it with Check in the step bar, a mock exam as it is. Answered,
// each line said is shown with the script's good line under it. The router provides it to the exam
// run (exams/slots.ts); without an assistant the part is answered aloud as any open answer.
import type { ExamPart, RespondAnswer } from "@sprachanker/schema";
import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SpokenPart } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { useSpeaker } from "@/audio/speaker.ts";
import type { ConversationContext } from "@/exams/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { Panel } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useExamPart } from "./api.ts";
import { DialogueLine } from "./dialogue-line.tsx";
import { ErrorLine, StartPrompt, Thinking } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

/** A learner's line said: as heard (or typed), with its take. */
type Said = { transcript: string; recording?: string };

/** A place for the learner to talk at length (a monologue, a presentation): a longer take. */
const LONG_LINE = 160;
const LONG_MS = 180_000;

/** The part's answer: the lines said, a line each, with their takes. */
const answerOf = (said: Said[]): RespondAnswer => ({
  text: said.map((s) => s.transcript.trim()).join("\n"),
  lines: said.map((s) => ({
    transcript: s.transcript,
    ...(s.recording && { recording: s.recording }),
  })),
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
}: {
  part: ExamPart;
  id: string;
  hints: boolean;
  /** What was said already (the answer given, a draft): shown again as it was. */
  initial?: RespondAnswer;
  checked: boolean;
  onSaid(answer: RespondAnswer | undefined): void;
  prompt: { runId: string; itemKey: string; language: string };
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const speaker = useSpeaker();
  const engine = speaker.serverVoices(lang)?.engine;
  const places = part.lines.flatMap((l, n) => (l.speaker === "learner" ? [n] : []));
  // What was said: as it was (an answer given, a draft), then as it is said now.
  const [said, setSaid] = useState<Said[]>(() => initial?.lines ?? []);
  const done = checked;
  const next = done ? undefined : places[said.length];
  // The lines up to the learner's next place (all of them once every place is said).
  const upTo = next ?? part.lines.length;
  const voiceOf = (speaker: "examiner" | "partner"): SpokenPart["voice"] =>
    part.voices && part.voices.engine === engine ? part.voices[speaker] : undefined;
  const spoken = (line: ExamPart["lines"][number]): SpokenPart => {
    const who = line.speaker === "partner" ? "partner" : "examiner";
    const gender = who === "partner" ? part.partner?.gender : part.examiner.gender;
    const voice = voiceOf(who);
    return { text: line.text, lang, ...(gender && { alt: gender }), ...(voice && { voice }) };
  };
  // The newest lines read aloud as they come (the opening once the part begins: a tap began it);
  // those shown when the page came back are not read again.
  const heard = useRef(said.length ? upTo - 1 : -1);
  useEffect(() => {
    if (done || upTo <= heard.current + 1) return;
    const lines = part.lines.slice(heard.current + 1, upTo).filter((l) => l.speaker !== "learner");
    heard.current = upTo - 1;
    if (lines.length) void speaker.say(`${id}-${upTo}`, lines.map(spoken));
  });

  const name = (speaker: string) =>
    speaker === "partner"
      ? (part.partner?.name ?? t("exams.conversation.partner"))
      : t("exams.conversation.examiner");
  const nextLine = next === undefined ? undefined : part.lines[next];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <PromptButton request={{ conversation: prompt }} />
      </div>
      <ol className="space-y-3">
        {part.lines.slice(0, upTo).map((l, n) => {
          const mine = l.speaker === "learner";
          const place = places.indexOf(n);
          const line = mine ? said[place] : undefined;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the script's lines, fixed order
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
                      {line?.transcript}
                    </p>
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
            {...(nextLine.text.length > LONG_LINE && { maxMs: LONG_MS })}
            onSend={(heard, sent) => {
              const now = [
                ...said,
                { transcript: heard.text, ...(heard.recording && { recording: heard.recording }) },
              ];
              setSaid(now);
              // Every place said: the part is the answer (practice: sent with Check).
              if (now.length === places.length) onSaid(answerOf(now));
              sent();
            }}
          />
        </Panel>
      )}
      {!done && said.length > 0 && (
        <Button
          variant="outline"
          onClick={() => {
            heard.current = -1;
            setSaid([]);
            onSaid(undefined);
          }}
        >
          {t("talk.restart")}
        </Button>
      )}
    </div>
  );
}

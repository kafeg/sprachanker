// Speaking, a practice step of the lesson (owner, 2026-10-12): said
// aloud, checked once at the end with Check in the step bar — no waiting for the model between lines.
// A monologue: a card (what to talk about, the topic and three things to say in the language learnt,
// about how long), one take, then the check as a writing check shows it, with a model answer read
// aloud. A role-play: the situation and who the learner is; the partner's lines read aloud by their
// voice as they come, each of the learner's a hint to say it from; said line by line, then checked —
// each line whether it does what its hint asks, at most two corrections, a good way to say it. Typed
// where nothing can hear (DialogueLine says why). The kinds take turns; "New task" makes another.
import type { MonologueCard, Roleplay, RoleplayCheck, WritingCheck } from "@sprachanker/schema";
import { Check, Mic, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import type { SpokenPart } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { useSpeaker } from "@/audio/speaker.ts";
import type { LessonSlotContext, PracticePrimary } from "@/lesson/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { Panel } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import {
  busyMaking,
  type TalkAttemptVerdict,
  type TalkTaskVerdict,
  useCheckTalk,
  useStartTalk,
  useTalk,
} from "./api.ts";
import { DialogueLine } from "./dialogue-line.tsx";
import { ErrorLine, StartPrompt, Thinking } from "./parts.tsx";
import { MoreButton } from "./practice-more.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";
import { CheckResult } from "./writing.tsx";

/** What was said on a line: as heard (or typed), with its take. */
type Said = { n: number; text: string; recording?: string };

/** A monologue's take is a minute at most (a recording the recogniser takes whole). */
const MONOLOGUE_MS = 60_000;

/** The step bar's Check while what was said waits for it. */
function useCheckButton(
  setPrimary: ((p: PracticePrimary | null) => void) | undefined,
  ready: boolean,
  busy: boolean,
  run: () => void,
) {
  const { t } = useTranslation();
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    setPrimary?.(
      ready ? { label: t("lesson.check"), disabled: busy, run: () => latest.current() } : null,
    );
  }, [setPrimary, ready, busy, t]);
  useEffect(() => () => setPrimary?.(null), [setPrimary]);
}

/** A monologue: the card, one take kept until Check, then the check and the model answer. */
function Monologue({
  task,
  attempt,
  busy,
  checkOff,
  onCheck,
  setPrimary,
}: {
  task: MonologueCard;
  attempt?: TalkAttemptVerdict;
  busy: boolean;
  /** Check unavailable (no model to check with); saying stays open. */
  checkOff: boolean;
  onCheck(said: Said[]): void;
  setPrimary?(p: PracticePrimary | null): void;
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const [said, setSaid] = useState<Said>();
  useCheckButton(setPrimary, !!said && !attempt, busy || checkOff, () => said && onCheck([said]));
  return (
    <div className="space-y-4">
      <Panel className="space-y-3">
        <p className="font-semibold">{task.setting}</p>
        <p className="text-muted-foreground">{task.instruction}</p>
        <div {...inLang(lang)} className="rounded-xl border bg-card px-4 py-3">
          <p className="text-xl font-bold">{task.topic}</p>
          <ul className="mt-2 list-disc space-y-1 ps-6 text-lg">
            {task.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("talk.seconds", { seconds: task.seconds })}
        </p>
      </Panel>
      {!attempt &&
        (said ? (
          <Panel className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("speech.heard")}</p>
            <p {...inLang(lang)} className="text-lg">
              {said.text}
            </p>
            <Button variant="outline" disabled={busy} onClick={() => setSaid(undefined)}>
              {t("scene.again")}
            </Button>
          </Panel>
        ) : (
          <Panel className="p-0">
            <DialogueLine
              lang={lang}
              busy={busy}
              maxMs={MONOLOGUE_MS}
              sendLabel={t("talk.keep")}
              onSend={(line, sent) => {
                setSaid({
                  n: 0,
                  text: line.text,
                  ...(line.recording && { recording: line.recording }),
                });
                sent();
              }}
            />
          </Panel>
        ))}
      {attempt && "criteria" in attempt.result.check && (
        <Panel>
          <CheckResult
            result={attempt.result.check as WritingCheck}
            text={attempt.input}
            points={task.points}
            ts={attempt.ts}
            model={attempt.model}
          >
            <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{t("talk.modelAnswer")}</h3>
                <p {...inLang(lang)}>{task.model}</p>
              </div>
              <SpeakButton parts={[{ text: task.model, lang }]} label={t("talk.modelAnswer")} />
            </div>
          </CheckResult>
        </Panel>
      )}
    </div>
  );
}

/** A role-play's partner line (`n`) read aloud: its recording made with the course's practice, else
 *  by the partner's voice — the server's they were given where the profile reads with that engine,
 *  else another of their gender. */
const partnerPart = (
  task: Roleplay,
  n: number,
  lang: string,
  engine: string | undefined,
  series: string,
): SpokenPart => {
  const recording = task.recordings?.[String(n)];
  return {
    text: task.lines[n]?.text ?? "",
    lang,
    alt: task.partner.gender,
    ...(task.voice && task.voice.engine === engine && { voice: task.voice.id }),
    ...(recording && { src: mediaUrl(series, recording) }),
  };
};

/** A role-play: the partner's lines as they come (read aloud), the learner's said from their hints,
 *  then Check; checked, each line's verdict, its corrections and a good way to say it. */
function RolePlay({
  task,
  id,
  series,
  attempt,
  busy,
  checkOff,
  onCheck,
  setPrimary,
}: {
  task: Roleplay;
  id: string;
  series: string;
  attempt?: TalkAttemptVerdict;
  busy: boolean;
  /** Check unavailable (no model to check with); saying stays open. */
  checkOff: boolean;
  onCheck(said: Said[]): void;
  setPrimary?(p: PracticePrimary | null): void;
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const speaker = useSpeaker();
  const engine = speaker.serverVoices(lang)?.engine;
  const own = task.lines.flatMap((l, n) => (l.speaker === task.learner ? [n] : []));
  const [said, setSaid] = useState<Said[]>([]);
  const shownSaid = attempt ? attempt.result.said : said;
  const next = own.find((n) => !shownSaid.some((s) => s.n === n));
  // The lines up to the learner's next one (all of them once every line is said).
  const upTo = next ?? task.lines.length;
  const check = attempt?.result.check as RoleplayCheck | undefined;
  const cue = new Map(task.cues.map((c) => [c.n, c.cue]));
  // The partner's newest lines read aloud as they come (after the learner's line, a tap away).
  const heard = useRef(-1);
  useEffect(() => {
    if (attempt || upTo <= heard.current + 1) return;
    const lines = task.lines.flatMap((l, n) =>
      n > heard.current && n < upTo && l.speaker !== task.learner ? [n] : [],
    );
    heard.current = upTo - 1;
    if (said.length && lines.length)
      void speaker.say(
        `${id}-${upTo}`,
        lines.map((n) => partnerPart(task, n, lang, engine, series)),
      );
  }, [attempt, upTo, said.length, task, id, lang, engine, speaker, series]);
  useCheckButton(setPrimary, next === undefined && !attempt, busy || checkOff, () => onCheck(said));
  return (
    <div className="space-y-4">
      <Panel className="space-y-1">
        <p className="font-semibold">{task.setting}</p>
        <p>{task.situation}</p>
        <p className="text-muted-foreground">{t("talk.yourRole", { role: task.role })}</p>
      </Panel>
      <ol className="space-y-3">
        {task.lines.slice(0, upTo).map((l, n) => {
          const mine = l.speaker === task.learner;
          const line = shownSaid.find((s) => s.n === n);
          const turn = check?.turns.find((x) => x.n === n);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a conversation's lines, fixed order
            <li key={n} className={cn("flex", mine && "justify-end")}>
              <div
                className={cn(
                  "max-w-[85%] space-y-1 rounded-2xl px-4 py-2",
                  mine ? "bg-primary/15" : "bg-muted",
                )}
              >
                {mine ? (
                  <>
                    <p className="text-sm text-muted-foreground">{cue.get(n)}</p>
                    <p {...inLang(lang)} className="text-lg">
                      {line?.text}
                    </p>
                    {turn && (
                      <div className="space-y-1 text-sm">
                        <p className="flex items-center gap-1 font-medium">
                          {turn.fits ? (
                            <Check className="size-4 text-correct" />
                          ) : (
                            <X className="size-4 text-wrong" />
                          )}
                          {turn.fits ? t("talk.fits") : t("talk.misses")}
                        </p>
                        {turn.corrections.map((c) => (
                          <p key={c.wrong}>
                            <span {...inLang(lang)} className="line-through">
                              {c.wrong}
                            </span>{" "}
                            →{" "}
                            <span {...inLang(lang)} className="font-medium">
                              {c.right}
                            </span>{" "}
                            <span className="text-muted-foreground">{c.explanation}</span>
                          </p>
                        ))}
                        <p className="text-muted-foreground">
                          {t("talk.model")}:{" "}
                          <span {...inLang(lang)} className="text-foreground">
                            {l.text}
                          </span>
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-start gap-2">
                    <p {...inLang(lang)} className="text-lg">
                      <span className="font-semibold">{l.speaker}: </span>
                      {l.text}
                    </p>
                    <SpeakButton
                      parts={[partnerPart(task, n, lang, engine, series)]}
                      label={l.text}
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {next !== undefined && !attempt && (
        <Panel className="space-y-2 p-0">
          <p className="px-4 pt-3 font-medium">
            {t("talk.yourTurn")}: <span className="font-normal">{cue.get(next)}</span>
          </p>
          <DialogueLine
            lang={lang}
            busy={busy}
            sendLabel={t("talk.keep")}
            onSend={(line, sent) => {
              setSaid((s) => [
                ...s,
                {
                  n: next,
                  text: line.text,
                  ...(line.recording && { recording: line.recording }),
                },
              ]);
              sent();
            }}
          />
        </Panel>
      )}
      {!attempt && said.length > 0 && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            heard.current = -1;
            setSaid([]);
          }}
        >
          {t("talk.restart")}
        </Button>
      )}
      {check && (
        <Panel className="space-y-1">
          <p className="font-semibold">
            {t("talk.result", {
              right: check.turns.filter((x) => x.fits).length,
              total: own.length,
            })}
          </p>
          <p>{check.feedback}</p>
        </Panel>
      )}
    </div>
  );
}

/** The lesson's Speaking step: its latest task (or a start; made ahead as the lesson started, it is
 *  there or on its way) and what was said on it, checked. */
export function TalkStep({
  onDone,
  setPrimary,
  ...ids
}: LessonSlotContext & { onDone?(): void; setPrimary?(primary: PracticePrimary | null): void }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const start = useStartTalk(ids.lessonKey);
  const state = useTalk(ids.lessonKey, start.isPending);
  const check = useCheckTalk(ids.lessonKey, onDone);
  // A task of the course's practice is there without a model; making one, and checking, need it.
  if (!state.data || (!llm.data?.model && !state.data.task)) return null;
  const { task, attempts } = state.data;
  const preparing = start.isPending || state.data.preparing;
  const checking = check.isPending || state.data.checking;
  const noModel = !llm.isPending && !llm.data?.model;
  const request = { ...ids, language: i18n.language };
  const make = (count = 1) => {
    if (!preparing && !checking) start.mutate({ ...request, count });
  };
  const attempt = task ? attempts.find((a) => a.ts > task.ts) : undefined;
  const send = (current: TalkTaskVerdict) => (said: Said[]) =>
    check.mutate({ ...request, taskId: current.id, said });
  return (
    <div className="space-y-4">
      {task ? (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <PromptButton request={() => ({ talk: request })} />
            <MoreButton
              label={t("talk.new")}
              busyLabel={t("talk.preparing")}
              preparing={preparing}
              disabled={checking}
              edition={ids.edition}
              onMake={make}
            />
          </div>
          {noModel && (
            <p className="text-sm text-muted-foreground">{t("practice.checkNeedsModel")}</p>
          )}
          {task.result.kind === "monologue" ? (
            <Monologue
              key={task.id}
              task={task.result}
              attempt={attempt}
              busy={checking || preparing}
              checkOff={noModel}
              onCheck={send(task)}
              setPrimary={setPrimary}
            />
          ) : (
            <RolePlay
              key={task.id}
              task={task.result}
              id={task.id}
              series={ids.series}
              attempt={attempt}
              busy={checking || preparing}
              checkOff={noModel}
              onCheck={send(task)}
              setPrimary={setPrimary}
            />
          )}
        </>
      ) : (
        <StartPrompt
          intro={t("talk.intro")}
          label={preparing ? t("talk.preparing") : t("talk.start")}
          icon={Mic}
          loading={preparing}
          onStart={() => make()}
        />
      )}
      {(preparing || checking) && (
        <Thinking
          label={t(`talk.step.${checking ? "checking" : (state.data.step ?? "writing")}`)}
          className="text-sm"
        />
      )}
      <ErrorLine
        error={busyMaking(start.error) ? null : (check.error ?? start.error)}
        onRetry={
          check.error ? () => check.variables && check.mutate(check.variables) : () => make()
        }
      />
    </div>
  );
}

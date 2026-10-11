// The Dialogue, a practice step of the lesson (04, "AI practice in courses"; 09): a conversation on
// the lesson's goals held by voice. The goal card, the partner's lines read aloud as they come (who
// reads them named, as the model is), the learner's lines said — each with its take, whether it was
// understood and fits, at most two corrections —, then a summary: goals met, what the partner knew,
// the key corrections with a model line. The lesson's earlier Dialogues are listed under it.
import { Check, Circle, CircleCheck, Languages, Mic, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSpeechHost } from "@/audio/context.ts";
import { ReadByLabel } from "@/audio/read-by.tsx";
import { said } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { readingId, useSpeaker } from "@/audio/speaker.ts";
import { TakeButton } from "@/audio/take-button.tsx";
import type { LessonSlotContext } from "@/lesson/slots.ts";
import { Corrections } from "@/ui/checked-text.tsx";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { HistoryList } from "@/ui/history.tsx";
import { Panel, panelClass } from "@/ui/panel.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { type SceneState, useSceneAction, useScenes } from "./api.ts";
import { DialogueLine, type DialogueLineInput } from "./dialogue-line.tsx";
import {
  ChatBubble,
  ChatHeader,
  Elapsed,
  ErrorLine,
  PendingExchange,
  StartPrompt,
  Thinking,
  useScrollToEnd,
} from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

type Turn = SceneState["turns"][number];
type Action = ReturnType<typeof useSceneAction>;
type Busy = { preparing: true } | { line: string } | { summing: true } | null;

function PartnerLine({ turn }: { turn: Turn }) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <ChatBubble from="other" say={said(turn.text, lang)}>
      <p {...inLang(lang)} className="text-lg">
        {turn.text}
      </p>
      {turn.translation &&
        (shown ? (
          <p className="text-sm text-muted-foreground">{turn.translation}</p>
        ) : (
          <button
            type="button"
            className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground underline pointer-coarse:min-h-11"
            onClick={() => setShown(true)}
          >
            <Languages className="size-3.5" /> {t("scene.translate")}
          </button>
        ))}
    </ChatBubble>
  );
}

/** Whether a line was understood, whether it fits: a mark each, in words for screen readers. */
function Judged({ ok, yes, no }: { ok: boolean | undefined; yes: string; no: string }) {
  if (ok === undefined) return null;
  const Icon = ok ? Check : X;
  return (
    <span className={cn("inline-flex items-center gap-1", ok ? "text-correct" : "text-wrong")}>
      <Icon className="size-3.5" /> {ok ? yes : no}
    </span>
  );
}

function LearnerLine({ turn }: { turn: Turn }) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const host = useSpeechHost();
  return (
    <div className="ms-auto max-w-[92%] space-y-1">
      <ChatBubble from="learner" lang={lang} className="max-w-none text-lg">
        {turn.spoken && (
          <Mic
            className="me-1.5 inline size-4 align-[-2px] opacity-70"
            aria-label={t("scene.said")}
          />
        )}
        {turn.text}
      </ChatBubble>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
        {turn.recording && host && (
          <TakeButton src={host.src(turn.recording)} label={t("speech.mine")} />
        )}
        <Judged ok={turn.understood} yes={t("scene.understood")} no={t("scene.notUnderstood")} />
        <Judged ok={turn.fits} yes={t("scene.fits")} no={t("scene.offTrack")} />
      </div>
      <Corrections corrections={turn.corrections ?? []} className="text-end" />
    </div>
  );
}

/** A Dialogue's lines in order. */
function Lines({ turns }: { turns: Turn[] }) {
  return turns.map((turn, i) =>
    turn.role === "assistant" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only
      <PartnerLine key={i} turn={turn} />
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only
      <LearnerLine key={i} turn={turn} />
    ),
  );
}

/** The situation, the partner and the goal card, the goals reached ticked off. */
function GoalCard({ scene }: { scene: SceneState }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p>{scene.setup.situation}</p>
      <p className="text-sm text-muted-foreground">
        {t("scene.partner", { partner: scene.setup.partner })}
      </p>
      <p className="text-sm font-semibold">{t("scene.goalCard")}</p>
      <ul className="space-y-1">
        {scene.setup.goals.map((g, i) => {
          const met = scene.goalsMet.includes(i);
          return (
            <li key={g} className={cn("flex items-center gap-2", met && "text-correct")}>
              {met ? (
                <CircleCheck className="size-4 shrink-0" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )}
              {g}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A Dialogue over: the goals met, what the partner knew, the key corrections each with a model
 *  line, the feedback; without a summary yet (its call failed), the way to ask again. */
function Summary({
  scene,
  summing,
  onRetry,
}: {
  scene: SceneState;
  summing: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const { summary } = scene;
  const knew = scene.setup.partnerInfo ?? [];
  return (
    <div className="space-y-3">
      <p className="font-semibold">
        {scene.goalsMet.length === scene.setup.goals.length ? t("scene.done") : t("scene.ended")}{" "}
        <span className="font-normal text-muted-foreground">
          {t("scene.goals", { met: scene.goalsMet.length, total: scene.setup.goals.length })}
        </span>
      </p>
      {knew.length > 0 && (
        <div>
          <p className="text-sm font-semibold">{t("scene.partnerKnew")}</p>
          <ul className="list-disc ps-5" {...inLang(lang)}>
            {knew.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      )}
      {summary ? (
        <>
          {summary.corrections.map((c) => (
            <div key={`${c.wrong}→${c.right}`} className="space-y-1">
              <Corrections corrections={[c]} />
              <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
                <span className="text-muted-foreground">{t("scene.model")}</span>
                <span {...inLang(lang)} className="font-medium">
                  {c.model}
                </span>
                <SpeakButton parts={said(c.model, lang)} label={c.model} />
              </p>
            </div>
          ))}
          <p>{summary.feedback}</p>
        </>
      ) : summing ? (
        <Thinking label={t("scene.summing")} className="text-sm" />
      ) : (
        onRetry && (
          <p className="text-sm">
            <span className="text-muted-foreground">{t("scene.noSummary")}</span>{" "}
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("scene.sumUp")}
            </Button>
          </p>
        )
      )}
    </div>
  );
}

/** The latest Dialogue: its goal card, the conversation and the next line (until it is over), then
 *  its summary. */
function CurrentDialogue({
  ids,
  scene,
  action,
  busy,
  onNew,
  onLine,
}: {
  ids: LessonSlotContext;
  scene: SceneState;
  action: Action;
  /** What the model is doing for the Dialogue now (asked from here or before leaving the page). */
  busy: Busy;
  onNew(): void;
  onLine(line: DialogueLineInput, sent: () => void): void;
}) {
  const lang = useTargetLang();
  const { t, i18n } = useTranslation();
  const sending = busy && "line" in busy ? busy.line : undefined;
  const starting = !!busy && "preparing" in busy;
  const summing = !!busy && "summing" in busy;
  const end = useScrollToEnd(`${scene.id}:${scene.turns.length}:${sending}:${scene.done}`);
  const request = { ...ids, language: i18n.language };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-xl font-bold">{scene.setup.title}</h2>
        <Button variant="outline" loading={starting} disabled={!!busy} onClick={onNew}>
          {starting ? (
            <>
              {t("scene.preparing")} <Elapsed />
            </>
          ) : (
            t("scene.new")
          )}
        </Button>
      </div>
      <Panel as="div">
        <GoalCard scene={scene} />
      </Panel>
      <div className={panelClass}>
        <ChatHeader>
          {!scene.done && <PromptButton request={() => ({ scene: { ...request, text: "…" } })} />}
        </ChatHeader>
        {lang && <ReadByLabel lang={lang} className="w-full border-b px-4 py-1.5" />}
        <div className="space-y-3 p-4" aria-live="polite">
          <Lines turns={scene.turns} />
          {sending !== undefined && (
            <PendingExchange question={sending} lang={lang} className="text-lg" />
          )}
        </div>
        {!scene.done && lang && (
          <>
            <DialogueLine key={scene.id} lang={lang} busy={!!busy} onSend={onLine} />
            <div className="flex justify-end px-3 pb-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => action.mutate({ end: request })}
              >
                {t("scene.end")}
              </Button>
            </div>
          </>
        )}
        {scene.done && (
          <div className="border-t p-4">
            <Summary
              scene={scene}
              summing={summing}
              onRetry={() => action.mutate({ summary: request })}
            />
          </div>
        )}
        <div ref={end} />
      </div>
    </>
  );
}

/** Earlier Dialogues of the lesson, newest first; one opens to be read again with its summary. */
function PastDialogues({ scenes }: { scenes: SceneState[] }) {
  const { t } = useTranslation();
  const when = useDateFormat("dayTime");
  return (
    <HistoryList
      title={t("scene.past")}
      items={scenes}
      keyOf={(scene) => scene.id}
      summary={(scene) => (
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate">{scene.setup.title}</span>
            <span className="block text-sm text-muted-foreground">
              {t("scene.goals", { met: scene.goalsMet.length, total: scene.setup.goals.length })}
            </span>
          </span>
          <span className="text-sm text-muted-foreground">{when.format(scene.startedAt)}</span>
        </span>
      )}
      detail={(scene) => (
        <>
          <GoalCard scene={scene} />
          <Lines turns={scene.turns} />
          <Summary scene={scene} summing={false} />
        </>
      )}
    />
  );
}

/** The lesson's Dialogue step: the latest Dialogue (or a start), then the earlier ones; `onDone`
 *  once one was started. */
export function DialogueStep({ onDone, ...ids }: LessonSlotContext & { onDone?(): void }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const lang = useTargetLang();
  const scenes = useScenes(ids.lessonKey);
  const action = useSceneAction(ids.lessonKey, onDone);
  const { say } = useSpeaker();
  if (!llm.data?.model || !scenes.data) return null;
  const [current, ...past] = scenes.data.scenes;
  const variables = action.isPending ? action.variables : undefined;
  // Asked from here, or still running on the server since before this page was opened.
  const busy: Busy = variables
    ? "turn" in variables
      ? { line: variables.turn.text }
      : "start" in variables
        ? { preparing: true }
        : { summing: true }
    : scenes.data.pending;
  const preparing = !!busy && "preparing" in busy;
  /** The partner's newest line, read aloud as it comes: the Dialogue is held by voice (08). */
  const readNewest = (scene: SceneState) => {
    const last = scene.turns.at(-1);
    const parts = last?.role === "assistant" ? said(last.text, lang) : [];
    if (parts.length) void say(readingId(parts), parts);
  };
  const request = { ...ids, language: i18n.language };
  const start = () => {
    if (!busy) action.mutate({ start: request }, { onSuccess: readNewest });
  };
  const line = (input: DialogueLineInput, sent: () => void) => {
    if (busy) return;
    action.mutate(
      { turn: { ...request, ...input } },
      {
        onSuccess: (scene) => {
          sent();
          readNewest(scene);
        },
      },
    );
  };
  return (
    <div className="space-y-4">
      {current ? (
        <CurrentDialogue
          ids={ids}
          scene={current}
          action={action}
          busy={busy}
          onNew={start}
          onLine={line}
        />
      ) : (
        <StartPrompt
          intro={t("scene.intro")}
          label={preparing ? t("scene.preparing") : t("scene.start")}
          icon={Mic}
          loading={preparing}
          onStart={start}
        />
      )}
      <ErrorLine error={action.error} />
      <PastDialogues scenes={past} />
    </div>
  );
}

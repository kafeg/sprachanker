// Scenes, a practice step of the lesson, on the step's page: a role-play on the lesson's topic. The
// partner speaks the target language (translation on demand), corrects the learner's lines and ticks
// off the scene's goals; the lesson's earlier scenes are listed under it, each readable again.
import { Circle, CircleCheck, Languages } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { said } from "@/audio/speak.ts";
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
import {
  ChatBubble,
  ChatComposer,
  ChatHeader,
  ErrorLine,
  PendingExchange,
  StartPrompt,
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

function LearnerLine({ turn }: { turn: Turn }) {
  const lang = useTargetLang();
  return (
    <div className="ms-auto max-w-[92%] space-y-1">
      <ChatBubble from="learner" lang={lang} className="max-w-none text-lg">
        {turn.text}
      </ChatBubble>
      <Corrections corrections={turn.corrections ?? []} className="text-end" />
    </div>
  );
}

/** A scene's lines in order. */
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

/** The situation, the partner and the goals, those reached ticked off. */
function Setup({ scene }: { scene: SceneState }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p>{scene.setup.situation}</p>
      <p className="text-sm text-muted-foreground">
        {t("scene.partner", { partner: scene.setup.partner })}
      </p>
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

/** The latest scene: its setup, the conversation and the line to send (until it is done). */
function CurrentScene({
  ids,
  scene,
  action,
  busy,
  onNew,
}: {
  ids: LessonSlotContext;
  scene: SceneState;
  action: Action;
  /** What the model is doing for the scene now (asked from here or before leaving the page). */
  busy: Busy;
  onNew(): void;
}) {
  const lang = useTargetLang();
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const sending = busy && "line" in busy ? busy.line : undefined;
  const starting = !!busy && "preparing" in busy;
  const end = useScrollToEnd(`${scene.id}:${scene.turns.length}:${sending}`);
  const line = { ...ids, language: i18n.language, text: text.trim() };
  const send = () => {
    if (!line.text || busy) return;
    action.mutate({ turn: line }, { onSuccess: () => setText("") });
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-xl font-bold">{scene.setup.title}</h2>
        <Button variant="outline" loading={starting} disabled={!!busy} onClick={onNew}>
          {starting ? t("scene.preparing") : t("scene.new")}
        </Button>
      </div>
      <Panel as="div">
        <Setup scene={scene} />
      </Panel>
      <div className={panelClass}>
        <ChatHeader>
          {!scene.done && (
            <PromptButton request={() => ({ scene: { ...line, text: line.text || "…" } })} />
          )}
        </ChatHeader>
        <div className="space-y-3 p-4" aria-live="polite">
          <Lines turns={scene.turns} />
          {sending !== undefined && (
            <PendingExchange question={sending} lang={lang} className="text-lg" />
          )}
          {scene.done && (
            <p className="font-semibold text-correct">
              {scene.goalsMet.length === scene.setup.goals.length
                ? t("scene.done")
                : t("scene.ended")}
            </p>
          )}
        </div>
        {!scene.done && (
          <ChatComposer
            lang={lang}
            value={text}
            onChange={setText}
            onSend={send}
            placeholder={t("scene.placeholder")}
          />
        )}
        <div ref={end} />
      </div>
    </>
  );
}

/** Earlier scenes of the lesson, newest first; one opens to be read again. */
function PastScenes({ scenes }: { scenes: SceneState[] }) {
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
          <Setup scene={scene} />
          <Lines turns={scene.turns} />
        </>
      )}
    />
  );
}

/** The lesson's scene step: the latest scene (or a start), then the earlier ones; `onDone` once a
 *  scene was started. */
export function SceneStep({ onDone, ...ids }: LessonSlotContext & { onDone?(): void }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const scenes = useScenes(ids.lessonKey);
  const action = useSceneAction(ids.lessonKey, onDone);
  if (!llm.data?.model || !scenes.data) return null;
  const [current, ...past] = scenes.data.scenes;
  // Asked from here, or still running on the server since before this page was opened.
  const busy: Busy = action.isPending
    ? action.variables && "turn" in action.variables
      ? { line: action.variables.turn.text }
      : { preparing: true }
    : scenes.data.pending;
  const preparing = !!busy && "preparing" in busy;
  const start = () => {
    if (!busy) action.mutate({ start: { ...ids, language: i18n.language } });
  };
  return (
    <div className="space-y-4">
      {current ? (
        <CurrentScene ids={ids} scene={current} action={action} busy={busy} onNew={start} />
      ) : (
        <StartPrompt
          intro={t("scene.intro")}
          label={preparing ? t("scene.preparing") : t("scene.start")}
          loading={preparing}
          onStart={start}
        />
      )}
      <ErrorLine error={action.error} />
      <PastScenes scenes={past} />
    </div>
  );
}

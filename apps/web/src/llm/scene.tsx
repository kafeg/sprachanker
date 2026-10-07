// Scenes, a practice step of the lesson, on the step's page: a role-play on the lesson's topic. The
// partner speaks the target language (translation on demand), corrects the learner's lines and ticks
// off the scene's goals; the lesson's earlier scenes are listed under it, each readable again.
import type { LessonKey } from "@sprachanker/schema";
import { ChevronDown, Circle, CircleCheck, Languages, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { type SceneState, useLlm, useSceneAction, useScenes } from "./api.ts";
import { AssistantLabel } from "./assistant-label.tsx";
import { ChatBubble, ChatComposer, Corrections, ErrorLine, useScrollToEnd } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

type Ids = { series: string; lessonKey: LessonKey; edition: string };
type Turn = SceneState["turns"][number];
type Action = ReturnType<typeof useSceneAction>;

function PartnerLine({ turn }: { turn: Turn }) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <ChatBubble from="other">
      <p lang={lang} className="text-lg">
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
    <div className="ml-auto max-w-[92%] space-y-1">
      <ChatBubble from="learner" lang={lang} className="max-w-none text-lg">
        {turn.text}
      </ChatBubble>
      <Corrections corrections={turn.corrections ?? []} className="text-right" />
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
  onNew,
}: {
  ids: Ids;
  scene: SceneState;
  action: Action;
  onNew(): void;
}) {
  const lang = useTargetLang();
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const sending = action.isPending && action.variables && "turn" in action.variables;
  const starting = action.isPending && !sending;
  const end = useScrollToEnd(`${scene.id}:${scene.turns.length}:${sending}`);
  const line = { ...ids, language: i18n.language, text: text.trim() };
  const send = () => {
    if (!line.text || action.isPending) return;
    action.mutate({ turn: line }, { onSuccess: () => setText("") });
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold">{scene.setup.title}</h2>
        <Button variant="outline" disabled={action.isPending} onClick={onNew}>
          {starting && <LoaderCircle className="size-4 animate-spin" />}
          {starting ? t("scene.preparing") : t("scene.new")}
        </Button>
      </div>
      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <Setup scene={scene} />
      </div>
      <div className="rounded-2xl border bg-card">
        <div className="flex min-h-11 items-center gap-1 border-b px-4 py-1">
          <AssistantLabel className="mr-auto" />
          {!scene.done && (
            <PromptButton request={() => ({ scene: { ...line, text: line.text || "…" } })} />
          )}
        </div>
        <div className="space-y-3 p-4" aria-live="polite">
          <Lines turns={scene.turns} />
          {sending && (
            <>
              <ChatBubble from="learner" pending lang={lang} className="text-lg">
                {text}
              </ChatBubble>
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </>
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
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<string>();
  const when = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <h3 className="mb-1 font-semibold">{t("scene.past")}</h3>
      <ul className="divide-y">
        {scenes.map((scene) => (
          <li key={scene.id}>
            <button
              type="button"
              aria-expanded={open === scene.id}
              onClick={() => setOpen(open === scene.id ? undefined : scene.id)}
              className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-accent pointer-coarse:min-h-11"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{scene.setup.title}</span>
                <span className="block text-sm text-muted-foreground">
                  {t("scene.goals", {
                    met: scene.goalsMet.length,
                    total: scene.setup.goals.length,
                  })}
                </span>
              </span>
              <span className="text-sm text-muted-foreground">{when.format(scene.startedAt)}</span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                  open === scene.id && "rotate-180",
                )}
              />
            </button>
            {open === scene.id && (
              <div className="space-y-3 pb-4">
                <Setup scene={scene} />
                <Lines turns={scene.turns} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The lesson's scene step: the latest scene (or a start), then the earlier ones; `onDone` once a
 *  scene was started. */
export function SceneStep({ onDone, ...ids }: Ids & { onDone?(): void }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const scenes = useScenes(ids.lessonKey);
  const action = useSceneAction(ids.lessonKey);
  if (!llm.data?.model || !scenes.data) return null;
  const [current, ...past] = scenes.data.scenes;
  const start = () =>
    action.mutate({ start: { ...ids, language: i18n.language } }, { onSuccess: () => onDone?.() });
  return (
    <div className="space-y-4">
      {current ? (
        <CurrentScene ids={ids} scene={current} action={action} onNew={start} />
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground">{t("scene.intro")}</p>
          <Button size="lg" disabled={action.isPending} onClick={start}>
            {action.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {action.isPending ? t("scene.preparing") : t("scene.start")}
          </Button>
        </div>
      )}
      <ErrorLine error={action.error} />
      {past.length > 0 && <PastScenes scenes={past} />}
    </div>
  );
}

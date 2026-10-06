// Scenes, a practice step of the lesson: a role-play on the lesson's topic. The partner speaks the target
// language (translation on demand), corrects the learner's lines and ticks off the scene's goals.
import type { LessonKey } from "@sprachanker/schema";
import { Circle, CircleCheck, Drama, Languages, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { type SceneState, useLlm, useScene, useSceneAction } from "./api.ts";
import { AssistantLabel, useAssistantLabel } from "./assistant-label.tsx";
import {
  ChatComposer,
  ChatSheet,
  Corrections,
  ErrorLine,
  PracticeCard,
  useScrollToEnd,
} from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

type Ids = { series: string; lessonKey: LessonKey; edition: string };
type Turn = SceneState["turns"][number];

function PartnerLine({ turn }: { turn: Turn }) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="max-w-[92%] rounded-2xl bg-muted px-4 py-2.5">
      <p lang={lang} className="text-lg">
        {turn.text}
      </p>
      {turn.translation &&
        (shown ? (
          <p className="text-sm text-muted-foreground">{turn.translation}</p>
        ) : (
          <button
            type="button"
            className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground underline"
            onClick={() => setShown(true)}
          >
            <Languages className="size-3.5" /> {t("scene.translate")}
          </button>
        ))}
    </div>
  );
}

function LearnerLine({ turn }: { turn: Turn }) {
  const lang = useTargetLang();
  return (
    <div className="ml-auto max-w-[92%] space-y-1">
      <p lang={lang} className="rounded-2xl bg-primary px-4 py-2.5 text-lg text-primary-foreground">
        {turn.text}
      </p>
      <Corrections corrections={turn.corrections ?? []} className="text-right" />
    </div>
  );
}

function SceneView({ ids, scene }: { ids: Ids; scene: SceneState }) {
  const lang = useTargetLang();
  const { t, i18n } = useTranslation();
  const action = useSceneAction(ids.lessonKey);
  const [text, setText] = useState("");
  const end = useScrollToEnd(`${scene.turns.length}:${action.isPending}`);
  const line = { ...ids, language: i18n.language, text: text.trim() };
  const send = () => {
    if (!line.text || action.isPending) return;
    action.mutate({ turn: line }, { onSuccess: () => setText("") });
  };
  return (
    <>
      <div className="space-y-2 border-b px-4 pb-3">
        <div className="flex items-center gap-1">
          <AssistantLabel className="mr-auto" />
          {!scene.done && (
            <PromptButton request={() => ({ scene: { ...line, text: line.text || "…" } })} />
          )}
        </div>
        <p className="text-sm">{scene.setup.situation}</p>
        <p className="text-sm text-muted-foreground">
          {t("scene.partner", { partner: scene.setup.partner })}
        </p>
        <ul className="space-y-0.5 text-sm">
          {scene.setup.goals.map((g, i) => {
            const met = scene.goalsMet.includes(i);
            return (
              <li key={g} className={cn("flex items-center gap-1.5", met && "text-correct")}>
                {met ? <CircleCheck className="size-4" /> : <Circle className="size-4" />} {g}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {scene.turns.map((turn, i) =>
          turn.role === "assistant" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only
            <PartnerLine key={i} turn={turn} />
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only
            <LearnerLine key={i} turn={turn} />
          ),
        )}
        {action.isPending && "turn" in (action.variables ?? {}) && (
          <>
            <p
              lang={lang}
              className="ml-auto max-w-[92%] rounded-2xl bg-primary/60 px-4 py-2.5 text-lg"
            >
              {text}
            </p>
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </>
        )}
        {scene.done && <p className="font-semibold text-correct">{t("scene.done")}</p>}
        <ErrorLine error={action.error} />
        <div ref={end} />
      </div>
      {scene.done ? (
        <div className="border-t p-3">
          <Button
            size="lg"
            className="w-full"
            disabled={action.isPending}
            onClick={() => action.mutate({ start: { ...ids, language: i18n.language } })}
          >
            {action.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {t("scene.new")}
          </Button>
        </div>
      ) : (
        <ChatComposer
          lang={lang}
          value={text}
          onChange={setText}
          onSend={send}
          placeholder={t("scene.placeholder")}
        />
      )}
    </>
  );
}

/** The scene of the lesson; `onDone` once one was started. */
export function SceneCard({ onDone, ...ids }: Ids & { onDone?(): void }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const scene = useScene(ids.lessonKey);
  const action = useSceneAction(ids.lessonKey);
  const label = useAssistantLabel();
  const [open, setOpen] = useState(false);
  if (!llm.data?.model || !scene.data) return null;
  const current = scene.data.scene;
  const start = () =>
    action.mutate(
      { start: { ...ids, language: i18n.language } },
      {
        onSuccess: () => {
          setOpen(true);
          onDone?.();
        },
      },
    );
  return (
    <PracticeCard icon={Drama} title={t("scene.title")} label={label}>
      <p>{t("scene.intro")}</p>
      <div className="flex flex-wrap gap-2">
        {current && !current.done && (
          <Button size="lg" onClick={() => setOpen(true)}>
            {t("scene.continue", { title: current.setup.title })}
          </Button>
        )}
        <Button
          size="lg"
          variant={current && !current.done ? "outline" : "default"}
          disabled={action.isPending}
          onClick={start}
        >
          {action.isPending && <LoaderCircle className="size-4 animate-spin" />}
          {action.isPending ? t("scene.preparing") : t("scene.start")}
        </Button>
        {current?.done && (
          <Button size="lg" variant="ghost" onClick={() => setOpen(true)}>
            {t("scene.showLast")}
          </Button>
        )}
      </div>
      <ErrorLine error={action.error} />
      <ChatSheet
        open={open && !!current}
        onOpenChange={setOpen}
        title={current?.setup.title ?? t("scene.title")}
      >
        {current && <SceneView ids={ids} scene={current} />}
      </ChatSheet>
    </PracticeCard>
  );
}

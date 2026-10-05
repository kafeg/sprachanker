// Scenes on the lesson summary: a role-play on the lesson's topic. The partner speaks the target
// language (translation on demand), corrects the learner's lines and ticks off the scene's goals.
import type { LessonKey } from "@sprachanker/schema";
import { Circle, CircleCheck, Drama, Languages, LoaderCircle, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { cn } from "@/ui/utils.ts";
import { type SceneState, useLlm, useScene, useSceneAction } from "./api.ts";
import { AssistantLabel } from "./assistant-label.tsx";
import { errorText } from "./errors.ts";
import { PromptButton } from "./prompt-view.tsx";

type Ids = { series: string; lessonKey: LessonKey; edition: string };
type Turn = SceneState["turns"][number];

function PartnerLine({ turn }: { turn: Turn }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="max-w-[92%] rounded-2xl bg-muted px-4 py-2.5">
      <p lang="de" className="text-lg">
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
  return (
    <div className="ml-auto max-w-[92%] space-y-1">
      <p lang="de" className="rounded-2xl bg-primary px-4 py-2.5 text-lg text-primary-foreground">
        {turn.text}
      </p>
      {turn.corrections?.map((c) => (
        <p key={c.wrong} className="text-right text-sm">
          <s className="text-wrong">{c.wrong}</s> →{" "}
          <strong className="text-correct">{c.right}</strong>
          <span className="block text-muted-foreground">{c.explanation}</span>
        </p>
      ))}
    </div>
  );
}

function SceneView({ ids, scene }: { ids: Ids; scene: SceneState }) {
  const { t, i18n } = useTranslation();
  const action = useSceneAction(ids.lessonKey);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: scrollIntoView may return a promise, which React would take for a cleanup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new lines
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [scene.turns.length, action.isPending]);
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
              lang="de"
              className="ml-auto max-w-[92%] rounded-2xl bg-primary/60 px-4 py-2.5 text-lg"
            >
              {text}
            </p>
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </>
        )}
        {scene.done && <p className="font-semibold text-correct">{t("scene.done")}</p>}
        {action.isError && <p className="text-sm text-wrong">{errorText(t, action.error)}</p>}
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
        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            lang="de"
            className="max-h-32 min-h-11 resize-none text-base"
            rows={1}
            placeholder={t("scene.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" size="icon" className="size-11" aria-label={t("tutor.send")}>
            <Send className="size-4" />
          </Button>
        </form>
      )}
    </>
  );
}

export function SceneCard(ids: Ids) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const scene = useScene(ids.lessonKey);
  const action = useSceneAction(ids.lessonKey);
  const [open, setOpen] = useState(false);
  if (!llm.data?.model || !scene.data) return null;
  const current = scene.data.scene;
  const start = () =>
    action.mutate(
      { start: { ...ids, language: i18n.language } },
      { onSuccess: () => setOpen(true) },
    );
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Drama className="size-5" />
        <h2 className="text-xl font-bold">{t("scene.title")}</h2>
      </div>
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
      {action.isError && <p className="text-sm text-wrong">{errorText(t, action.error)}</p>}
      <Sheet open={open && !!current} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
          <SheetHeader className="pb-2">
            <SheetTitle>{current?.setup.title ?? t("scene.title")}</SheetTitle>
          </SheetHeader>
          {current && <SceneView ids={ids} scene={current} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

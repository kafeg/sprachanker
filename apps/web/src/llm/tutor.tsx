// The lesson tutor: a header button and a side panel with the chat of this lesson.
import { Link } from "@tanstack/react-router";
import { MessageCircle, RotateCcw, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { cn } from "@/ui/utils.ts";
import { streamTutor, type TutorRequest, useLlm, useResetTutor, useTutorHistory } from "./api.ts";
import { AssistantLabel } from "./assistant-label.tsx";
import { ContextMeter } from "./context-meter.tsx";
import { errorText } from "./errors.ts";
import { PromptButton } from "./prompt-view.tsx";
import { RichText } from "./rich-text.tsx";

type Context = Omit<TutorRequest, "message" | "language">;

/** A message to send on opening (from outside, e.g. the lesson summary); `id` makes each ask new. */
export interface TutorAsk {
  text: string;
  id: number;
}

function Bubble({ from, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[92%] rounded-2xl px-4 py-2.5",
        from === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
      )}
    >
      {children}
    </div>
  );
}

function Chat({ ask, ...context }: Context & { ask?: TutorAsk }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const history = useTutorHistory(context.lessonKey);
  const reset = useResetTutor(context.lessonKey);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ question: string; reply: string }>();
  const [error, setError] = useState<unknown>();
  const abort = useRef<AbortController>(undefined);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const turns = history.data?.turns ?? [];
  // Braces matter: scrollIntoView may return a promise, which React would take for a cleanup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new text
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length, pending?.reply]);

  // An ask from outside is sent once, as soon as the chat is ready.
  const sendLatest = useRef<(text: string) => void>(undefined);
  const asked = useRef<number>(undefined);
  const ready = !!history.data && !!llm.data?.model;
  useEffect(() => {
    if (!ask || !ready || asked.current === ask.id) return;
    asked.current = ask.id;
    sendLatest.current?.(ask.text);
  }, [ask, ready]);

  if (!llm.data?.model)
    return (
      <div className="space-y-3 p-5">
        <p>{t("tutor.needsSetup")}</p>
        <Link to="/settings" className="font-medium underline">
          {t("tutor.openSettings")}
        </Link>
      </div>
    );

  const send = (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    const controller = new AbortController();
    abort.current = controller;
    setInput("");
    setError(undefined);
    setPending({ question, reply: "" });
    streamTutor(
      { ...context, message: question, language: i18n.language },
      (reply) => setPending({ question, reply }),
      controller.signal,
    )
      .catch((e: unknown) => {
        // A stopped reply is kept by the server; a failed question goes back into the input.
        if (controller.signal.aborted) return;
        setError(e);
        setInput(question);
      })
      .finally(async () => {
        await history.refetch();
        setPending(undefined);
      });
  };

  sendLatest.current = send;

  const suggestions = [
    t("tutor.suggest.grammar"),
    t("tutor.suggest.examples"),
    t("tutor.suggest.dialogue"),
    ...(context.exerciseKey ? [t("tutor.suggest.exercise")] : []),
  ];

  return (
    <>
      <div className="flex min-h-11 items-center gap-1 border-b px-4 pb-2">
        <AssistantLabel className="mr-auto" />
        <PromptButton
          request={() => ({
            tutor: { ...context, message: input.trim(), language: i18n.language },
          })}
        />
        {turns.length > 0 && !pending && (
          <Button variant="ghost" size="sm" onClick={() => reset.mutate()}>
            <RotateCcw className="size-4" /> {t("tutor.newChat")}
          </Button>
        )}
      </div>
      <ContextMeter
        request={{ ...context, message: "", language: i18n.language }}
        turns={turns.length}
      />
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {turns.length === 0 && !pending && (
          <div className="space-y-3 pt-2">
            <p className="text-muted-foreground">{t("tutor.intro")}</p>
            <div className="flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  className="h-auto min-h-11 whitespace-normal text-left"
                  onClick={() => send(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only
          <Bubble key={i} from={turn.role}>
            {turn.role === "user" ? (
              <p className="whitespace-pre-wrap">{turn.text}</p>
            ) : (
              <RichText text={turn.text} />
            )}
          </Bubble>
        ))}
        {pending && (
          <>
            <Bubble from="user">
              <p className="whitespace-pre-wrap">{pending.question}</p>
            </Bubble>
            <Bubble from="assistant">
              {pending.reply ? (
                <RichText text={pending.reply} />
              ) : (
                <p className="text-muted-foreground">{t("llm.thinking")}</p>
              )}
            </Bubble>
          </>
        )}
        {!!error && (
          <p className="text-sm text-wrong">
            {errorText(t, error, llm.data.provider ?? undefined)}
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          className="max-h-40 min-h-11 resize-none text-base"
          rows={1}
          placeholder={t("tutor.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {pending ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-11"
            aria-label={t("tutor.stop")}
            onClick={() => abort.current?.abort()}
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" className="size-11" aria-label={t("tutor.send")}>
            <Send className="size-4" />
          </Button>
        )}
      </form>
    </>
  );
}

export function LessonTutor({ ask, ...context }: Context & { ask?: TutorAsk }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (ask) setOpen(true);
  }, [ask]);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MessageCircle className="size-4" />{" "}
        <span className="hidden sm:inline">{t("tutor.title")}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
          <SheetHeader className="pb-2">
            <SheetTitle>{t("tutor.title")}</SheetTitle>
          </SheetHeader>
          {open && <Chat {...context} ask={ask} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** "Review my mistakes" for the lesson summary; nothing when the assistant is off. */
export function ReviewMistakesButton({ onAsk }: { onAsk(ask: TutorAsk): void }) {
  const { t } = useTranslation();
  if (!useLlm().data?.model) return null;
  return (
    <Button
      variant="outline"
      size="lg"
      onClick={() => onAsk({ text: t("tutor.reviewMistakesMessage"), id: Date.now() })}
    >
      <MessageCircle className="size-4" /> {t("tutor.reviewMistakes")}
    </Button>
  );
}

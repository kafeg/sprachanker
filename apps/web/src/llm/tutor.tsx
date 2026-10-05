// The lesson tutor: a header button and a side panel with the chat of this lesson.
import { Link } from "@tanstack/react-router";
import { MessageCircle, RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { cn } from "@/ui/utils.ts";
import { streamTutor, type TutorRequest, useLlm, useResetTutor, useTutorHistory } from "./api.ts";
import { AssistantLabel } from "./assistant-label.tsx";
import { ContextMeter } from "./context-meter.tsx";
import { ChatComposer, ChatSheet, ErrorLine, useAbortable, useScrollToEnd } from "./parts.tsx";
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

/** What the model looked up for a reply (its tool calls), in plain words. */
function ToolsUsed({ tools }: { tools: Array<{ name: string; args?: unknown }> }) {
  const { t } = useTranslation();
  const text = tools
    .map(({ name, args }) => {
      const a = (args ?? {}) as Record<string, string>;
      return t(`tutor.tool.${name}`, {
        word: a.word ?? "",
        lesson: a.lesson ?? "",
        defaultValue: name,
      });
    })
    .join(", ");
  return (
    <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
      <Search className="size-3" /> {t("tutor.toolsUsed", { tools: text })}
    </p>
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
  const request = useAbortable();
  const turns = history.data?.turns ?? [];
  const end = useScrollToEnd(`${turns.length}:${pending?.reply}`);

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
    const controller = request.start();
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
              <>
                <RichText text={turn.text} />
                {turn.tools?.length ? <ToolsUsed tools={turn.tools} /> : null}
              </>
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
        <ErrorLine error={error} provider={llm.data.provider ?? undefined} />
        <div ref={end} />
      </div>
      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        onStop={pending ? request.stop : undefined}
        placeholder={t("tutor.placeholder")}
      />
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
      <Button
        variant="outline"
        size="sm"
        aria-label={t("tutor.title")}
        onClick={() => setOpen(true)}
      >
        <MessageCircle className="size-4" />{" "}
        <span className="hidden sm:inline">{t("tutor.title")}</span>
      </Button>
      <ChatSheet open={open} onOpenChange={setOpen} title={t("tutor.title")}>
        {open && <Chat {...context} ask={ask} />}
      </ChatSheet>
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

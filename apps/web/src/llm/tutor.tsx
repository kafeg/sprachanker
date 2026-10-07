// The lesson tutor: a header button and a side panel with the chat of this lesson.
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageCircle, RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLesson } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { streamTutor, type TutorRequest, useLlm, useResetTutor, useTutorHistory } from "./api.ts";
import { AssistantLabel } from "./assistant-label.tsx";
import { ContextMeter } from "./context-meter.tsx";
import {
  ChatBubble,
  ChatComposer,
  ChatSheet,
  ErrorLine,
  useAbortable,
  useScrollToEnd,
} from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { RichText } from "./rich-text.tsx";

type Context = Omit<TutorRequest, "message" | "language" | "newChat">;

/** A message to send on opening (from outside, e.g. the lesson summary); `id` makes each ask new. */
export interface TutorAsk {
  text: string;
  id: number;
  /** Opens a new chat for it (the current one stays in the history). */
  newChat?: boolean;
}

/** A chat turn's bubble: the learner's ("user") or the tutor's. */
function Bubble({ from, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  return <ChatBubble from={from === "user" ? "learner" : "other"}>{children}</ChatBubble>;
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
  const client = useQueryClient();
  const llm = useLlm();
  const history = useTutorHistory(context.lessonKey);
  const lesson = useLesson(context.series, context.lessonKey, context.edition).data;
  const reset = useResetTutor(context.lessonKey);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ question: string; reply: string }>();
  const [error, setError] = useState<unknown>();
  const request = useAbortable();
  const turns = history.data?.turns ?? [];
  const end = useScrollToEnd(`${turns.length}:${pending?.reply}`);

  // An ask from outside is sent once, as soon as the chat is ready.
  const sendLatest = useRef<(text: string, newChat?: boolean) => void>(undefined);
  const asked = useRef<number>(undefined);
  const ready = !!history.data && !!llm.data?.model;
  useEffect(() => {
    if (!ask || !ready || asked.current === ask.id) return;
    asked.current = ask.id;
    sendLatest.current?.(ask.text, ask.newChat);
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

  const send = (text: string, newChat = false) => {
    const question = text.trim();
    if (!question || pending) return;
    const controller = request.start();
    setInput("");
    setError(undefined);
    // A new chat: the current one leaves the screen at once (the server ends it with this message).
    if (newChat) client.setQueryData(["tutor", context.lessonKey], { turns: [] });
    setPending({ question, reply: "" });
    streamTutor(
      { ...context, message: question, language: i18n.language, newChat },
      (reply) => setPending({ question, reply }),
      controller.signal,
    )
      .then((reply) => {
        // The pair as the server stored it, shown at once in place of the pending one (no frame
        // with both); the stored turns follow.
        const ts = Date.now();
        client.setQueryData(
          ["tutor", context.lessonKey],
          (old: { turns: unknown[] } | undefined) => ({
            turns: [
              ...(old?.turns ?? []),
              { role: "user", text: question, exerciseKey: context.exerciseKey, ts },
              { role: "assistant", text: reply.trim(), ts },
            ],
          }),
        );
        setPending(undefined);
      })
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

  // Ways into the lesson, offered where the lesson has the material for them.
  const words = !!lesson?.lesson.vocab.length;
  const grammar = !!lesson?.locale?.tabs.grammar.length;
  const script = !!lesson?.locale?.tabs.script;
  const suggestions = [
    ...(context.exerciseKey ? [t("tutor.suggest.exercise")] : []),
    ...(words
      ? [t("tutor.suggest.wordsQuiz"), t("tutor.suggest.wordsMemory"), t("tutor.suggest.examples")]
      : []),
    ...(grammar ? [t("tutor.suggest.grammar"), t("tutor.suggest.grammarDrill")] : []),
    ...(script ? [t("tutor.suggest.script")] : []),
    t("tutor.suggest.dialogue"),
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
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  className="h-auto min-h-11 whitespace-normal rounded-full text-left"
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
      onClick={() =>
        onAsk({ text: t("tutor.reviewMistakesMessage"), id: Date.now(), newChat: true })
      }
    >
      <MessageCircle className="size-4" /> {t("tutor.reviewMistakes")}
    </Button>
  );
}

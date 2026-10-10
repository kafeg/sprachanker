// The lesson tutor: the chat of this lesson, in a side panel opened from the header, and inline on the
// "Going over mistakes" step, which opens it with a request to go through the run's mistakes.
import { parseEditionId } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { MessageCircle, RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLesson } from "@/api/courses.ts";
import type { SpokenPart } from "@/audio/speak.ts";
import { useReadAtOnce } from "@/audio/speaker.ts";
import { Button } from "@/ui/components/button.tsx";
import { Tabs, TabsContent } from "@/ui/components/tabs.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { RichText } from "@/ui/rich-text.tsx";
import { SectionTabList } from "@/ui/section-tabs.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";
import { cn } from "@/ui/utils.ts";
import {
  streamTutor,
  type TutorRequest,
  type TutorTurn,
  useResetTutor,
  useTutorCache,
  useTutorHistory,
} from "./api.ts";
import { ContextMeter } from "./context-meter.tsx";
import {
  ChatBubble,
  ChatComposer,
  ChatHeader,
  ErrorLine,
  PendingExchange,
  replyParts,
  StartPrompt,
  useAbortable,
  useScrollToEnd,
} from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";
import { TutorHistory } from "./tutor-history.tsx";

type Context = Omit<TutorRequest, "message" | "language" | "newChat">;

/** A message to send on opening; `id` makes each ask new. */
export interface TutorAsk {
  text: string;
  id: number;
  /** Opens a new chat for it (the current one stays in the history). */
  newChat?: boolean;
}

/** A chat turn's bubble: the learner's ("user") or the tutor's (read aloud from its corner). */
function Bubble({
  from,
  say,
  children,
}: {
  from: "user" | "assistant";
  say?: SpokenPart[];
  children: React.ReactNode;
}) {
  return (
    <ChatBubble from={from === "user" ? "learner" : "other"} say={say}>
      {children}
    </ChatBubble>
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

/** What an empty chat offers in place of the suggestions: one request, sent in a new chat. */
interface Starter {
  intro: string;
  label: string;
  text: string;
}

/** The lesson's chat: its turns, the question on its way with the reply so far, and sending one
 *  (`newChat`: the current chat goes to the history). */
function useTutorChat(context: Context, onReply?: () => void) {
  const { i18n } = useTranslation();
  const history = useTutorHistory(context.lessonKey);
  const cache = useTutorCache(context.lessonKey);
  const [input, setInput] = useState("");
  /** The question on its way and the reply so far; `after`: how many turns came before it. */
  const [pending, setPending] = useState<{ question: string; reply: string; after: number }>();
  const [error, setError] = useState<unknown>();
  const request = useAbortable();
  const turns = history.data?.turns ?? [];
  // Shown until the turns hold it: never in the same frame as the stored pair.
  const shown = pending && turns.length <= pending.after ? pending : undefined;

  const send = (text: string, newChat = false) => {
    const question = text.trim();
    if (!question || pending) return;
    const controller = request.start();
    setInput("");
    setError(undefined);
    // A new chat: the current one leaves the screen at once (the server ends it with this message).
    if (newChat) cache.clear();
    const after = newChat ? 0 : turns.length;
    setPending({ question, reply: "", after });
    streamTutor(
      { ...context, message: question, language: i18n.language, newChat },
      (reply) => setPending({ question, reply, after }),
      controller.signal,
    )
      .then((reply) => {
        // The pair as the server stored it, shown at once in place of the pending one; the stored
        // turns follow.
        const ts = Date.now();
        cache.add([
          {
            role: "user",
            text: question,
            exerciseKey: context.exerciseKey as TutorTurn["exerciseKey"],
            ts,
          },
          { role: "assistant", text: reply.trim(), ts },
        ]);
        setPending(undefined);
        onReply?.();
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
  return {
    loaded: !!history.data,
    turns,
    shown,
    pending: !!pending,
    error,
    input,
    setInput,
    send,
    stop: request.stop,
  };
}

/** An empty chat's ways into the lesson, offered where the lesson has the material for them. Each is
 *  a short label on its button and a fuller request to the model: the word and phrase ones go one at
 *  a time and wait for the learner, not a list at once. */
function Suggestions({ context, onAsk }: { context: Context; onAsk(text: string): void }) {
  const { t } = useTranslation();
  const lesson = useLesson(context.series, context.lessonKey, context.edition).data;
  const words = !!lesson?.lesson.vocab.length;
  const grammar = !!lesson?.locale?.tabs.grammar.length;
  const script = !!lesson?.locale?.tabs.script;
  const suggestions = [
    ...(context.exerciseKey ? ["exercise"] : []),
    ...(words ? ["wordsQuiz", "wordsMemory", "examples"] : []),
    ...(grammar ? ["grammar", "grammarDrill"] : []),
    ...(script ? ["script"] : []),
    "dialogue",
  ];
  return (
    <div className="space-y-3 pt-2">
      <p className="text-muted-foreground">{t("tutor.intro")}</p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <Button
            key={s}
            variant="outline"
            className="h-auto min-h-11 whitespace-normal rounded-full text-left"
            onClick={() => onAsk(t(`tutor.ask.${s}`))}
          >
            {t(`tutor.suggest.${s}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The turns as bubbles: the learner's as typed, the tutor's as Markdown with what it looked up. */
function Turns({ turns, say }: { turns: TutorTurn[]; say(text: string): SpokenPart[] }) {
  return turns.map((turn, i) => (
    <Bubble
      // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only
      key={i}
      from={turn.role}
      say={turn.role === "assistant" ? say(turn.text) : undefined}
    >
      {turn.role === "user" ? (
        <p className="whitespace-pre-wrap">{turn.text}</p>
      ) : (
        <>
          <RichText text={turn.text} />
          {turn.tools?.length ? <ToolsUsed tools={turn.tools} /> : null}
        </>
      )}
    </Bubble>
  ));
}

function Chat({
  ask,
  starter,
  onReply,
  ...context
}: Context & {
  ask?: TutorAsk;
  starter?: Starter;
  /** A reply came in full. */
  onReply?(): void;
}) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const reset = useResetTutor(context.lessonKey);
  const chat = useTutorChat(context, onReply);
  const { turns, shown } = chat;
  /** A reply read aloud in the learner's language, what it quotes in the language learnt. */
  const sayReply = (text: string) =>
    replyParts(text, i18n.language, parseEditionId(context.edition).target);
  const last = turns.at(-1);
  useReadAtOnce(
    "tutor",
    chat.loaded,
    last?.role === "assistant" ? `${context.lessonKey}:${turns.length}` : undefined,
    last?.role === "assistant" ? sayReply(last.text) : [],
  );
  const end = useScrollToEnd(`${turns.length}:${shown?.reply}`);

  // An ask from outside is sent once, as soon as the chat is ready.
  const sendLatest = useRef(chat.send);
  sendLatest.current = chat.send;
  const asked = useRef<number>(undefined);
  const ready = chat.loaded && !!llm.data?.model;
  useEffect(() => {
    if (!ask || !ready || asked.current === ask.id) return;
    asked.current = ask.id;
    sendLatest.current(ask.text, ask.newChat);
  }, [ask, ready]);

  if (!llm.data?.model)
    return (
      <div className="space-y-3 p-5">
        <p>{t("tutor.needsSetup")}</p>
        <Link
          to="/settings"
          hash="ai"
          className="inline-flex items-center font-medium underline pointer-coarse:min-h-11"
        >
          {t("tutor.openSettings")}
        </Link>
      </div>
    );

  const empty = turns.length === 0 && !shown;
  return (
    <>
      <ChatHeader>
        <PromptButton
          request={() => ({
            tutor: { ...context, message: chat.input.trim(), language: i18n.language },
          })}
        />
        {turns.length > 0 && !chat.pending && (
          <Button variant="ghost" size="sm" onClick={() => reset.mutate()}>
            <RotateCcw className="size-4" /> {t("tutor.newChat")}
          </Button>
        )}
      </ChatHeader>
      <ContextMeter
        request={{ ...context, message: "", language: i18n.language }}
        turns={turns.length}
      />
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {empty && starter && chat.loaded && asked.current === ask?.id && (
          <div className="pt-2">
            <StartPrompt
              intro={starter.intro}
              label={starter.label}
              icon={MessageCircle}
              onStart={() => chat.send(starter.text, true)}
            />
          </div>
        )}
        {empty && !starter && <Suggestions context={context} onAsk={(text) => chat.send(text)} />}
        <Turns turns={turns} say={sayReply} />
        {shown && <PendingExchange question={shown.question} reply={shown.reply} />}
        <ErrorLine error={chat.error} provider={llm.data.provider ?? undefined} />
        <div ref={end} />
      </div>
      <ChatComposer
        value={chat.input}
        onChange={chat.setInput}
        onSend={() => chat.send(chat.input)}
        onStop={chat.pending ? chat.stop : undefined}
        placeholder={t("tutor.placeholder")}
        speak={[parseEditionId(context.edition).target, i18n.language]}
      />
    </>
  );
}

export function LessonTutor(context: Context) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("chat");
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={t("tutor.title")}
        onClick={() => {
          setTab("chat");
          setOpen(true);
        }}
      >
        <MessageCircle className="size-4" />{" "}
        <span className="hidden sm:inline">{t("tutor.title")}</span>
      </Button>
      <SideSheet open={open} onOpenChange={setOpen} title={t("tutor.title")}>
        {open && (
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <SectionTabList
              label={t("tutor.title")}
              value={tab}
              className="mx-4 mb-2"
              tabs={[
                { value: "chat", label: t("tutor.tabChat") },
                { value: "history", label: t("tutor.tabHistory") },
              ]}
            />
            <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
              <Chat {...context} />
            </TabsContent>
            <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <TutorHistory {...context} />
            </TabsContent>
          </Tabs>
        )}
      </SideSheet>
    </>
  );
}

/**
 * The tutor going through the run's mistakes one at a time, in the lesson's chat shown on the step page.
 * Started by the learner (a new chat); shown at once when the step is done (the walk-through goes on).
 * `onDone` after the tutor's first reply.
 */
export function MistakesTutor({
  done,
  onDone,
  ...context
}: Context & { done: boolean; onDone(): void }) {
  const { t } = useTranslation();
  const [ask, setAsk] = useState<TutorAsk>();
  const starter = {
    intro: t("mistakes.tutorIntro"),
    label: t("mistakes.start"),
    text: t("mistakes.message"),
  };
  if (!done && !ask)
    return (
      <StartPrompt
        intro={starter.intro}
        label={starter.label}
        icon={MessageCircle}
        onStart={() => setAsk({ text: starter.text, id: Date.now(), newChat: true })}
      />
    );
  return (
    <div className={cn(panelClass, "flex h-[70dvh] min-h-96 flex-col overflow-hidden pt-2")}>
      <Chat {...context} ask={ask} starter={starter} onReply={onDone} />
    </div>
  );
}

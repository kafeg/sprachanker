// The tutor's chat view, and the lesson tutor: the chat of this lesson in a side panel opened from the
// header — questions and explanations; practice is the lesson's AI steps (04). The Tutor section's
// chats (tutor-section.tsx) are shown by the same view.
import { Link } from "@tanstack/react-router";
import { MessageCircle, RotateCcw, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLesson } from "@/api/courses.ts";
import { Button } from "@/ui/components/button.tsx";
import { Tabs, TabsContent } from "@/ui/components/tabs.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { RichText } from "@/ui/rich-text.tsx";
import { SectionTabList } from "@/ui/section-tabs.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";
import { cn } from "@/ui/utils.ts";
import {
  type ContextRequest,
  type PromptRequest,
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
  useAbortable,
  useScrollToEnd,
} from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";
import { TutorHistory } from "./tutor-history.tsx";

type Context = Omit<TutorRequest, "message" | "language" | "newChat">;

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

/** What a chat is read from and sent to: its stored turns (undefined while they are read), a pair
 *  stored shown at once, a message sent with its reply streamed (`newChat`: it opens a new chat, the
 *  turns there were leaving the screen at once — `clear`). */
export interface ChatSource {
  turns: TutorTurn[] | undefined;
  refetch(): Promise<unknown>;
  add(turns: TutorTurn[]): void;
  clear?(): void;
  send(
    message: string,
    newChat: boolean,
    onText: (reply: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
  /** The exercise on screen, which the learner's turn records. */
  exerciseKey?: string;
}

/** A chat: its turns, the question on its way with the reply so far, and sending one. `onReply`: a
 *  reply came in full. */
export function useChat(source: ChatSource, onReply?: () => void) {
  const [input, setInput] = useState("");
  /** The question on its way and the reply so far; `after`: how many turns came before it. */
  const [pending, setPending] = useState<{ question: string; reply: string; after: number }>();
  const [error, setError] = useState<unknown>();
  const request = useAbortable();
  const turns = source.turns ?? [];
  // Shown until the turns hold it: never in the same frame as the stored pair.
  const shown = pending && turns.length <= pending.after ? pending : undefined;

  const send = (text: string, newChat = false) => {
    const question = text.trim();
    if (!question || pending) return;
    const controller = request.start();
    setInput("");
    setError(undefined);
    // A new chat: the current one leaves the screen at once (the server ends it with this message).
    if (newChat) source.clear?.();
    const after = newChat ? 0 : turns.length;
    setPending({ question, reply: "", after });
    source
      .send(question, newChat, (reply) => setPending({ question, reply, after }), controller.signal)
      .then((reply) => {
        // The pair as the server stored it, shown at once in place of the pending one; the stored
        // turns follow.
        const ts = Date.now();
        source.add([
          {
            role: "user",
            text: question,
            exerciseKey: source.exerciseKey as TutorTurn["exerciseKey"],
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
        await source.refetch();
        setPending(undefined);
      });
  };
  return {
    loaded: source.turns !== undefined,
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
type Chat = ReturnType<typeof useChat>;

/** The lesson's chat as the tutor's panel and the mistakes step show it. */
function useLessonSource(context: Context): ChatSource {
  const { i18n } = useTranslation();
  const history = useTutorHistory(context.lessonKey);
  const cache = useTutorCache(context.lessonKey);
  return {
    turns: history.data?.turns,
    refetch: history.refetch,
    add: cache.add,
    clear: cache.clear,
    send: (message, newChat, onText, signal) =>
      streamTutor({ ...context, message, language: i18n.language, newChat }, onText, signal),
    exerciseKey: context.exerciseKey,
  };
}

/** Ways into an empty chat: each a short label on its button and a fuller request to the model. */
export function Suggestions({
  intro,
  items,
  onAsk,
}: {
  intro: string;
  items: Array<{ key: string; label: string; text: string }>;
  onAsk(text: string): void;
}) {
  return (
    <div className="space-y-3 pt-2">
      <p className="text-muted-foreground">{intro}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((s) => (
          <Button
            key={s.key}
            variant="outline"
            className="h-auto min-h-11 whitespace-normal rounded-full text-start"
            onClick={() => onAsk(s.text)}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** An empty chat's ways into the lesson — explanations only (practice is the lesson's AI steps, 04) —,
 *  offered where the lesson has the material for them. */
function LessonSuggestions({ context, onAsk }: { context: Context; onAsk(text: string): void }) {
  const { t } = useTranslation();
  const lesson = useLesson(context.series, context.lessonKey, context.edition).data;
  const words = !!lesson?.lesson.vocab.length;
  const grammar = !!lesson?.locale?.tabs.grammar.length;
  const script = !!lesson?.locale?.tabs.script;
  const suggestions = [
    ...(context.exerciseKey ? ["exercise"] : []),
    ...(grammar ? ["grammar"] : []),
    ...(words ? ["examples"] : []),
    ...(script ? ["script"] : []),
  ];
  return (
    <Suggestions
      intro={t("tutor.intro")}
      items={suggestions.map((s) => ({
        key: s,
        label: t(`tutor.suggest.${s}`),
        text: t(`tutor.ask.${s}`),
      }))}
      onAsk={onAsk}
    />
  );
}

/** The turns as bubbles: the learner's as typed, the tutor's as Markdown with what it looked up. */
function Turns({ turns }: { turns: TutorTurn[] }) {
  return turns.map((turn, i) => (
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
  ));
}

/** Without a model the tutor says so, with the way to set one up. */
export function NeedsSetup() {
  const { t } = useTranslation();
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
}

/** A chat's view: who answers with the {} button and `actions`, how full the context is, the turns
 *  (`empty`: what an empty chat offers), the reply on its way, an error, the message box. */
export function ChatFrame({
  chat,
  prompt,
  meter,
  actions,
  empty,
}: {
  chat: Chat;
  /** The request the {} button shows. */
  prompt(): PromptRequest;
  /** The request the context gauge measures. */
  meter: ContextRequest;
  actions?: React.ReactNode;
  empty?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const llm = useLlm();
  const { turns, shown } = chat;
  const end = useScrollToEnd(`${turns.length}:${shown?.reply}`);
  return (
    <>
      <ChatHeader>
        <PromptButton request={prompt} />
        {actions}
      </ChatHeader>
      <ContextMeter request={meter} turns={turns.length} />
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {turns.length === 0 && !shown && empty}
        <Turns turns={turns} />
        {shown && <PendingExchange question={shown.question} reply={shown.reply} />}
        <ErrorLine error={chat.error} provider={llm.data?.provider ?? undefined} />
        <div ref={end} />
      </div>
      <ChatComposer
        value={chat.input}
        onChange={chat.setInput}
        onSend={() => chat.send(chat.input)}
        onStop={chat.pending ? chat.stop : undefined}
        placeholder={t("tutor.placeholder")}
      />
    </>
  );
}

function LessonChat(context: Context) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const reset = useResetTutor(context.lessonKey);
  const chat = useChat(useLessonSource(context));

  if (!llm.data?.model) return <NeedsSetup />;
  return (
    <ChatFrame
      chat={chat}
      prompt={() => ({
        tutor: { ...context, message: chat.input.trim(), language: i18n.language },
      })}
      meter={{ ...context, message: "", language: i18n.language }}
      actions={
        chat.turns.length > 0 &&
        !chat.pending && (
          <Button variant="ghost" size="sm" onClick={() => reset.mutate()}>
            <RotateCcw className="size-4" /> {t("tutor.newChat")}
          </Button>
        )
      }
      empty={<LessonSuggestions context={context} onAsk={(text) => chat.send(text)} />}
    />
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
              <LessonChat {...context} />
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

/** The box a chat shows in on a page of its own (the Tutor section). */
export const chatBoxClass = cn(panelClass, "flex h-[70dvh] min-h-96 flex-col overflow-hidden pt-2");

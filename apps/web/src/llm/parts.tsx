// Building blocks shared by the AI screens: chat bubbles, the conversation's header, the pending
// exchange and the composer, a conversation's start, corrections, error lines, scrolling to the end,
// and requests that can be stopped.
import { MESSAGE_MAX } from "@sprachanker/schema";
import { LoaderCircle, type LucideIcon, Send, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client.ts";
import { DictateButton } from "@/audio/dictate.tsx";
import type { SpokenPart } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { inLang } from "@/ui/direction.tsx";
import { useSeconds } from "@/ui/format.ts";
import { RichText } from "@/ui/rich-text.tsx";
import { cn } from "@/ui/utils.ts";
import { AssistantLabel } from "./assistant-label.tsx";
import { errorText } from "./errors.ts";

/** A line of a conversation: the learner's on the right, the other side's (tutor, partner) on the
 *  left; `pending` while it is being sent. `say`: what its speaker button reads (in its corner). */
export function ChatBubble({
  from,
  pending,
  lang,
  say,
  className,
  children,
}: {
  from: "learner" | "other";
  pending?: boolean;
  lang?: string;
  say?: SpokenPart[];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      {...inLang(lang)}
      className={cn(
        "max-w-[92%] rounded-2xl px-4 py-2.5",
        from === "learner"
          ? cn("ms-auto text-primary-foreground", pending ? "bg-primary/60" : "bg-primary")
          : "bg-muted",
        className,
      )}
    >
      {say && <SpeakButton parts={say} className="float-end -mt-1 -me-2 ms-1" />}
      {children}
    </div>
  );
}

/** A failed request in words, with "Retry" when it can be asked again (nothing when there is no
 *  error). */
export function ErrorLine({
  error,
  provider,
  onRetry,
}: {
  error: unknown;
  provider?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const seconds = useSeconds();
  if (!error) return null;
  const wait = error instanceof ApiError ? error.retryAfter : undefined;
  return (
    <p className="text-sm text-wrong">
      {errorText(t, error, provider)}
      {wait !== undefined && ` ${t("llm.error.retryIn", { wait: seconds(wait * 1000) })}`}
      {onRetry && (
        <>
          {" "}
          <button
            type="button"
            className="underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            onClick={onRetry}
          >
            {t("common.retry")}
          </button>
        </>
      )}
    </p>
  );
}

/** The box an AI answer shows in (an explanation, an example, a spoken answer's check); with a `title`, a
 *  head: the title, the model that answered, a spinner while it works, its actions on the right. */
export function AnswerBox({
  title,
  model,
  busy,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  model?: string;
  busy?: boolean;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border bg-muted/50 px-4 py-3", className)} aria-live="polite">
      {title && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Sparkles className="size-4" /> {title}
          {model && <span className="font-normal">· {model}</span>}
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          <span className="ms-auto flex items-center gap-1">{actions}</span>
        </div>
      )}
      {children}
    </div>
  );
}

/** A conversation's top bar: who answers (provider · model), then its actions. */
export function ChatHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-1 border-b px-4 py-1">
      <AssistantLabel className="me-auto" />
      {children}
    </div>
  );
}

/** The line just sent and the answer so far — "thinking…" until it comes — while the reply is on its
 *  way (the tutor streams it, a scene's partner answers at once). */
export function PendingExchange({
  question,
  reply,
  lang,
  className,
}: {
  question: string;
  reply?: string;
  lang?: string;
  /** The learner's bubble (a scene's lines are larger). */
  className?: string;
}) {
  return (
    <>
      <ChatBubble from="learner" pending lang={lang} className={className}>
        <p className="whitespace-pre-wrap">{question}</p>
      </ChatBubble>
      <ChatBubble from="other">{reply ? <RichText text={reply} /> : <Thinking />}</ChatBubble>
    </>
  );
}

/** The seconds since it was first shown, from the second on: a command-line agent's reply comes in
 *  one piece after ten seconds or more. Not read aloud (it changes every second). */
export function Elapsed({ className }: { className?: string }) {
  const seconds = useSeconds();
  const [start] = useState(Date.now);
  const [now, setNow] = useState(start);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  if (now - start < 2000) return null;
  return (
    <span aria-hidden className={cn("tabular-nums", className)}>
      {seconds(now - start)}
    </span>
  );
}

/** "Thinking…" (or what the model is doing) until its reply begins, with the time it takes. */
export function Thinking({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn("text-muted-foreground", className)}>
      {label ?? t("llm.thinking")} <Elapsed />
    </p>
  );
}

/** What a conversation offers before it begins: what it is for, and the one button that starts it. */
export function StartPrompt({
  intro,
  label,
  icon: Icon,
  loading,
  onStart,
}: {
  intro: string;
  label: string;
  icon?: LucideIcon;
  loading?: boolean;
  onStart(): void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">{intro}</p>
      <Button size="lg" loading={loading} onClick={onStart}>
        {Icon && !loading && <Icon />}
        {label}
        {loading && <Elapsed />}
      </Button>
    </div>
  );
}

/** The message box under a conversation: Enter sends, Shift+Enter breaks the line; with `speak`, a
 *  microphone says it in that language instead of typing (the text heard goes into the box). */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  placeholder,
  lang,
  speak,
}: {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  /** While a reply streams: the button stops it instead of sending. */
  onStop?: () => void;
  placeholder: string;
  lang?: string;
  /** The language one may speak the message in (the one learnt). */
  speak?: string;
}) {
  const { t } = useTranslation();
  return (
    <form
      className="flex items-end gap-2 border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <Textarea
        {...inLang(lang)}
        className="max-h-40 min-h-11 resize-none text-base"
        rows={1}
        placeholder={placeholder}
        maxLength={MESSAGE_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      {speak && (
        <DictateButton
          lang={speak}
          onText={(heard) => onChange(value.trim() ? `${value.trimEnd()} ${heard}` : heard)}
        />
      )}
      {onStop ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={t("tutor.stop")}
          onClick={onStop}
        >
          <Square className="size-4" />
        </Button>
      ) : (
        <Button type="submit" size="icon" className="size-11" aria-label={t("tutor.send")}>
          <Send className="rtl:-scale-x-100 size-4" />
        </Button>
      )}
    </form>
  );
}

/** A ref for the end of a list, brought into view whenever `content` changes: in its scrolling box,
 *  or on the page once something new comes. */
export function useScrollToEnd(content: unknown) {
  const end = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const box = scroller(el);
    if (box) box.scrollTop = box.scrollHeight;
    // On the page itself only for new content: opening a step does not jump past its top.
    else if (shown.current) el.scrollIntoView({ block: "end" });
    shown.current = true;
  }, [content]);
  return end;
}

/** The nearest ancestor that scrolls on its own, if any (else the page scrolls). */
function scroller(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return undefined;
}

/** One request at a time that can be stopped; a new one stops the old, unmounting stops it too. */
export function useAbortable() {
  const current = useRef<AbortController>(undefined);
  useEffect(() => () => current.current?.abort(), []);
  return useMemo(
    () => ({
      start() {
        current.current?.abort();
        const controller = new AbortController();
        current.current = controller;
        return controller;
      },
      stop: () => current.current?.abort(),
      isCurrent: (controller: AbortController) => current.current === controller,
    }),
    [],
  );
}

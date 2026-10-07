// Building blocks shared by the AI screens: chat bubbles, the conversation's header, the pending
// exchange and the composer, a conversation's start, corrections, error lines, scrolling to the end,
// and requests that can be stopped.
import { MESSAGE_MAX } from "@sprachanker/schema";
import { type LucideIcon, Send, Square } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { AssistantLabel } from "./assistant-label.tsx";
import { errorText } from "./errors.ts";
import { RichText } from "./rich-text.tsx";

/** A line of a conversation: the learner's on the right, the other side's (tutor, partner) on the
 *  left; `pending` while it is being sent. */
export function ChatBubble({
  from,
  pending,
  lang,
  className,
  children,
}: {
  from: "learner" | "other";
  pending?: boolean;
  lang?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      lang={lang}
      className={cn(
        "max-w-[92%] rounded-2xl px-4 py-2.5",
        from === "learner"
          ? cn("ml-auto text-primary-foreground", pending ? "bg-primary/60" : "bg-primary")
          : "bg-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** "wrong → right — why", as the model corrected the learner's text. */
export function Corrections({
  corrections,
  className,
}: {
  corrections: Array<{ wrong: string; right: string; explanation: string }>;
  className?: string;
}) {
  const lang = useTargetLang();
  if (!corrections.length) return null;
  return (
    <ul className={cn("space-y-1.5 text-sm", className)}>
      {corrections.map((c) => (
        <li key={`${c.wrong}→${c.right}`}>
          <span lang={lang}>
            <s className="text-wrong">{c.wrong}</s> →{" "}
            <strong className="text-correct">{c.right}</strong>
          </span>
          <span className="text-muted-foreground"> — {c.explanation}</span>
        </li>
      ))}
    </ul>
  );
}

/** A failed request in words (nothing when there is no error). */
export function ErrorLine({
  error,
  provider,
  children,
}: {
  error: unknown;
  provider?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p className="text-sm text-wrong">
      {errorText(t, error, provider)}
      {children}
    </p>
  );
}

/** A conversation's top bar: who answers (provider · model), then its actions. */
export function ChatHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-1 border-b px-4 py-1">
      <AssistantLabel className="mr-auto" />
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
  const { t } = useTranslation();
  return (
    <>
      <ChatBubble from="learner" pending lang={lang} className={className}>
        <p className="whitespace-pre-wrap">{question}</p>
      </ChatBubble>
      <ChatBubble from="other">
        {reply ? (
          <RichText text={reply} />
        ) : (
          <p className="text-muted-foreground">{t("llm.thinking")}</p>
        )}
      </ChatBubble>
    </>
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
      </Button>
    </div>
  );
}

/** The message box under a conversation: Enter sends, Shift+Enter breaks the line. */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  placeholder,
  lang,
}: {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  /** While a reply streams: the button stops it instead of sending. */
  onStop?: () => void;
  placeholder: string;
  lang?: string;
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
        lang={lang}
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
          <Send className="size-4" />
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

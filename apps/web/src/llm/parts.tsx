// Building blocks shared by the AI screens: practice cards on the summary, corrections, error lines,
// the chat panel with its composer, and requests that can be stopped.
import { MESSAGE_MAX } from "@sprachanker/schema";
import type { LucideIcon } from "lucide-react";
import { Send, Square } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { errorText } from "./errors.ts";

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

/** A card of a practice step: icon, title, the assistant's label and an action on the right. */
export function PracticeCard({
  icon: Icon,
  title,
  label,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  label?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="size-5" />
        <h2 className="text-xl font-bold">{title}</h2>
        {label && <span className="text-sm text-muted-foreground">· {label}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
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

/** The side panel of a conversation (tutor, scene). */
export function ChatSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="pb-2">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
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

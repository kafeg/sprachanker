// A speaking part of an exam held with the AI assistant (09, Exams; 07, `exam_conversation`; owner's
// choice B, 2026-10-10): the examiner opens the part, the examiner's and the partner's lines are read
// aloud as they come, the learner answers by voice (or typing) — line after line until the examiner
// closes the part or the learner ends it. The conversation is the part's answer, rated afterwards by
// its criteria. The router provides it to the exam run (exams/slots.ts); without an assistant the part
// is answered aloud as any open answer.
import type { LlmTurnPayload, TypedEvent } from "@sprachanker/schema";
import { Mic } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { said } from "@/audio/speak.ts";
import { readingId, useSpeaker } from "@/audio/speaker.ts";
import type { ConversationContext } from "@/exams/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { useConversationTurn } from "./api.ts";
import {
  ChatBubble,
  ChatComposer,
  ChatHeader,
  ErrorLine,
  PendingExchange,
  StartPrompt,
} from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

type Line = LlmTurnPayload & { id: string };

export function ExamConversation({
  runId,
  itemKey,
  events,
  onStored,
  onAnswer,
}: ConversationContext) {
  const { t, i18n } = useTranslation();
  const lang = useTargetLang();
  const turn = useConversationTurn();
  const { say } = useSpeaker();
  const [text, setText] = useState("");
  const lines: Line[] = useMemo(
    () =>
      events.flatMap((e) =>
        e.type === "llm_turn" && e.itemKey === itemKey ? [{ ...e.payload, id: e.id }] : [],
      ),
    [events, itemKey],
  );
  const done = lines.some((l) => l.done);
  const who = (l: Line) =>
    l.role === "user"
      ? t("exams.conversation.you")
      : l.speaker === "partner"
        ? t("exams.conversation.partner")
        : t("exams.conversation.examiner");
  /** The conversation as the part's answer. */
  const transcript = (list: Line[]) => list.map((l) => `${who(l)}: ${l.text}`).join("\n");
  const request = { runId, itemKey, language: i18n.language };

  const send = (line?: string) => {
    if (turn.isPending) return;
    turn.mutate(
      { ...request, ...(line && { text: line }) },
      {
        onSuccess: ({ events: kept, done: over }) => {
          onStored(kept as TypedEvent[]);
          setText("");
          const all = [
            ...lines,
            ...kept.flatMap((e) =>
              e.type === "llm_turn" ? [{ ...(e.payload as LlmTurnPayload), id: e.id }] : [],
            ),
          ];
          onAnswer(transcript(all), over);
          // The examiner's and the partner's new lines, read aloud as they would be said.
          const parts = kept.flatMap((e) =>
            e.type === "llm_turn" && (e.payload as LlmTurnPayload).role === "assistant"
              ? said((e.payload as LlmTurnPayload).text, lang)
              : [],
          );
          if (parts.length) void say(readingId(parts), parts);
        },
      },
    );
  };

  if (!lines.length)
    return (
      <div className="space-y-2">
        <StartPrompt
          intro={t("exams.conversation.intro")}
          label={t("exams.conversation.start")}
          icon={Mic}
          loading={turn.isPending}
          onStart={() => send()}
        />
        <ErrorLine error={turn.error} />
      </div>
    );
  return (
    <div className={panelClass}>
      <ChatHeader>
        {!done && (
          <PromptButton request={() => ({ conversation: { ...request, text: text || "…" } })} />
        )}
      </ChatHeader>
      <div className="space-y-3 p-4" aria-live="polite">
        {lines.map((l) => (
          <ChatBubble
            key={l.id}
            from={l.role === "user" ? "learner" : "other"}
            lang={lang}
            say={l.role === "user" ? undefined : said(l.text, lang)}
          >
            {l.role !== "user" && (
              <p className="text-xs font-medium text-muted-foreground">{who(l)}</p>
            )}
            <p className="whitespace-pre-wrap text-lg">{l.text}</p>
          </ChatBubble>
        ))}
        {turn.isPending && turn.variables?.text && (
          <PendingExchange question={turn.variables.text} lang={lang} className="text-lg" />
        )}
        {done && <p className="font-semibold">{t("exams.conversation.over")}</p>}
        <ErrorLine error={turn.error} />
      </div>
      {!done && (
        <>
          <ChatComposer
            lang={lang}
            value={text}
            onChange={setText}
            onSend={() => text.trim() && send(text.trim())}
            placeholder={t("exams.conversation.placeholder")}
            speak={lang ? [lang] : []}
          />
          <div className="flex justify-end px-3 pb-3">
            <Button variant="ghost" size="sm" onClick={() => onAnswer(transcript(lines), true)}>
              {t("exams.conversation.end")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// A speaking part of an exam held with the AI assistant (09, Exams; 07, `exam_conversation`; owner's
// choice B, 2026-10-10): the examiner opens the part, the examiner's and the partner's lines are read
// aloud as they come, the learner answers by voice (or typing) — line after line until the examiner
// closes the part or the learner ends it (kept: the part shows ended). The learner's own lines are the
// part's answer — stored once they have said something, again only when it changed —, rated afterwards
// by its criteria with the conversation around them. The router provides it to the exam run
// (exams/slots.ts); without an assistant the part is answered aloud as any open answer.
import type { LlmTurnPayload, RespondAnswer } from "@sprachanker/schema";
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
  // Closed by the examiner, or ended by the learner (their empty line).
  const done = lines.some((l) => l.done);
  /** The answer stored last for the part, if any. */
  const stored = events.findLast((e) => e.type === "answered" && e.itemKey === itemKey);
  const storedText =
    stored?.type === "answered" ? (stored.payload.answer as RespondAnswer).text : undefined;
  const who = (l: Line) =>
    l.speaker === "partner" ? t("exams.conversation.partner") : t("exams.conversation.examiner");
  /** The part's answer: the learner's own lines, once there are some and as they changed — the
   *  examiner's greeting alone answers nothing, the same lines are not stored again. */
  const answer = (list: Line[], final: boolean) => {
    const text = list
      .filter((l) => l.role === "user" && l.text.trim())
      .map((l) => l.text)
      .join("\n");
    if (text && text !== storedText) onAnswer(text, final);
  };
  const request = { runId, itemKey, language: i18n.language };

  /** The learner ends the part: kept, so it shows ended; the answer as it stands is final. */
  const end = () => {
    if (turn.isPending) return;
    turn.mutate(
      { ...request, end: true },
      {
        onSuccess: ({ events: kept }) => {
          onStored(kept);
          answer(lines, true);
        },
      },
    );
  };

  const send = (line?: string) => {
    if (turn.isPending) return;
    turn.mutate(
      { ...request, ...(line && { text: line }) },
      {
        onSuccess: ({ events: kept, done: over }) => {
          onStored(kept);
          setText("");
          const all = [
            ...lines,
            ...kept.flatMap((e) => (e.type === "llm_turn" ? [{ ...e.payload, id: e.id }] : [])),
          ];
          answer(all, over);
          // The examiner's and the partner's new lines, read aloud as they would be said.
          const parts = kept.flatMap((e) =>
            e.type === "llm_turn" && e.payload.role === "assistant"
              ? said(e.payload.text, lang)
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
        {lines
          .filter((l) => l.text.trim())
          .map((l) => (
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
            speak={lang}
          />
          <div className="flex justify-end px-3 pb-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={turn.isPending}
              loading={turn.isPending && !!turn.variables?.end}
              onClick={end}
            >
              {t("exams.conversation.end")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

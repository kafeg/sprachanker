// The tutor's history (07, 09): the lesson's chats, newest first — the first question, when, how many
// messages, the current one marked — each opening to its turns: the learner's with the time and the
// exercise on screen, the tutor's replies; a chat can be deleted (confirmed: its turns go with it).
import type { ExerciseKey } from "@sprachanker/schema";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLesson } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { HistoryList } from "@/ui/history.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { RichText } from "@/ui/rich-text.tsx";
import { type TutorChat, useDeleteChat, useTutorChat, useTutorChats } from "./api.ts";
import { ChatBubble } from "./parts.tsx";

type Ids = { series: string; lessonKey: string; edition: string };

/** An exercise's name in the lesson: its title, or its number. */
function useExerciseLabel({ series, lessonKey, edition }: Ids) {
  const { t } = useTranslation();
  const data = useLesson(series, lessonKey, edition).data;
  return (key: string | undefined) => {
    if (!key || !data) return undefined;
    const n = data.lesson.pages.findIndex((p) => p.exercise.key === key) + 1;
    return (
      data.locale?.exercises[key as ExerciseKey]?.title ||
      (n > 0 ? t("lesson.exerciseN", { n }) : undefined)
    );
  };
}

function Turns({ ids, chat }: { ids: Ids; chat: TutorChat }) {
  const { t } = useTranslation();
  const turns = useTutorChat(ids.lessonKey, chat.id);
  const when = useDateFormat("dayTime");
  const label = useExerciseLabel(ids);
  const remove = useDeleteChat(ids.lessonKey);
  const [asking, setAsking] = useState(false);
  if (turns.isPending) return <Loading />;
  if (turns.isError) return <ErrorState error={turns.error} onRetry={() => turns.refetch()} />;
  return (
    <div className="space-y-3">
      {turns.data.turns.map((turn) =>
        turn.role === "user" ? (
          <div key={`${turn.ts}-u`} className="ml-auto max-w-[92%] space-y-0.5 text-right">
            <p className="text-xs text-muted-foreground">
              {[when.format(turn.ts), label(turn.exerciseKey)].filter(Boolean).join(" · ")}
            </p>
            <ChatBubble from="learner" className="max-w-none text-left">
              <p className="whitespace-pre-wrap">{turn.text}</p>
            </ChatBubble>
          </div>
        ) : (
          <ChatBubble key={`${turn.ts}-a`} from="other">
            <RichText text={turn.text} />
          </ChatBubble>
        ),
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setAsking(true)}
      >
        <Trash2 /> {t("tutor.delete")}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("tutor.deleteTitle")}
        description={t("tutor.deleteBody")}
        confirm={t("tutor.delete")}
        cancel={t("common.cancel")}
        busy={remove.isPending}
        onConfirm={() => remove.mutate(chat.id, { onSuccess: () => setAsking(false) })}
      />
    </div>
  );
}

export function TutorHistory(ids: Ids) {
  const { t } = useTranslation();
  const chats = useTutorChats(ids.lessonKey);
  const when = useDateFormat("dayTime");
  if (chats.isPending) return <Loading />;
  if (chats.isError) return <ErrorState error={chats.error} onRetry={() => chats.refetch()} />;
  if (!chats.data.chats.length)
    return <p className="p-4 text-muted-foreground">{t("tutor.noHistory")}</p>;
  return (
    <HistoryList
      items={chats.data.chats}
      keyOf={(c) => c.id}
      summary={(c) => (
        <span className="block">
          <span className="block truncate">{c.title}</span>
          <span className="block text-sm text-muted-foreground">
            {[
              when.format(c.lastAt),
              t("notebook.messages", { count: c.turns }),
              c.current && t("tutor.current"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      )}
      detail={(c) => <Turns ids={ids} chat={c} />}
    />
  );
}

// The Tutor section (09, 07): the tutor on its own — the chats about no lesson, the one written in last
// first, each continued with a tap and deleted after asking; a new chat with a few ways to start. A
// chat is shown by the lesson tutor's view. Without a model or with the tutor's place off it says how
// to turn it on; before a course is begun, that one is needed.
import { parseEditionId } from "@sprachanker/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourses } from "@/api/courses.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { LanguageFlag } from "@/ui/flags.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { BackLink, EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import {
  SECTION,
  streamSection,
  type TutorChat,
  useDeleteChat,
  useSectionCache,
  useTutorChat,
  useTutorChats,
} from "./api.ts";
import { useAiIn, useLlm } from "./setup-api.ts";
import { ChatFrame, type ChatSource, chatBoxClass, Suggestions, useChat } from "./tutor.tsx";

/** The address of a chat not begun yet: `/tutor/new`. */
export const NEW_CHAT = "new";

/** The ways into a new chat: only a first message each, sent for the learner. */
const STARTS = ["grammar", "text", "conversation"] as const;

const LINK = "mt-2 inline-flex items-center font-medium underline pointer-coarse:min-h-11";

/** Whether a course is begun (what the tutor talks about); undefined while that is read. */
function useCourseBegun() {
  const courses = useCourses();
  return courses.data && { begun: courses.data.some((c) => c.started), any: !!courses.data.length };
}

/** Where the tutor cannot work: no model, or its place turned off — the way to the settings. */
function Unavailable() {
  const { t } = useTranslation();
  const llm = useLlm();
  return (
    <EmptyState>
      <p>{t(llm.data?.model ? "tutorSection.off" : "tutor.needsSetup")}</p>
      <Link to="/settings" hash="ai" className={LINK}>
        {t("tutor.openSettings")}
      </Link>
    </EmptyState>
  );
}

/** No course begun: what the tutor needs, and the way to a course. */
function NeedsCourse({ any }: { any: boolean }) {
  const { t } = useTranslation();
  return (
    <EmptyState>
      <p>{t("tutorSection.needsCourse")}</p>
      <Link to={any ? "/downloaded" : "/catalog"} className={LINK}>
        {t("courses.choose")}
      </Link>
    </EmptyState>
  );
}

/** The language a chat practises, as its flag named for screen readers and on hover. */
function ChatLanguage({ chat }: { chat: TutorChat }) {
  const { i18n } = useTranslation();
  if (!chat.edition) return null;
  const { target } = parseEditionId(chat.edition);
  const name = languageName(target, i18n.language, true);
  return (
    <span role="img" aria-label={name} title={name} className="inline-flex">
      <LanguageFlag lang={target} />
    </span>
  );
}

function ChatList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chats = useTutorChats(SECTION);
  const course = useCourseBegun();
  const when = useDateFormat("dayTime");
  const remove = useDeleteChat(SECTION);
  const [asking, setAsking] = useState<string>();
  if (chats.isPending || !course) return <Loading />;
  if (chats.isError) return <ErrorState error={chats.error} onRetry={() => chats.refetch()} />;
  const list = chats.data.chats;
  if (!list.length)
    return course.begun ? (
      <EmptyState>{t("tutorSection.empty")}</EmptyState>
    ) : (
      <NeedsCourse any={course.any} />
    );
  return (
    <>
      <ul className={cn(panelClass, "divide-y overflow-hidden")}>
        {list.map((chat) => (
          <li key={chat.id} className="flex items-center gap-1 pe-2">
            <ListRow
              flush
              className="min-w-0 flex-1"
              onClick={() => void navigate({ to: "/tutor/$chat", params: { chat: chat.id } })}
            >
              <ChatLanguage chat={chat} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{chat.title}</span>
                <span className="block text-sm text-muted-foreground">
                  {when.format(chat.lastAt)} · {t("notebook.messages", { count: chat.turns })}
                </span>
              </span>
            </ListRow>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              aria-label={t("tutor.delete")}
              title={t("tutor.delete")}
              onClick={() => setAsking(chat.id)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!asking}
        onOpenChange={(open) => !open && setAsking(undefined)}
        title={t("tutor.deleteTitle")}
        description={t("tutor.deleteBody")}
        confirm={t("tutor.delete")}
        cancel={t("common.cancel")}
        busy={remove.isPending}
        onConfirm={() => asking && remove.mutate(asking, { onSuccess: () => setAsking(undefined) })}
      />
    </>
  );
}

/** The Tutor section's page: what it is for, "New chat", the chats. */
export function TutorSection() {
  const { t } = useTranslation();
  const on = useAiIn("tutor");
  return (
    <Page
      title={t("tutor.title")}
      actions={
        on && (
          <Button asChild>
            <Link to="/tutor/$chat" params={{ chat: NEW_CHAT }}>
              <Plus /> {t("tutor.newChat")}
            </Link>
          </Button>
        )
      }
    >
      <p className="mb-4 text-muted-foreground">{t("tutorSection.intro")}</p>
      {on === undefined ? <Loading /> : on ? <ChatList /> : <Unavailable />}
    </Page>
  );
}

/** A chat of the section (`chatId`), or a new one: once its first reply is in, `onStarted` with the
 *  chat the server made. */
function SectionChat({
  chatId,
  onStarted,
}: {
  chatId: string | undefined;
  onStarted(id: string): void;
}) {
  const { t, i18n } = useTranslation();
  const history = useTutorChat(SECTION, chatId);
  const addToCache = useSectionCache();
  /** The chat a new chat's first message made. */
  const started = useRef<string>(undefined);
  const source: ChatSource = {
    turns: chatId ? history.data?.turns : [],
    refetch: () => (chatId ? history.refetch() : Promise.resolve()),
    add: (turns) => {
      const id = chatId ?? started.current;
      if (id) addToCache(id, turns);
    },
    send: async (message, _newChat, onText, signal) => {
      const sent = await streamSection(
        { chatId, message, language: i18n.language },
        onText,
        signal,
      );
      started.current = sent.chatId;
      return sent.reply;
    },
  };
  const chat = useChat(source, () => {
    if (!chatId && started.current) onStarted(started.current);
  });
  if (history.isError)
    return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  return (
    <ChatFrame
      chat={chat}
      prompt={() => ({ section: { chatId, message: chat.input.trim(), language: i18n.language } })}
      meter={{ chatId, message: "", language: i18n.language }}
      empty={
        <Suggestions
          intro={t("tutorSection.intro")}
          items={STARTS.map((s) => ({
            key: s,
            label: t(`tutorSection.suggest.${s}`),
            text: t(`tutorSection.ask.${s}`),
          }))}
          onAsk={(text) => chat.send(text)}
        />
      }
    />
  );
}

/** A chat's page (`/tutor/$chat`; `new`: one not begun), with the way back to the list. */
export function SectionChatPage({ chat }: { chat: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const on = useAiIn("tutor");
  const course = useCourseBegun();
  const chatId = chat === NEW_CHAT ? undefined : chat;
  const back = (
    <BackLink onClick={() => void navigate({ to: "/tutor" })}>{t("tutorSection.all")}</BackLink>
  );
  const body =
    on === undefined || !course ? (
      <Loading />
    ) : !on ? (
      <Unavailable />
    ) : !chatId && !course.begun ? (
      <NeedsCourse any={course.any} />
    ) : (
      <div className={chatBoxClass}>
        <SectionChat
          chatId={chatId}
          onStarted={(id) =>
            void navigate({ to: "/tutor/$chat", params: { chat: id }, replace: true })
          }
        />
      </div>
    );
  return (
    <Page title={t("tutor.title")} back={back}>
      {body}
    </Page>
  );
}

// The Tutor section (09, 07): the tutor on its own — the chats about no lesson, the one written in last
// first, each continued with a tap and deleted after asking; a new chat with a few ways to start and,
// when the courses begun teach several, the language to practise. A chat is shown by the lesson
// tutor's view with the language it practises. Without a model or with the tutor's place off it says how
// to turn it on; before a course is begun (as the server says), that one is needed.
import { parseEditionId } from "@sprachanker/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { SelectField } from "@/ui/select-field.tsx";
import { cn } from "@/ui/utils.ts";
import {
  SECTION,
  streamSection,
  type TutorChat,
  useDeleteChat,
  useReadSectionChat,
  useSectionCache,
  useSectionChats,
  useTutorChat,
} from "./api.ts";
import { useAiIn, useLlm } from "./setup-api.ts";
import { ChatFrame, type ChatSource, chatBoxClass, Suggestions, useChat } from "./tutor.tsx";

/** The address of a chat not begun yet: `/tutor/new`. */
export const NEW_CHAT = "new";

/** The ways into a new chat: only a first message each, sent for the learner. */
const STARTS = ["grammar", "text", "conversation"] as const;

const LINK = "mt-2 inline-flex items-center font-medium underline pointer-coarse:min-h-11";

/** How long a chat stopped at once is looked for again (the server keeping what came of it). */
const KEPT_AFTER_MS = 500;

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

/** No course begun (as the server says: a new chat cannot begin): what the tutor needs, and the way
 *  to a course — Downloaded while there are courses (or while that is read), else Available. */
function NeedsCourse() {
  const { t } = useTranslation();
  const any = useCourses().data?.length !== 0;
  return (
    <EmptyState>
      <p>{t("tutorSection.needsCourse")}</p>
      <Link to={any ? "/downloaded" : "/catalog"} className={LINK}>
        {t("courses.choose")}
      </Link>
    </EmptyState>
  );
}

/** The language a chat practises in its header: its flag and name. */
function Practised({ lang }: { lang: string }) {
  const { t, i18n } = useTranslation();
  const label = t("tutorSection.practising", { language: languageName(lang, i18n.language) });
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground" title={label}>
      <LanguageFlag lang={lang} />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{languageName(lang, i18n.language, true)}</span>
    </span>
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
  const chats = useSectionChats();
  const when = useDateFormat("dayTime");
  const remove = useDeleteChat(SECTION);
  const [asking, setAsking] = useState<string>();
  if (chats.isPending) return <Loading />;
  if (chats.isError) return <ErrorState error={chats.error} onRetry={() => chats.refetch()} />;
  // Pages read at different times may share a chat that moved up meanwhile: listed once.
  const seen = new Set<string>();
  const list = chats.data.pages
    .flatMap((p) => p.chats)
    .filter((c) => !seen.has(c.id) && !!seen.add(c.id));
  if (!list.length)
    return chats.data.pages[0]?.cannotStart ? (
      <NeedsCourse />
    ) : (
      <EmptyState>{t("tutorSection.empty")}</EmptyState>
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
      {chats.hasNextPage && (
        <Button
          variant="outline"
          className="mt-3 w-full"
          loading={chats.isFetchingNextPage}
          onClick={() => void chats.fetchNextPage()}
        >
          {t("tutorSection.more")}
        </Button>
      )}
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

/** Whether the component is still on screen (a reply ending after the page was left). */
function useOnScreen() {
  const on = useRef(true);
  useEffect(() => {
    on.current = true;
    return () => {
      on.current = false;
    };
  }, []);
  return on;
}

/** A chat of the section (`chatId`), or a new one in one of `targets` (the latest course's first,
 *  chosen while there are several): once the server keeps its first message — the reply in full, or
 *  as far as it came when stopped — `onStarted` with the chat it made. */
function SectionChat({
  chatId,
  targets,
  onStarted,
}: {
  chatId: string | undefined;
  targets: string[];
  onStarted(id: string): void;
}) {
  const { t, i18n } = useTranslation();
  const [chosen, setChosen] = useState(targets[0]);
  const onScreen = useOnScreen();
  /** The chat a new chat's first message made, as soon as the server names it (`made` for the
   *  callbacks of a message on its way, `started` for what is shown). */
  const made = useRef<string>(undefined);
  const [started, setStarted] = useState<string>();
  // A new chat's turns are shown from the cache, where its first pair goes at once: never read before
  // the server keeps it, never empty for a frame between the reply and the chat's own address.
  const history = useTutorChat(SECTION, chatId ?? started, !!chatId);
  const addToCache = useSectionCache();
  const readChat = useReadSectionChat();
  /** The next message is a way in sent for the learner; some of the reply came. */
  const starting = useRef(false);
  const replied = useRef(false);

  /** After a new chat's first message: the chat kept goes to its own address; one never kept (the
   *  reply failed, or stopped before any text) leaves this a new chat. */
  const settle = async () => {
    const id = made.current;
    if (!id) return;
    let kept = await readChat(id);
    if (!kept && replied.current) {
      await new Promise((resolve) => setTimeout(resolve, KEPT_AFTER_MS));
      kept = await readChat(id);
    }
    if (!kept) {
      made.current = undefined;
      setStarted(undefined);
    } else if (onScreen.current) onStarted(id);
  };

  const source: ChatSource = {
    turns: chatId ? history.data?.turns : (history.data?.turns ?? []),
    refetch: () => (chatId ? history.refetch() : settle()),
    add: (turns) => {
      const id = chatId ?? made.current;
      if (id) addToCache(id, turns);
    },
    send: (message, _newChat, onText, signal) => {
      const start = starting.current;
      starting.current = false;
      replied.current = false;
      const id = chatId ?? made.current;
      return streamSection(
        {
          chatId: id,
          message,
          language: i18n.language,
          // A chat begun keeps its language.
          ...(!id && chosen && { target: chosen }),
          ...(start && { start }),
        },
        (text) => {
          replied.current ||= !!text.trim();
          onText(text);
        },
        signal,
        (id) => {
          made.current = id;
          setStarted(id);
        },
      );
    },
  };
  const chat = useChat(source);
  if (history.isError)
    return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  // A chat's own language once the server keeps it; a new chat's the one chosen, asked while there
  // are several and nothing is sent yet.
  const kept = history.data?.edition;
  const practised = kept ? parseEditionId(kept).target : chatId ? undefined : chosen;
  const isNew = !chatId && !started;
  const choosing = isNew && targets.length > 1 && !chat.turns.length && !chat.shown;
  const target = isNew ? chosen : undefined;
  return (
    <ChatFrame
      chat={chat}
      prompt={() => ({
        section: { chatId, message: chat.input.trim(), language: i18n.language, target },
      })}
      meter={{ chatId, message: "", language: i18n.language, target }}
      actions={practised && !choosing && <Practised lang={practised} />}
      empty={
        <div className="space-y-3">
          {choosing && (
            <SelectField
              className="pt-2 sm:w-64"
              label={t("tutorSection.language")}
              value={chosen ?? ""}
              options={targets.map((lang) => [
                lang,
                <span key={lang} className="flex items-center gap-2">
                  <LanguageFlag lang={lang} />
                  {languageName(lang, i18n.language, true)}
                </span>,
              ])}
              onChange={setChosen}
            />
          )}
          <Suggestions
            intro={t("tutorSection.intro")}
            items={STARTS.map((s) => ({
              key: s,
              label: t(`tutorSection.suggest.${s}`),
              text: t(`tutorSection.ask.${s}`),
            }))}
            onAsk={(text) => {
              starting.current = true;
              chat.send(text);
            }}
          />
        </div>
      }
    />
  );
}

/** A chat's page (`/tutor/$chat`; `new`: one not begun), with the way back to the list. */
export function SectionChatPage({ chat }: { chat: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const on = useAiIn("tutor");
  const chatId = chat === NEW_CHAT ? undefined : chat;
  // Whether a new chat can begin, as the server says (the section's list); a chat begun needs no word.
  const chats = useSectionChats(!chatId);
  const back = (
    <BackLink onClick={() => void navigate({ to: "/tutor" })}>{t("tutorSection.all")}</BackLink>
  );
  const body =
    on === undefined || (!chatId && chats.isPending) ? (
      <Loading />
    ) : !on ? (
      <Unavailable />
    ) : !chatId && chats.isError ? (
      <ErrorState error={chats.error} onRetry={() => chats.refetch()} />
    ) : !chatId && chats.data?.pages[0]?.cannotStart ? (
      <NeedsCourse />
    ) : (
      // One element for a new chat and the chat it becomes: what it shows stays as its address changes.
      <div className={chatBoxClass}>
        <SectionChat
          chatId={chatId}
          targets={chats.data?.pages[0]?.targets ?? []}
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

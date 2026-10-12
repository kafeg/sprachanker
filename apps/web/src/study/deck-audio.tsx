// A deck's words read aloud. Under a deck to take, all its words, taken or
// not: how many have audio, "Generate audio" — read by the server's engine and kept, so its cards play
// it on any device —, the audio generated removed or generated again (asked first), the engine and
// voice that read (and where to choose another), its progress with Stop while it reads, why it failed,
// or where to install a voice when nothing here reads the words' language. Under a deck taken, its
// status in a line (`status`).
import { Link } from "@tanstack/react-router";
import { RefreshCw, Trash2, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reading, useDeckAudio, useDeckAudioActions } from "@/api/decks.ts";
import { voiceName } from "@/audio/voice-names.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmButton } from "@/ui/confirm.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useTimeLeft } from "@/ui/format.ts";
import { JobRow } from "@/ui/job-row.tsx";
import { cn } from "@/ui/utils.ts";

const LINK = "inline-flex items-center underline pointer-coarse:min-h-11";

export function DeckAudio({
  scope,
  title,
  status = false,
  className,
}: {
  scope: string;
  /** The deck's name, for what is asked before removing. */
  title?: string;
  /** Only how it stands, in a line (a deck taken: the actions are under the deck to take). */
  status?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const state = useDeckAudio(scope);
  const s = state.data;
  if (!s?.words) return null;
  const running = reading(s) ? s.job : null;
  if (status) {
    const line = running
      ? t("decks.audio.reading", { done: running.done, total: running.total })
      : s.missing
        ? t("decks.audio.missing", { count: s.missing })
        : s.read
          ? t("decks.audio.all")
          : null;
    return line ? <p className={cn("text-sm text-muted-foreground", className)}>{line}</p> : null;
  }
  return <DeckAudioActions scope={scope} title={title ?? ""} state={s} className={className} />;
}

function DeckAudioActions({
  scope,
  title,
  state: s,
  className,
}: {
  scope: string;
  title: string;
  state: NonNullable<ReturnType<typeof useDeckAudio>["data"]>;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const actions = useDeckAudioActions(scope);
  const timeLeft = useTimeLeft();
  const job = s.job;
  const running = reading(s) ? job : null;
  const language = languageName(s.lang, i18n.language);
  const error = actions.start.error ?? actions.stop.error ?? actions.remove.error;
  const cancel = t("common.cancel");
  return (
    <JobRow
      className={className}
      running={
        running
          ? {
              status: t("decks.audio.reading", { done: running.done, total: running.total }),
              left: running.leftMs ? timeLeft(running.leftMs) : "",
              done: running.done,
              total: running.total,
              stopping: actions.stop.isPending || running.status === "stopping",
              stop: t("decks.audio.stop"),
              onStop: () => actions.stop.mutate(),
            }
          : undefined
      }
      idle={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-muted-foreground">
            {t("decks.audio.count", { done: s.own + s.read, total: s.words })}
          </span>
          {s.reader && s.missing > 0 && (
            <Button
              variant="outline"
              size="sm"
              loading={actions.start.isPending}
              onClick={() => actions.start.mutate(false)}
            >
              <Volume2 className="size-3.5" /> {t("decks.audio.generate")}
            </Button>
          )}
          {s.reader && s.read > 0 && (
            <ConfirmButton
              title={t("decks.audio.regenerateTitle", { deck: title })}
              description={t("decks.audio.regenerateBody")}
              confirm={t("decks.audio.regenerate")}
              cancel={cancel}
              busy={actions.start.isPending}
              onConfirm={(close) => actions.start.mutate(true, { onSettled: close })}
            >
              <RefreshCw className="size-3.5" /> {t("decks.audio.regenerate")}
            </ConfirmButton>
          )}
          {s.read > 0 && (
            <ConfirmButton
              title={t("decks.audio.removeTitle", { deck: title })}
              description={t("decks.audio.removeBody")}
              confirm={t("decks.audio.remove")}
              cancel={cancel}
              busy={actions.remove.isPending}
              onConfirm={(close) => actions.remove.mutate(undefined, { onSettled: close })}
            >
              <Trash2 className="size-3.5" /> {t("decks.audio.remove")}
            </ConfirmButton>
          )}
          {s.reader
            ? (s.missing > 0 || s.read > 0) && (
                <span className="text-muted-foreground">
                  {t("decks.audio.voice", {
                    engine: s.reader.engine,
                    voice: voiceName(s.reader.engine, s.reader.voice),
                    language,
                  })}{" "}
                  <Link to="/settings" hash="speech" className={LINK}>
                    {t("decks.audio.chooseVoice")}
                  </Link>
                </span>
              )
            : s.missing > 0 && (
                <Link to="/settings" hash="speech" className={LINK}>
                  {t("decks.audio.install", { language })}
                </Link>
              )}
        </div>
      }
      failed={
        !running && job?.failed && s.missing ? (
          <p>
            {t("decks.audio.failed", { count: job.failed })}
            {job.error && ` ${t("decks.why", { reason: errorText(t, job.error) })}`}
          </p>
        ) : undefined
      }
      error={error ? errorText(t, error) : undefined}
    />
  );
}

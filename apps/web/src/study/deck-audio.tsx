// A deck's words read aloud (09, Review → Decks; 04): under a deck, how many of its words have no
// audio, the engine and voice that would read them (and where to choose another) and "Generate
// audio" — read by the server's engine and kept, so its cards play it on any device —, its progress
// with Stop while it reads, why it failed, or where to install a voice when nothing here reads the
// words' language.
import { Link } from "@tanstack/react-router";
import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reading, useDeckAudio, useDeckAudioActions } from "@/api/decks.ts";
import { voiceName } from "@/audio/voice-names.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useDuration } from "@/ui/format.ts";
import { JobRow } from "@/ui/job-row.tsx";
import { cn } from "@/ui/utils.ts";

const LINK = "inline-flex items-center underline pointer-coarse:min-h-11";

export function DeckAudio({ scope, className }: { scope: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const state = useDeckAudio(scope);
  const actions = useDeckAudioActions(scope);
  const duration = useDuration();
  const s = state.data;
  if (!s?.words) return null;
  const job = s.job;
  const running = reading(s) ? job : null;
  if (!running && !s.missing)
    return s.read ? (
      <p className={cn("text-sm text-muted-foreground", className)}>{t("decks.audio.all")}</p>
    ) : null;
  const language = languageName(s.lang, i18n.language);
  const error = actions.start.error ?? actions.stop.error;
  return (
    <JobRow
      className={className}
      running={
        running
          ? {
              status: t("decks.audio.reading", { done: running.done, total: running.total }),
              left: running.leftMs ? t("decks.left", { time: duration(running.leftMs) }) : "",
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
            {t("decks.audio.missing", { count: s.missing })}
          </span>
          {s.reader ? (
            <>
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
              <Button
                variant="outline"
                size="sm"
                loading={actions.start.isPending}
                onClick={() => actions.start.mutate()}
              >
                <Volume2 className="size-3.5" /> {t("decks.audio.generate")}
              </Button>
            </>
          ) : (
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

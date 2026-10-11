// A deck's words read aloud (09, Review → Decks; 04): under a deck, how many of its words have no
// audio and "Generate audio" — read by the server's engine and kept, so its cards play it on any
// device —, its progress with Stop while it reads, or where to install a voice when nothing here
// reads the words' language.
import { Link } from "@tanstack/react-router";
import { Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reading, useDeckAudio, useDeckAudioActions } from "@/api/decks.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { errorText } from "@/ui/error-text.ts";
import { cn } from "@/ui/utils.ts";

export function DeckAudio({ scope, className }: { scope: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const state = useDeckAudio(scope);
  const actions = useDeckAudioActions(scope);
  const s = state.data;
  if (!s || !s.words) return null;
  const job = s.job;
  const running = reading(s) ? job : null;
  const failed = !running && !!job?.failed && !!s.missing;
  if (!running && !s.missing)
    return s.read ? (
      <p className={cn("text-sm text-muted-foreground", className)}>{t("decks.audio.all")}</p>
    ) : null;
  const error = actions.start.error ?? actions.stop.error;
  return (
    <div className={cn("space-y-1.5 text-sm", className)}>
      {running ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span role="status" className="text-muted-foreground">
            {t("decks.audio.reading", { done: running.done, total: running.total })}
          </span>
          <Button
            variant="outline"
            size="sm"
            loading={actions.stop.isPending || running.status === "stopping"}
            onClick={() => actions.stop.mutate()}
          >
            <Square className="size-3.5" /> {t("decks.audio.stop")}
          </Button>
          <Progress
            value={running.total ? (running.done / running.total) * 100 : 0}
            aria-label={t("decks.audio.generate")}
            className="h-1.5 basis-full"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-muted-foreground">
            {t("decks.audio.missing", { count: s.missing })}
          </span>
          {s.reader ? (
            <Button
              variant="outline"
              size="sm"
              loading={actions.start.isPending}
              onClick={() => actions.start.mutate()}
            >
              <Volume2 className="size-3.5" /> {t("decks.audio.generate")}
            </Button>
          ) : (
            <Link
              to="/settings"
              hash="speech"
              className="inline-flex items-center underline pointer-coarse:min-h-11"
            >
              {t("decks.audio.install", { language: languageName(s.lang, i18n.language) })}
            </Link>
          )}
        </div>
      )}
      {failed && job && (
        <p className="text-wrong">{t("decks.audio.failed", { count: job.failed })}</p>
      )}
      {error && <p className="text-wrong">{errorText(t, error)}</p>}
    </div>
  );
}

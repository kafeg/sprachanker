// A recording in a mock exam (09, Exams): played as the real test plays it — from the start to the end,
// no going back, only as often as the Teil allows ("You hear each text twice"); the plays used are
// kept on this device per run, so a reload does not give them back. Practice plays it as any other.
import { Play, Volume2 } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Progress } from "@/ui/components/progress.tsx";
import { AudioPlayer } from "@/ui/media.tsx";
import { claimPlayback, PlaybackRate } from "@/ui/playback.tsx";
import { cn } from "@/ui/utils.ts";

const playsKey = (run: string, src: string) => `sprachanker.exam-plays:${run}:${src}`;
const readPlays = (key: string) => {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
};
const writePlays = (key: string, n: number) => {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    // Storage blocked: the plays are counted for this page only.
  }
};

export function ExamRecording({
  src,
  label,
  plays,
  run,
  className,
}: {
  src: string;
  label: string;
  /** How often it may be played; none: freely (practice). */
  plays?: number;
  /** The run the plays are counted in. */
  run: string;
  className?: string;
}) {
  if (plays === undefined)
    return <AudioPlayer compact src={src} label={label} className={className} />;
  return <Limited src={src} label={label} plays={plays} run={run} className={className} />;
}

function Limited({
  src,
  label,
  plays,
  run,
  className,
}: {
  src: string;
  label: string;
  plays: number;
  run: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { rate } = useContext(PlaybackRate);
  const audio = useRef<HTMLAudioElement>(null);
  /** A play this player began (its button); one begun elsewhere (the system's media keys) is not. */
  const begun = useRef(false);
  const key = playsKey(run, src);
  const [used, setUsed] = useState(() => readPlays(key));
  const [playing, setPlaying] = useState(false);
  const [share, setShare] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  const left = Math.max(0, plays - used);

  const start = () => {
    const a = audio.current;
    if (!a || playing || !left) return;
    begun.current = true;
    a.currentTime = 0;
    a.playbackRate = rate;
    void a.play().catch(() => setFailed(true));
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of player controls, not a fieldset of a form
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border bg-card p-1.5 pr-3",
        className,
      )}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: exam recordings come without captions */}
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={(e) => {
          // Only a play from the start, begun here, while plays are left: no resuming from elsewhere.
          if (!begun.current) {
            e.currentTarget.pause();
            return;
          }
          begun.current = false;
          claimPlayback(e.currentTarget);
          setPlaying(true);
          // A play counts once begun: as in the room, it is not taken back.
          const n = used + 1;
          setUsed(n);
          writePlays(key, n);
        }}
        onTimeUpdate={(e) =>
          setShare(
            e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0,
          )
        }
        onEnded={() => {
          setPlaying(false);
          setShare(0);
        }}
        // Paused from elsewhere (another recording claimed playback): this play is spent.
        onPause={(e) => {
          if (!e.currentTarget.ended) {
            setPlaying(false);
            setShare(0);
          }
        }}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={start}
        disabled={failed || playing || !left}
        aria-label={t("player.play", { what: label })}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
      >
        {playing ? (
          <Volume2 className="size-4" />
        ) : (
          <Play className="size-4 translate-x-px fill-current" />
        )}
      </button>
      {failed ? (
        <p className="flex-1 text-sm text-muted-foreground">{t("player.unavailable")}</p>
      ) : (
        <Progress value={share * 100} className="h-1.5 flex-1" aria-label={t("player.position")} />
      )}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {t("exams.playsLeft", { left, plays })}
      </span>
    </div>
  );
}

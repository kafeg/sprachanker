// Media: the audio player, the word audio button, stimulus video/image/audio. One medium plays
// at a time at the profile's speed (playback.tsx).
import type { Media } from "@sprachanker/schema";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "./components/slider.tsx";
import { clock } from "./format.ts";
import { panelClass } from "./panel.tsx";
import { usePlayable } from "./playable.ts";
import { claimPlayback, PlaybackRate, SpeedButton, useClip } from "./playback.tsx";
import { cn } from "./utils.ts";
import { Episode, EpisodeVideo, isEpisode, peek } from "./video.tsx";

/**
 * Audio with play/pause, a timeline to drag or click, elapsed and remaining time and the speed; the
 * full size adds a title and "back 5 s". Arrow keys on the timeline jump 5 s.
 */
export function AudioPlayer({
  src,
  label,
  title,
  compact = false,
  className,
  onHeard,
}: {
  src: string;
  /** What is played, for screen readers. */
  label: string;
  /** A visible caption (full size only). */
  title?: string;
  compact?: boolean;
  className?: string;
  /** Called once it has been played, or when it cannot be (a file that does not load blocks nothing). */
  onHeard?: () => void;
}) {
  const { t } = useTranslation();
  const { rate } = useContext(PlaybackRate);
  const audio = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [dragging, setDragging] = useState<number>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);
  // Smooth progress while playing: the position the element reports comes late and in uneven steps
  // (WebKit's), so the thumb runs on a clock of its own — started when the sound really starts (the
  // first step the element reports), at the speed it plays — and goes back to the element's position
  // only when they part by more than a third of a second (a seek, a stall). Its length is read again
  // each frame: WebKit first guesses a file's length and corrects it at the end without an event.
  useEffect(() => {
    if (paused) return;
    const start = audio.current?.currentTime ?? 0;
    let clock: { at: number; pos: number } | undefined;
    let frame = requestAnimationFrame(function tick(now) {
      const a = audio.current;
      if (a) {
        const reported = a.currentTime;
        if (!clock && reported !== start) clock = { at: now, pos: reported };
        const counted = clock ? clock.pos + ((now - clock.at) / 1000) * a.playbackRate : start;
        if (clock && Math.abs(counted - reported) > 0.35) clock = { at: now, pos: reported };
        const length = Number.isFinite(a.duration) ? a.duration : Number.POSITIVE_INFINITY;
        const shown = clock ? clock.pos + ((now - clock.at) / 1000) * a.playbackRate : start;
        setTime(Math.min(length, shown));
        setDuration(a.duration);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [paused]);
  useEffect(() => () => audio.current?.pause(), []);

  const el = () => audio.current as HTMLAudioElement;
  const seek = (to: number) => {
    const target = Math.min(Math.max(0, to), Number.isFinite(duration) ? duration : to);
    el().currentTime = target;
    setTime(target);
  };
  const toggle = () => {
    const a = el();
    if (a.paused) {
      if (a.ended) a.currentTime = 0;
      void a.play().catch(() => setFailed(true));
    } else a.pause();
  };
  const shown = dragging ?? time;
  const max = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const button = (
    <button
      type="button"
      onClick={toggle}
      disabled={failed}
      aria-label={paused ? t("player.play", { what: label }) : t("player.pause")}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40",
        compact ? "size-11" : "size-12",
      )}
    >
      {paused ? (
        <Play className={cn("translate-x-px fill-current", compact ? "size-4" : "size-5")} />
      ) : (
        <Pause className={cn("fill-current", compact ? "size-4" : "size-5")} />
      )}
    </button>
  );
  const speed = <SpeedButton />;
  const back = (
    <button
      type="button"
      onClick={() => seek(el().currentTime - 5)}
      disabled={failed}
      aria-label={t("player.back")}
      className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg hover:bg-accent"
    >
      <RotateCcw className="size-4" />
    </button>
  );
  const timeline = failed ? (
    <p className="flex-1 text-sm text-muted-foreground">{t("player.unavailable")}</p>
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 text-xs tabular-nums text-muted-foreground">
      <span className="w-9 text-end">{clock(shown)}</span>
      <Slider
        aria-label={t("player.position")}
        value={[Math.min(shown, max)]}
        max={max}
        step={0.05}
        disabled={!Number.isFinite(duration)}
        onValueChange={([v]) => setDragging(v)}
        onValueCommit={([v]) => {
          setDragging(undefined);
          if (v !== undefined) seek(v);
        }}
        onKeyDownCapture={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          e.stopPropagation();
          seek(el().currentTime + (e.key === "ArrowRight" ? 5 : -5));
        }}
      />
      <span className="w-10">
        −{clock(Number.isFinite(duration) ? duration - shown : Number.NaN)}
      </span>
    </div>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of player controls, not a fieldset of a form
    <div
      role="group"
      aria-label={label}
      className={cn(
        panelClass,
        "flex w-full items-center gap-3",
        compact ? "p-1.5 pe-1" : "p-3",
        className,
      )}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: course audio comes without captions */}
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          e.currentTarget.playbackRate = rate;
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          // While it plays, the frames above move the thumb; a report here would pull it back.
          if (e.currentTarget.paused) setTime(e.currentTarget.currentTime);
        }}
        onPlay={(e) => {
          claimPlayback(e.currentTarget);
          setPaused(false);
          onHeard?.();
        }}
        onPause={() => setPaused(true)}
        onEnded={(e) => {
          // At its end, its true length (WebKit's guess corrected without an event) and all of it.
          setDuration(e.currentTarget.duration);
          setTime(e.currentTarget.duration);
          setPaused(true);
        }}
        onError={() => {
          setFailed(true);
          onHeard?.();
        }}
      />
      {button}
      {compact ? (
        <>
          {timeline}
          {speed}
        </>
      ) : title ? (
        // A caption above: the controls beside it, the timeline under them.
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="me-auto truncate text-sm font-medium">{title}</p>
            {back}
            {speed}
          </div>
          {timeline}
        </div>
      ) : (
        // No caption: one row, as an item's player.
        <>
          {timeline}
          <div className="flex shrink-0 items-center">
            {back}
            {speed}
          </div>
        </>
      )}
    </div>
  );
}

/** What a screen can do with an AudioButton besides tapping it (a key that reads the word aloud). */
export interface AudioControls {
  /** Plays from the start. */
  play(): void;
}

/** A word read aloud: one tap plays it from the start. */
export function AudioButton({
  src,
  label,
  className,
  ref,
}: {
  src: string;
  label: string;
  className?: string;
  ref?: React.Ref<AudioControls>;
}) {
  const { rate } = useContext(PlaybackRate);
  const { t } = useTranslation();
  const { playing: active, failed, play, toggle } = useClip(src, rate);
  useImperativeHandle(ref, () => ({ play }));
  return (
    <button
      type="button"
      aria-label={failed ? `${label}: ${t("player.unavailable")}` : label}
      title={failed ? t("player.unavailable") : undefined}
      onClick={toggle}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full border bg-card text-foreground transition hover:bg-accent",
        active && "border-primary bg-primary text-primary-foreground",
        failed && "text-muted-foreground",
        className,
      )}
    >
      {failed ? (
        <VolumeX className="size-5" />
      ) : active ? (
        <Pause className="size-5" />
      ) : (
        <Volume2 className="size-5" />
      )}
    </button>
  );
}

/** The stimulus of an exercise or item: video, image and/or audio. */
export function MediaBlock({
  media,
  url,
  audioLabel,
  onHeard,
}: {
  media?: Media;
  url: (path: string) => string;
  audioLabel: string;
  /** Called once its audio or video has been played (or cannot be). */
  onHeard?: () => void;
}) {
  const episode = useContext(Episode);
  const film = usePlayable(media?.video && url(media.video));
  if (!media) return null;
  const episodeVideo = isEpisode(episode, media.video);
  return (
    <div className="my-3 space-y-3">
      {media.video && episodeVideo && <EpisodeVideo {...episode} url={url} onHeard={onHeard} />}
      {media.video && !episodeVideo && (
        // biome-ignore lint/a11y/useMediaCaption: course clips come without separate captions
        <video
          controls
          preload="metadata"
          src={film}
          // Its own still, else a frame a moment in (`peek`).
          poster={media.poster && url(media.poster)}
          onPlay={(e) => {
            peek.play(e.currentTarget);
            claimPlayback(e.currentTarget);
            onHeard?.();
          }}
          onLoadedMetadata={(e) => !media.poster && peek.loaded(e.currentTarget)}
          onSeeked={(e) => peek.seeked(e.currentTarget)}
          onError={onHeard}
          className="w-full rounded-xl bg-black"
        />
      )}
      {media.image && <img src={url(media.image)} alt="" className="max-h-72 w-auto rounded-xl" />}
      {media.audio && <AudioPlayer src={url(media.audio)} label={audioLabel} onHeard={onHeard} />}
    </div>
  );
}

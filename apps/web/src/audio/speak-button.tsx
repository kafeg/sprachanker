// The speaker button: reads a text aloud with the profile's voices, a second tap stops it. In
// the corner of an AI message, beside an AI example, and in a card's corner for a word without a
// recording (there, `ref` lets the reviewer replay and autoplay it like a recording). Not shown where
// the device cannot read the text's language.
import { Square, Volume2 } from "lucide-react";
import { useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import type { AudioControls } from "@/ui/media.tsx";
import { cn } from "@/ui/utils.ts";
import type { SpokenPart } from "./speak.ts";
import { readingId, useSpeaker } from "./speaker.ts";

export function SpeakButton({
  parts,
  label,
  className,
  ref,
}: {
  parts: SpokenPart[];
  /** What is read, for screen readers ("Read aloud: …" is said around it); by default the text read. */
  label?: string;
  className?: string;
  ref?: React.Ref<AudioControls>;
}) {
  const { t } = useTranslation();
  const speaker = useSpeaker();
  const readable = parts.filter((p) => speaker.canRead(p.lang));
  // Known by what it reads: a line read at once shows its button as reading.
  const id = readingId(readable);
  const reading = speaker.reading === id;
  useImperativeHandle(ref, () => ({ play: () => void speaker.say(id, readable) }));
  if (!speaker.available || !readable.length) return null;
  return (
    <button
      type="button"
      aria-label={
        reading
          ? t("speech.read.stop")
          : t("speech.read.listen", { what: label ?? readable.map((p) => p.text).join(" ") })
      }
      aria-pressed={reading}
      onClick={() => (reading ? speaker.stop() : void speaker.say(id, readable))}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground pointer-coarse:size-11",
        reading &&
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        className,
      )}
    >
      {reading ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
    </button>
  );
}

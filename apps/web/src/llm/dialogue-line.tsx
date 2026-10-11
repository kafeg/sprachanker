// The learner's next line in a Dialogue (08, "A Dialogue held by voice"; 09): the microphone — a tap
// records, another stops —, then what was heard, sent as heard or said again (never edited). Where
// nothing can hear it (no microphone, no recognition) the line is typed, with a line why.
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSpeechHost } from "@/audio/context.ts";
import { MicButton, micProblem } from "@/audio/mic-button.tsx";
import { micState, type Take, useRecorder } from "@/audio/recorder.ts";
import { TakeButton } from "@/audio/take-button.tsx";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { ChatComposer } from "./parts.tsx";

/** A line as sent: as heard with its take, or typed. */
export interface DialogueLineInput {
  text: string;
  spoken?: boolean;
  recording?: string;
}

/** A take heard: its text and where it plays from; kept as a recording when that worked. */
interface Heard {
  text: string;
  url: string;
  recording?: string;
}

export function DialogueLine({
  lang,
  busy,
  onSend,
}: {
  /** The language spoken (never detected, 08). */
  lang: string;
  /** A line is on its way: nothing more is sent meanwhile. */
  busy: boolean;
  onSend(line: DialogueLineInput): void;
}) {
  const { t } = useTranslation();
  const host = useSpeechHost();
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState<Heard>();
  const [hearing, setHearing] = useState(false);
  const [unheard, setUnheard] = useState(false);
  /** The latest take's number: an older one heard late is dropped. */
  const latest = useRef(0);
  useEffect(() => host?.warm(), [host]);
  useEffect(() => () => void (heard && URL.revokeObjectURL(heard.url)), [heard]);

  const recorder = useRecorder({
    onTake: async (take: Take) => {
      if (!host) return;
      const n = ++latest.current;
      setHearing(true);
      setUnheard(false);
      const [recording, text] = await Promise.all([
        host.save(take).catch(() => undefined),
        host.transcribe(take, lang).catch(() => ""),
      ]);
      if (latest.current !== n) return;
      setHearing(false);
      if (!text.trim()) setUnheard(true);
      else
        setHeard({
          text: text.trim(),
          url: URL.createObjectURL(take.blob),
          ...(recording && { recording }),
        });
    },
  });

  const problem = micProblem(micState(), recorder.state);
  if (!host?.recognition || problem)
    return (
      <div className="space-y-1">
        <p className="px-4 pt-3 text-sm text-muted-foreground">
          {problem ? t(problem) : t("scene.noRecognition")} {t("scene.typeInstead")}
        </p>
        <ChatComposer
          lang={lang}
          value={typed}
          onChange={setTyped}
          onSend={() => {
            if (!typed.trim() || busy) return;
            onSend({ text: typed.trim() });
            setTyped("");
          }}
          placeholder={t("scene.placeholder")}
        />
      </div>
    );

  const again = () => {
    setHeard(undefined);
    void recorder.start();
  };
  const recording = recorder.state === "recording";
  return (
    <div className="flex flex-col items-center gap-2 border-t p-4" aria-live="polite">
      {heard && !recording ? (
        <>
          <p className="text-sm text-muted-foreground">{t("speech.heard")}</p>
          <p {...inLang(lang)} className="text-center text-lg">
            {heard.text}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <TakeButton src={heard.url} label={t("speech.mine")} />
            <Button variant="outline" disabled={busy} onClick={again}>
              {t("scene.again")}
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                onSend({ text: heard.text, spoken: true, recording: heard.recording });
                setHeard(undefined);
              }}
            >
              <Send className="size-4 rtl:-scale-x-100" /> {t("tutor.send")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <MicButton
            recorder={recorder.state}
            level={recorder.level}
            waiting={busy ? "scene.waitPartner" : undefined}
            onStart={() => void recorder.start()}
            onStop={recorder.stop}
          />
          <p className="text-center text-sm text-muted-foreground">
            {recording
              ? t("speech.recording")
              : hearing
                ? t("speech.listening")
                : unheard
                  ? t("speech.notHeardShort")
                  : t("speech.howTo")}
          </p>
        </>
      )}
    </div>
  );
}

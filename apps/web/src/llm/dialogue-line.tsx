// The learner's next line in a Dialogue: the microphone — a tap
// records, another stops —, then what was heard, sent as heard or said again (never edited), kept
// until it is stored (a send that failed is sent again). Where nothing can hear it (no microphone, no
// recognition) the line is typed, with a line why. An exam's part whose time ran out takes the line
// as it is (`keepAtOnce`): a take heard is sent as heard, a line typed as typed.
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSpeechHost } from "@/audio/context.ts";
import { MicButton, micProblem } from "@/audio/mic-button.tsx";
import { heardNothing, micState, type Take, useRecorder } from "@/audio/recorder.ts";
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

/** Where the line is: nothing yet (or nothing heard), a take recording, being heard, heard and
 *  waiting to be sent. */
export type LineState = "idle" | "recording" | "hearing" | "heard";

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
  maxMs,
  sendLabel,
  onState,
  keepAtOnce = false,
}: {
  /** The language spoken (never detected). */
  lang: string;
  /** A line is on its way: nothing more is sent meanwhile. */
  busy: boolean;
  /** Sends the line; `sent` once it is stored (the line is kept here until then, to send again). */
  onSend(line: DialogueLineInput, sent: () => void): void;
  /** The longest take (a monologue's: a minute), the recorder's own otherwise. */
  maxMs?: number;
  /** What sending is called here (Speaking's: the line kept until Check). */
  sendLabel?: string;
  /** Where the line is, as it changes (an exam's part times the learner's turn by it). */
  onState?(state: LineState): void;
  /** Sends what there is at once — a take heard, a line typed —, with no choice to say it again. */
  keepAtOnce?: boolean;
}) {
  const { t } = useTranslation();
  const host = useSpeechHost();
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState<Heard>();
  const [hearing, setHearing] = useState(false);
  const [unheard, setUnheard] = useState<"silent" | "unclear">();
  /** The latest take's number: an older one heard late is dropped. */
  const latest = useRef(0);
  useEffect(() => host?.warm(), [host]);
  useEffect(() => () => void (heard && URL.revokeObjectURL(heard.url)), [heard]);

  const recorder = useRecorder({
    ...(maxMs && { maxMs }),
    onTake: async (take: Take) => {
      if (!host) return;
      const n = ++latest.current;
      // Nothing loud in it: neither kept nor heard, said again.
      if (heardNothing(take)) return setUnheard("silent");
      setHearing(true);
      setUnheard(undefined);
      // Kept and heard side by side; a take nothing was heard in (only what silence and noise are
      // heard as), or not heard, is forgotten: a line is what was heard.
      const [recording, text] = await Promise.all([
        host.save(take).catch(() => undefined),
        host.transcribe(take, lang).then(
          (heard) => heard.trim(),
          () => undefined,
        ),
      ]);
      if (!text && recording) host.forget?.(recording);
      if (latest.current !== n) return;
      setHearing(false);
      if (!text) setUnheard(text === "" ? "silent" : "unclear");
      else
        setHeard({
          text: text.trim(),
          url: URL.createObjectURL(take.blob),
          ...(recording && { recording }),
        });
    },
  });

  const problem = micProblem(micState(), recorder.state);
  const typing = !host?.recognition || !!problem;
  // A line typed and not sent yet is one waiting to be sent, as a take heard is.
  const state: LineState =
    recorder.state === "recording"
      ? "recording"
      : hearing
        ? "hearing"
        : heard || (typing && typed.trim())
          ? "heard"
          : "idle";
  // biome-ignore lint/correctness/useExhaustiveDependencies: told as it changes, not as the callback does
  useEffect(() => onState?.(state), [state]);
  const sendHeard = (h: Heard) =>
    onSend({ text: h.text, spoken: true, recording: h.recording }, () =>
      setHeard((now) => (now === h ? undefined : now)),
    );
  const sendTyped = () => {
    if (!typed.trim() || busy) return;
    onSend({ text: typed.trim() }, () => setTyped(""));
  };
  // Taken as it is: a take being recorded stopped (then heard), what was heard, or typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once as it comes, by what there is then
  useEffect(() => {
    if (!keepAtOnce || busy) return;
    if (recorder.state === "recording") recorder.stop();
    else if (heard) sendHeard(heard);
    else if (typing) sendTyped();
  }, [keepAtOnce, heard, busy, recorder.state]);
  if (typing)
    return (
      <div className="space-y-1">
        <p className="px-4 pt-3 text-sm text-muted-foreground">
          {problem ? t(problem) : t("scene.noRecognition")} {t("scene.typeInstead")}
        </p>
        <ChatComposer
          lang={lang}
          value={typed}
          onChange={setTyped}
          onSend={sendTyped}
          placeholder={t("scene.placeholder")}
          sendLabel={sendLabel}
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
      {heard && !recording && !busy ? (
        <>
          <p className="text-sm text-muted-foreground">{t("speech.heard")}</p>
          <p {...inLang(lang)} className="text-center text-lg">
            {heard.text}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <TakeButton src={heard.url} label={t("speech.mine")} />
            <Button variant="outline" onClick={again}>
              {t("scene.again")}
            </Button>
            <Button onClick={() => sendHeard(heard)}>
              <Send className="size-4 rtl:-scale-x-100" /> {sendLabel ?? t("tutor.send")}
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
              : recorder.state === "starting"
                ? t("speech.micStarting")
                : hearing
                  ? t("speech.listening")
                  : unheard === "silent"
                    ? t("speech.nothingHeard")
                    : unheard
                      ? t("speech.notHeardShort")
                      : t("speech.howTo")}
          </p>
        </>
      )}
    </div>
  );
}

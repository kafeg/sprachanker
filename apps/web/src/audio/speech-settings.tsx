// Settings → Speech: the microphone of this device (which one, a test with its level and the
// take played back; why it cannot be used, if so), recognition (on or off, its models, how speaking
// works) and reading aloud (read-aloud-settings.tsx). The recordings kept are in General → Storage.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { inPhoneApp } from "@/api/client.ts";
import { useSetSetting, useSetting } from "@/api/settings.ts";
import { useSpeechModels, useSpeechState } from "@/api/speech.ts";
import { CheckRow } from "@/ui/check-row.tsx";
import { Button } from "@/ui/components/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { Panel } from "@/ui/panel.tsx";
import { DownloadRow } from "./download-row.tsx";
import { InUse } from "./in-use.tsx";
import { MicButton, micProblem } from "./mic-button.tsx";
import { ReadAloud } from "./read-aloud-settings.tsx";
import { micDevice, micState, useRecorder } from "./recorder.ts";
import { TakeButton } from "./take-button.tsx";

/** A microphone test lasts this long. */
const TEST_MS = 3000;
const DEFAULT = "default";

function Microphone() {
  const { t } = useTranslation();
  const recorder = useRecorder({
    maxMs: TEST_MS,
    onTake: (recorded) => setTake(URL.createObjectURL(recorded.blob)),
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState(micDevice.get() ?? DEFAULT);
  const [take, setTake] = useState<string>();
  const problem = micProblem(micState(), recorder.state);
  // Names come once the microphone was allowed: read again after a test.
  const list = () =>
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId)))
      .catch(() => setDevices([]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, and after each take
  useEffect(list, [take]);
  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take);
    },
    [take],
  );

  return (
    <Panel title={t("speech.settings.mic")}>
      <div className="mt-2 space-y-3">
        {problem ? (
          <p className="text-sm text-muted-foreground">{t(problem)}</p>
        ) : (
          devices.length > 1 && (
            <Select
              value={device}
              onValueChange={(id) => {
                setDevice(id);
                micDevice.set(id === DEFAULT ? undefined : id);
              }}
            >
              <SelectTrigger
                className="h-11 w-full max-w-sm bg-card"
                aria-label={t("speech.settings.device")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>{t("speech.settings.defaultDevice")}</SelectItem>
                {devices
                  .filter((d) => d.deviceId !== DEFAULT)
                  .map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || t("speech.settings.unnamedDevice")}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )
        )}
        <div className="flex flex-wrap items-center gap-4">
          <MicButton
            recorder={recorder.state}
            level={recorder.level}
            onStart={() => void recorder.start()}
            onStop={recorder.stop}
          />
          <div className="min-w-40 flex-1 space-y-1">
            <p className="text-sm">
              {recorder.state === "recording"
                ? t("speech.settings.testing")
                : recorder.state === "starting"
                  ? t("speech.micStarting")
                  : t("speech.settings.testHint")}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-correct transition-[width]"
                style={{ width: `${Math.round(recorder.level * 100)}%` }}
              />
            </div>
          </div>
          {take && <TakeButton src={take} label={t("speech.settings.listen")} />}
        </div>
      </div>
    </Panel>
  );
}

/** Recognition: on or off for this profile, and the models — size, download with its progress,
 *  removal, which one is used. The engine itself is built with the app (native/). */
function Recognition() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const state = useSpeechState();
  const models = useSpeechModels();
  const on = useSetting("speech.recognition");
  const data = state.data;
  return (
    <Panel title={t("speech.settings.recognition")}>
      <div className="mt-2 space-y-4">
        <p className="text-sm text-muted-foreground">{t("speech.settings.recognitionHint")}</p>
        {data && !data.engine ? (
          <p className="text-sm">{t("speech.settings.noEngine")}</p>
        ) : (
          <>
            <CheckRow
              checked={on}
              onChange={(value) => set.mutate({ key: "speech.recognition", value })}
              title={t("speech.settings.recognitionOn")}
            />
            <ul className="space-y-2">
              {/* The phone app's models come with its setup: only those there. */}
              {(data?.models ?? [])
                .filter((m) => !inPhoneApp || m.installed)
                .map((m) => {
                  const chosen = data?.model === m.id;
                  return (
                    <DownloadRow
                      key={m.id}
                      title={t(`speech.model.${m.id}`)}
                      item={m}
                      removeLabel={t("speech.settings.removeModel")}
                      onDownload={() => models.download.mutate(m.id)}
                      onRemove={() => models.remove.mutate(m.id)}
                      starting={models.download.isPending && models.download.variables === m.id}
                      marked={chosen && on}
                    >
                      {chosen && on && <InUse />}
                      {!chosen && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => set.mutate({ key: "speech.model", value: m.id })}
                        >
                          {t("speech.settings.use")}
                        </Button>
                      )}
                    </DownloadRow>
                  );
                })}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}

/** How speaking works where it is not a setting: the microphone tapped, the phrase hidden until the
 *  first try, recordings kept. */
function HowSpeaking() {
  const { t } = useTranslation();
  return (
    <Panel title={t("speech.settings.how")}>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
        {(["howMic", "howPhrase", "howRecordings"] as const).map((k) => (
          <li key={k}>{t(`speech.settings.${k}`)}</li>
        ))}
      </ul>
    </Panel>
  );
}

/** Hearing and speaking: the microphone, recognition and reading aloud — the onboarding's speech step
 *  and Settings → Speech. */
export function SpeechSetup() {
  return (
    <div className="space-y-6">
      <Microphone />
      <Recognition />
      {/* The phone's WebView has no voices to read with; the courses' and practice's own play. */}
      {!inPhoneApp && <ReadAloud />}
      <HowSpeaking />
    </div>
  );
}

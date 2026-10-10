// Settings → Speech (08; 09): the microphone of this device (which one, a test with its level and the
// take played back; why it cannot be used, if so), recognition (on or off, its models), reading aloud
// (read-aloud-settings.tsx), whether recordings are kept and the recordings kept — how many, their
// size, all deleted after asking; under Advanced: tap or hold to talk, how the phrase to repeat is
// shown, what is read aloud at once.
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteRecordings, useRecordingStats } from "@/api/recordings.ts";
import { useSetSetting, useSetting } from "@/api/settings.ts";
import { useSpeechModels, useSpeechState } from "@/api/speech.ts";
import { CheckRow } from "@/ui/check-row.tsx";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { Disclosure } from "@/ui/disclosure.tsx";
import { useBytes, useNumber } from "@/ui/format.ts";
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

/** Recognition (08): on or off for this profile, and the models — size, download with its progress,
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
              {(data?.models ?? []).map((m) => {
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

function Recordings() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const stats = useRecordingStats();
  const remove = useDeleteRecordings();
  const bytes = useBytes();
  const count = useNumber();
  const [asking, setAsking] = useState(false);
  const keep = useSetting("speech.keepRecordings");
  return (
    <Panel title={t("speech.settings.recordings")}>
      <div className="mt-2 space-y-4">
        <CheckRow
          checked={keep}
          onChange={(value) => set.mutate({ key: "speech.keepRecordings", value })}
          title={t("speech.settings.keep")}
          hint={t("speech.settings.keepHint")}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            {stats.data
              ? t("speech.settings.kept", {
                  count: stats.data.count,
                  n: count(stats.data.count),
                  size: bytes(stats.data.bytes),
                })
              : "…"}
          </span>
          {!!stats.data?.count && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setAsking(true)}>
              <Trash2 className="size-4" /> {t("speech.settings.deleteAll")}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("speech.settings.deleteTitle")}
        description={t("speech.settings.deleteBody")}
        confirm={t("speech.settings.deleteAll")}
        cancel={t("common.cancel")}
        busy={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setAsking(false) })}
      />
    </Panel>
  );
}

/** Hearing and speaking: the microphone, recognition and reading aloud — the onboarding's speech step
 *  and the head of Settings → Speech. */
export function SpeechSetup() {
  return (
    <div className="space-y-6">
      <Microphone />
      <Recognition />
      <ReadAloud />
    </div>
  );
}

/** What is rarely changed: how the microphone beside a text box listens, when the phrase to repeat is
 *  shown, and what is read aloud at once. */
function Advanced() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const pushToTalk = useSetting("speech.pushToTalk");
  const show = useSetting("speech.showText");
  const atOnce = useSetting("speech.readAtOnce");
  const option = (label: string, choice: React.ReactNode) => (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {choice}
    </div>
  );
  return (
    <Disclosure title={t("settings.advanced")}>
      <Panel>
        <div className="space-y-4">
          {option(
            t("speech.settings.pushToTalk"),
            <Choice
              value={pushToTalk}
              options={(["tap", "hold"] as const).map((v) => [v, t(`speech.settings.talk.${v}`)])}
              onChange={(value) => set.mutate({ key: "speech.pushToTalk", value })}
            />,
          )}
          {option(
            t("speech.settings.showText"),
            <Choice
              value={show}
              options={(["after", "always"] as const).map((v) => [
                v,
                t(`speech.settings.show.${v}`),
              ])}
              onChange={(value) => set.mutate({ key: "speech.showText", value })}
            />,
          )}
          {option(
            t("speech.settings.atOnce"),
            <Choice
              value={atOnce}
              options={(["none", "scenes", "all"] as const).map((v) => [
                v,
                t(`speech.settings.atOnceOption.${v}`),
              ])}
              onChange={(value) => set.mutate({ key: "speech.readAtOnce", value })}
            />,
          )}
        </div>
      </Panel>
    </Disclosure>
  );
}

/** Settings → Speech: the setup, the recordings kept, then what is rarely changed. */
export function SpeechSettings() {
  return (
    <div className="space-y-6">
      <SpeechSetup />
      <Recordings />
      <Advanced />
    </div>
  );
}

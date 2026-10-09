// Settings → Speech (08; 09): the microphone of this device (which one, a test with its level and the
// take played back; why it cannot be used, if so), recognition (on or off, its models), whether
// reading aloud (read-aloud-settings.tsx), whether recordings are kept, how the phrase to repeat is
// shown, and the recordings kept — how many, their size, all deleted after asking.
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteRecordings,
  useRecordingStats,
  useSetSetting,
  useSetting,
  useSpeechModels,
  useSpeechState,
} from "@/api/hooks.ts";
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
import { useBytes, useNumber, usePercent } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
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
  const bytes = useBytes();
  const percent = usePercent();
  const on = useSetting("speech.recognition");
  const pushToTalk = useSetting("speech.pushToTalk");
  const data = state.data;
  return (
    <Panel title={t("speech.settings.recognition")}>
      <div className="mt-2 space-y-4">
        <p className="text-sm text-muted-foreground">{t("speech.settings.recognitionHint")}</p>
        {data && !data.engine ? (
          <p className="text-sm">{t("speech.settings.noEngine")}</p>
        ) : (
          <>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={on}
                onChange={(e) => set.mutate({ key: "speech.recognition", value: e.target.checked })}
              />
              {t("speech.settings.recognitionOn")}
            </label>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("speech.settings.pushToTalk")}</p>
              <Choice
                value={pushToTalk}
                options={(["tap", "hold"] as const).map((v) => [v, t(`speech.settings.talk.${v}`)])}
                onChange={(value) => set.mutate({ key: "speech.pushToTalk", value })}
              />
            </div>
            <ul className="space-y-2">
              {(data?.models ?? []).map((m) => {
                const downloading = "downloaded" in m ? (m.downloaded as number) : undefined;
                const chosen = data?.model === m.id;
                return (
                  <li
                    key={m.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-xl border p-3",
                      m.installed && chosen && on && "border-primary",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t(`speech.model.${m.id}`)}</span>
                      <span className="text-xs text-muted-foreground">
                        {bytes(m.bytes)}
                        {"error" in m && ` · ${t("speech.settings.downloadFailed")}`}
                      </span>
                    </span>
                    {downloading !== undefined ? (
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {percent(downloading / m.bytes)}
                      </span>
                    ) : m.installed ? (
                      <>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("speech.settings.removeModel")}
                          onClick={() => models.remove.mutate(m.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => models.download.mutate(m.id)}
                        loading={models.download.isPending && models.download.variables === m.id}
                      >
                        {t("speech.settings.download")}
                      </Button>
                    )}
                  </li>
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
  const show = useSetting("speech.showText");
  return (
    <Panel title={t("speech.settings.recordings")}>
      <div className="mt-2 space-y-4">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={keep}
            onChange={(e) => set.mutate({ key: "speech.keepRecordings", value: e.target.checked })}
          />
          <span>
            {t("speech.settings.keep")}
            <span className="block text-xs text-muted-foreground">
              {t("speech.settings.keepHint")}
            </span>
          </span>
        </label>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("speech.settings.showText")}</p>
          <Choice
            value={show}
            options={(["after", "always"] as const).map((v) => [v, t(`speech.settings.show.${v}`)])}
            onChange={(value) => set.mutate({ key: "speech.showText", value })}
          />
        </div>
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

/** The onboarding's speech step: the microphone test and recognition (the rest stays in Settings). */
export function SpeechSetup() {
  return (
    <div className="space-y-6">
      <Microphone />
      <Recognition />
    </div>
  );
}

export function SpeechSettings() {
  return (
    <div className="space-y-6">
      <Microphone />
      <Recognition />
      <ReadAloud />
      <Recordings />
    </div>
  );
}

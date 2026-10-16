// Settings → Speech → Read aloud: the engine as cards — the device's voices, Piper or Qwen3-TTS run by
// the app — offered on every system, the learner's choice (owner, 2026-10-16); the chosen engine's
// voices (device-voices, piper-voices, qwen-voices), the voice for words (word-voice: it reads words
// whichever engine reads the rest), and the speed (Qwen3-TTS has none of its own). What the chosen
// engine cannot read, the device's voices read.
import { Cpu, Laptop, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { inPhoneApp } from "@/api/client.ts";
import { useSetSetting, useSetting } from "@/api/settings.ts";
import { usePiperVoices, useQwenTts } from "@/api/speech.ts";
import { Slider } from "@/ui/components/slider.tsx";
import { useNumber } from "@/ui/format.ts";
import { OptionCard } from "@/ui/option-card.tsx";
import { Panel } from "@/ui/panel.tsx";
import { DeviceVoices } from "./device-voices.tsx";
import { PiperVoices } from "./piper-voices.tsx";
import { QwenVoices } from "./qwen-voices.tsx";
import { useReadLanguages } from "./read-languages.ts";
import { stop, useDeviceVoices } from "./speaker.ts";
import type { Engine } from "./voice-pick.tsx";
import { WordVoices } from "./word-voice.tsx";

export function ReadAloud() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const number = useNumber();
  const voices = useDeviceVoices();
  const engine = useSetting("speech.readEngine");
  const piper = usePiperVoices().data;
  const qwen = useQwenTts().data;
  const rate = useSetting("speech.readRate");
  const langs = useReadLanguages();
  const [shownRate, setShownRate] = useState<number>();
  const device = typeof speechSynthesis !== "undefined" && voices.length > 0;
  const piperReady = piper?.voices.filter((v) => v.installed).length ?? 0;
  const choose = (id: Engine) => () => set.mutate({ key: "speech.readEngine", value: id });
  return (
    <Panel title={t("speech.settings.read")}>
      <div className="mt-2 space-y-4">
        <p className="text-sm text-muted-foreground">{t("speech.settings.readHint")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <OptionCard
            icon={Laptop}
            title={t("speech.settings.engine.device")}
            line={
              device
                ? t("speech.settings.engine.deviceLine", {
                    count: voices.length,
                    n: number(voices.length),
                  })
                : t("speech.settings.engine.deviceNone")
            }
            chosen={engine === "device"}
            onChoose={choose("device")}
          />
          <OptionCard
            icon={Cpu}
            title={t("speech.settings.engine.piper")}
            line={
              !piper?.engine
                ? t("speech.settings.engine.piperMissing")
                : t("speech.settings.engine.piperLine", {
                    count: piperReady,
                    n: number(piperReady),
                  })
            }
            chosen={engine === "piper"}
            disabled={!piper?.engine}
            onChoose={choose("piper")}
          />
          <OptionCard
            icon={Sparkles}
            title={t("speech.settings.engine.qwen")}
            line={
              !qwen?.engine
                ? t("speech.settings.engine.qwenMissing")
                : qwen.models.some((m) => m.installed)
                  ? t("speech.settings.engine.qwenReady")
                  : t("speech.settings.engine.qwenNoModel")
            }
            chosen={engine === "qwen"}
            disabled={!qwen?.engine}
            onChoose={choose("qwen")}
          />
        </div>
        {engine === "qwen" && qwen?.engine ? (
          <>
            {/* Slower on a phone, never off there (owner, 2026-10-16): said, the choice the learner's. */}
            {inPhoneApp && (
              <p className="text-sm text-muted-foreground">{t("speech.settings.qwenOnPhone")}</p>
            )}
            <QwenVoices state={qwen} langs={langs} />
          </>
        ) : engine === "piper" && piper?.engine ? (
          <PiperVoices state={piper} langs={langs} />
        ) : (
          device && <DeviceVoices langs={langs} />
        )}
        {/* Qwen3-TTS has no speed of its own: the setting is not shown with it. */}
        {!(engine === "qwen" && qwen?.engine) && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              {t("speech.settings.readRate", { rate: number(shownRate ?? rate) })}
            </p>
            <Slider
              className="max-w-sm"
              aria-label={t("speech.settings.readRateLabel")}
              min={0.5}
              max={1.5}
              step={0.1}
              value={[shownRate ?? rate]}
              onValueChange={([v]) => setShownRate(v)}
              onValueCommit={([v]) => {
                setShownRate(undefined);
                stop();
                if (v !== undefined)
                  set.mutate({ key: "speech.readRate", value: Math.round(v * 10) / 10 });
              }}
            />
          </div>
        )}
        {qwen?.engine && <WordVoices state={qwen} langs={langs} />}
      </div>
    </Panel>
  );
}

// Settings → Speech → Read aloud (08; 09): the engine as cards (the device's voices for now), the voice
// of each of the profile's languages with "Listen" (automatic: the best one the device has), the
// speed, and what is read at once.
import { Laptop, Volume2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSetting } from "@/api/hooks.ts";
import { languageName } from "@/i18n/index.ts";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { Slider } from "@/ui/components/slider.tsx";
import { useNumber } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { bestVoice, speaks } from "./speak.ts";
import { deviceVoice, read, stop, useDeviceVoices, voiceInfo } from "./speaker.ts";

const AUTO = "auto";

/** One language's voice: automatic (the best there is) or one the learner picks, and "Listen". */
function VoiceRow({ lang }: { lang: string }) {
  const { t, i18n } = useTranslation();
  const set = useSetSetting();
  const voices = useDeviceVoices();
  const chosen = useSetting("speech.voices");
  const rate = useSetting("speech.readRate");
  const own = chosen?.device ?? {};
  const mine = voices.filter((v) => speaks(voiceInfo(v), lang));
  const best = bestVoice(mine.map(voiceInfo), lang);
  const value = own[lang] && mine.some((v) => v.voiceURI === own[lang]) ? own[lang] : AUTO;
  const name = languageName(lang, i18n.language, true);
  const choose = (id: string) => {
    const device = { ...own };
    if (id === AUTO) delete device[lang];
    else device[lang] = id;
    set.mutate({ key: "speech.voices", value: { ...chosen, device } });
  };
  const listen = () => {
    const voice = deviceVoice(voices, own, lang);
    // The voice says its language's name in that language ("Deutsch (Deutschland)").
    const sample = voice
      ? languageName(voice.lang.replace("_", "-"), voice.lang.replace("_", "-"), true)
      : name;
    void read(`listen:${lang}`, [{ text: sample, lang }], { voiceFor: () => voice, rate });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span className="w-28 text-sm font-medium">{name}</span>
      {mine.length ? (
        <>
          <Select value={value} onValueChange={choose}>
            <SelectTrigger
              className="min-w-56 flex-1"
              aria-label={t("speech.settings.voiceFor", { language: name })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>
                {t("speech.settings.voiceAuto", { name: best?.name ?? "" })}
              </SelectItem>
              {mine.map((v) => (
                <SelectItem key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={listen}>
            <Volume2 className="size-4" /> {t("speech.settings.listen")}
          </Button>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">
          {t("speech.settings.noVoice", { language: name })}
        </span>
      )}
    </div>
  );
}

export function ReadAloud() {
  const { t, i18n } = useTranslation();
  const set = useSetSetting();
  const number = useNumber();
  const voices = useDeviceVoices();
  const rate = useSetting("speech.readRate");
  const atOnce = useSetting("speech.readAtOnce");
  const target = useSetting("learner.target");
  const native = useSetting("learner.native") ?? i18n.language;
  const [shownRate, setShownRate] = useState<number>();
  const langs = [...new Set([target, native].filter((l): l is string => !!l))];
  const can = typeof speechSynthesis !== "undefined";
  return (
    <Panel title={t("speech.settings.read")}>
      <div className="mt-2 space-y-4">
        <p className="text-sm text-muted-foreground">{t("speech.settings.readHint")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div
            aria-current="true"
            className="flex flex-col items-start gap-1 rounded-2xl border-2 border-primary bg-accent p-3"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Laptop className="size-4" /> {t("speech.settings.engine.device")}
            </span>
            <span className="text-xs text-muted-foreground">
              {can && voices.length
                ? t("speech.settings.engine.deviceLine", {
                    count: voices.length,
                    n: number(voices.length),
                  })
                : t("speech.settings.engine.deviceNone")}
            </span>
          </div>
        </div>
        {can && voices.length > 0 && (
          <>
            <div>
              {langs.map((lang) => (
                <VoiceRow key={lang} lang={lang} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("speech.settings.betterVoices")}</p>
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
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("speech.settings.atOnce")}</p>
              <Choice
                value={atOnce}
                options={(["none", "scenes", "all"] as const).map((v) => [
                  v,
                  t(`speech.settings.atOnceOption.${v}`),
                ])}
                onChange={(value) => set.mutate({ key: "speech.readAtOnce", value })}
              />
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

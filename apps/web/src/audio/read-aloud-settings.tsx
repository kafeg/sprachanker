// Settings → Speech → Read aloud (08; 09): the engine as cards — the device's voices, Piper or Qwen3-TTS
// on this computer — the voice of each of the profile's languages with "Listen" (automatic: the best one
// there), Piper's voices to download per language or Qwen3-TTS's models, the speed, and what is read
// at once.
import { Cpu, Download, Laptop, LoaderCircle, Sparkles, Trash2, Volume2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePiperVoiceActions,
  usePiperVoices,
  useQwenModelActions,
  useQwenTts,
  useSetSetting,
  useSetting,
} from "@/api/hooks.ts";
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
import { useBytes, useNumber, usePercent } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { bestVoice, speaks } from "./speak.ts";
import { deviceVoice, read, stop, useDeviceVoices, voiceInfo } from "./speaker.ts";

const AUTO = "auto";
type Engine = "device" | "piper" | "qwen";
type QwenState = NonNullable<ReturnType<typeof useQwenTts>["data"]>;
type PiperVoice = NonNullable<ReturnType<typeof usePiperVoices>["data"]>["voices"][number];
const QUALITY = ["x_low", "low", "medium", "high"];
/** A language's voices ranked: its main region first, then the best quality. */
const ranked = (voices: PiperVoice[], lang: string) => {
  let region: string | undefined;
  try {
    region = new Intl.Locale(lang).maximize().region;
  } catch {}
  return [...voices].sort(
    (a, b) =>
      Number(b.region === region) - Number(a.region === region) ||
      QUALITY.indexOf(b.quality) - QUALITY.indexOf(a.quality) ||
      a.name.localeCompare(b.name),
  );
};
/** The voice says its language's name in that language ("Deutsch (Deutschland)"). */
const sampleOf = (tag: string) => {
  const t = tag.replace("_", "-");
  return languageName(t, t, true);
};

/** The voice a profile chose for a language, with an engine, and how to change it. */
function useChoice(engine: Engine, lang: string) {
  const set = useSetSetting();
  const chosen = useSetting("speech.voices");
  const own = chosen?.[engine] ?? {};
  return {
    own,
    choose(id: string) {
      const next = { ...own };
      if (id === AUTO) delete next[lang];
      else next[lang] = id;
      set.mutate({ key: "speech.voices", value: { ...chosen, [engine]: next } });
    },
  };
}

/** A select of voices, automatic first, and "Listen". */
function VoicePick({
  lang,
  options,
  value,
  auto,
  onChange,
  onListen,
}: {
  lang: string;
  options: Array<{ id: string; name: string }>;
  value: string;
  auto: string;
  onChange(id: string): void;
  onListen(): void;
}) {
  const { t, i18n } = useTranslation();
  const name = languageName(lang, i18n.language, true);
  return (
    <>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="min-w-56 flex-1"
          aria-label={t("speech.settings.voiceFor", { language: name })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{t("speech.settings.voiceAuto", { name: auto })}</SelectItem>
          {options.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={onListen}>
        <Volume2 className="size-4" /> {t("speech.settings.listen")}
      </Button>
    </>
  );
}

/** One language with the device's voices. */
function DeviceVoiceRow({ lang }: { lang: string }) {
  const { t, i18n } = useTranslation();
  const voices = useDeviceVoices();
  const rate = useSetting("speech.readRate");
  const { own, choose } = useChoice("device", lang);
  const mine = voices.filter((v) => speaks(voiceInfo(v), lang));
  const name = languageName(lang, i18n.language, true);
  const value = own[lang] && mine.some((v) => v.voiceURI === own[lang]) ? own[lang] : AUTO;
  const listen = () => {
    const voice = deviceVoice(voices, own, lang);
    void read(`listen:${lang}`, [{ text: sampleOf(voice?.lang ?? lang), lang }], {
      wayFor: () => ({ device: voice, rate }),
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span className="w-28 text-sm font-medium">{name}</span>
      {mine.length ? (
        <VoicePick
          lang={lang}
          value={value}
          auto={bestVoice(mine.map(voiceInfo), lang)?.name ?? ""}
          options={mine.map((v) => ({ id: v.voiceURI, name: v.name }))}
          onChange={choose}
          onListen={listen}
        />
      ) : (
        <span className="text-sm text-muted-foreground">
          {t("speech.settings.noVoice", { language: name })}
        </span>
      )}
    </div>
  );
}

/** A Piper voice's name as the learner reads it: "thorsten · Germany · high quality". */
function usePiperName() {
  const { t, i18n } = useTranslation();
  const regions = new Intl.DisplayNames([i18n.language], { type: "region" });
  return (v: PiperVoice) =>
    [
      v.name.replace(/_/g, " "),
      regions.of(v.region) ?? v.region,
      t(`speech.settings.quality.${v.quality}`),
    ].join(" · ");
}

/** One language with Piper: the voice to read with, and its voices to download or remove. */
function PiperLanguage({ lang, voices }: { lang: string; voices: PiperVoice[] }) {
  const { t, i18n } = useTranslation();
  const actions = usePiperVoiceActions();
  const bytes = useBytes();
  const percent = usePercent();
  const nameOf = usePiperName();
  const { own, choose } = useChoice("piper", lang);
  const [all, setAll] = useState(false);
  const mine = ranked(
    voices.filter((v) => v.lang === lang),
    lang,
  );
  const installed = mine.filter((v) => v.installed);
  const name = languageName(lang, i18n.language, true);
  const value = own[lang] && installed.some((v) => v.id === own[lang]) ? own[lang] : AUTO;
  const shown = all ? mine : mine.slice(0, 4);
  const listen = () => {
    const voice = value === AUTO ? installed[0]?.id : value;
    void read(`listen:${lang}`, [{ text: sampleOf(lang), lang }], {
      wayFor: () => ({ server: { voice } }),
    });
  };
  return (
    <div className="space-y-2 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-sm font-medium">{name}</span>
        {installed.length ? (
          <VoicePick
            lang={lang}
            value={value}
            auto={installed[0] ? nameOf(installed[0]) : ""}
            options={installed.map((v) => ({ id: v.id, name: nameOf(v) }))}
            onChange={choose}
            onListen={listen}
          />
        ) : (
          <span className="text-sm text-muted-foreground">
            {mine.length
              ? t("speech.settings.piperNone", { language: name })
              : t("speech.settings.piperNoLanguage", { language: name })}
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="space-y-1 pl-0 sm:pl-31">
          {shown.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">
                {nameOf(v)}
                <span className="text-muted-foreground"> · {bytes(v.bytes)}</span>
                {"error" in v && v.error && (
                  <span className="block text-xs text-wrong">
                    {t("speech.settings.downloadFailed")}
                  </span>
                )}
              </span>
              {v.installed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("speech.settings.removeVoice", { voice: nameOf(v) })}
                  onClick={() => actions.remove.mutate(v.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : "downloaded" in v && v.downloaded !== undefined ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  {percent(v.downloaded / v.bytes)}
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => actions.download.mutate(v.id)}>
                  <Download className="size-4" /> {t("speech.settings.download")}
                </Button>
              )}
            </li>
          ))}
          {mine.length > shown.length && (
            <li>
              <Button variant="link" size="sm" className="px-0" onClick={() => setAll(true)}>
                {t("speech.settings.allVoices", { count: mine.length })}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A download in progress, or a button that starts or removes one. */
function DownloadState({
  item,
  label,
  onDownload,
  onRemove,
}: {
  item: { installed: boolean; bytes: number; downloaded?: number; error?: string };
  label: string;
  onDownload(): void;
  onRemove(): void;
}) {
  const { t } = useTranslation();
  const percent = usePercent();
  if (item.installed)
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("speech.settings.removeVoice", { voice: label })}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    );
  if (item.downloaded !== undefined)
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {percent(item.downloaded / item.bytes)}
      </span>
    );
  return (
    <Button variant="outline" size="sm" onClick={onDownload}>
      <Download className="size-4" /> {t("speech.settings.download")}
    </Button>
  );
}

/** Qwen3-TTS: its models to download (the large one used when both are there), and each language's
 *  speaker with "Listen". */
function QwenSection({ state, langs }: { state: QwenState; langs: string[] }) {
  const { t } = useTranslation();
  const actions = useQwenModelActions();
  const bytes = useBytes();
  const ready = state.models.some((m) => m.installed);
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-sm">
        {state.models.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              {t(`speech.settings.qwenModel.${m.id === "0.6b" ? "small" : "large"}`)}
              <span className="text-muted-foreground"> · {bytes(m.bytes)}</span>
              {m.inUse && (
                <span className="text-muted-foreground"> · {t("speech.settings.inUse")}</span>
              )}
              {"error" in m && m.error && (
                <span className="block text-xs text-wrong">
                  {t("speech.settings.downloadFailed")}
                </span>
              )}
            </span>
            <DownloadState
              item={m}
              label={t(`speech.settings.qwenModel.${m.id === "0.6b" ? "small" : "large"}`)}
              onDownload={() => actions.download.mutate(m.id)}
              onRemove={() => actions.remove.mutate(m.id)}
            />
          </li>
        ))}
      </ul>
      {ready && (
        <div>
          {langs.map((lang) => (
            <QwenLanguage key={lang} lang={lang} state={state} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("speech.settings.qwenHint")}</p>
    </div>
  );
}

/** One language with Qwen3-TTS: its speaker, and "Listen". */
function QwenLanguage({ lang, state }: { lang: string; state: QwenState }) {
  const { t, i18n } = useTranslation();
  const { own, choose } = useChoice("qwen", lang);
  const name = languageName(lang, i18n.language, true);
  const speaks = state.languages.includes(lang);
  const value =
    own[lang] && (state.speakers as readonly string[]).includes(own[lang]) ? own[lang] : AUTO;
  const speakerName = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const listen = () => {
    void read(`listen:${lang}`, [{ text: sampleOf(lang), lang }], {
      wayFor: () => ({ server: { voice: value === AUTO ? undefined : value } }),
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span className="w-28 text-sm font-medium">{name}</span>
      {speaks ? (
        <VoicePick
          lang={lang}
          value={value}
          auto={speakerName(state.speakerOf[lang] ?? "")}
          options={state.speakers.map((s) => ({ id: s, name: speakerName(s) }))}
          onChange={choose}
          onListen={listen}
        />
      ) : (
        <span className="text-sm text-muted-foreground">
          {t("speech.settings.qwenNoLanguage", { language: name })}
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
  const engine = useSetting("speech.readEngine");
  const piper = usePiperVoices().data;
  const qwen = useQwenTts().data;
  const rate = useSetting("speech.readRate");
  const atOnce = useSetting("speech.readAtOnce");
  const target = useSetting("learner.target");
  const native = useSetting("learner.native") ?? i18n.language;
  const [shownRate, setShownRate] = useState<number>();
  const langs = [...new Set([target, native].filter((l): l is string => !!l))];
  const device = typeof speechSynthesis !== "undefined" && voices.length > 0;
  const piperReady = piper?.voices.filter((v) => v.installed).length ?? 0;
  const card = (
    id: Engine,
    icon: React.ReactNode,
    title: string,
    line: string,
    usable: boolean,
  ) => (
    <button
      type="button"
      aria-pressed={engine === id}
      disabled={!usable}
      onClick={() => set.mutate({ key: "speech.readEngine", value: id })}
      className={cn(
        "flex flex-col items-start gap-1 rounded-2xl border bg-card p-3 text-left hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60",
        engine === id && "border-2 border-primary bg-accent",
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {icon} {title}
      </span>
      <span className="text-xs text-muted-foreground">{line}</span>
    </button>
  );
  return (
    <Panel title={t("speech.settings.read")}>
      <div className="mt-2 space-y-4">
        <p className="text-sm text-muted-foreground">{t("speech.settings.readHint")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {card(
            "device",
            <Laptop className="size-4" />,
            t("speech.settings.engine.device"),
            device
              ? t("speech.settings.engine.deviceLine", {
                  count: voices.length,
                  n: number(voices.length),
                })
              : t("speech.settings.engine.deviceNone"),
            true,
          )}
          {card(
            "piper",
            <Cpu className="size-4" />,
            t("speech.settings.engine.piper"),
            !piper?.engine
              ? t("speech.settings.engine.piperMissing")
              : t("speech.settings.engine.piperLine", {
                  count: piperReady,
                  n: number(piperReady),
                }),
            !!piper?.engine,
          )}
          {card(
            "qwen",
            <Sparkles className="size-4" />,
            t("speech.settings.engine.qwen"),
            !qwen?.engine
              ? t("speech.settings.engine.qwenMissing")
              : qwen.models.some((m) => m.installed)
                ? t("speech.settings.engine.qwenReady")
                : t("speech.settings.engine.qwenNoModel"),
            !!qwen?.engine,
          )}
        </div>
        {engine === "qwen" && qwen?.engine ? (
          <QwenSection state={qwen} langs={langs} />
        ) : engine === "piper" && piper?.engine ? (
          <div>
            {langs.map((lang) => (
              <PiperLanguage key={lang} lang={lang} voices={piper.voices} />
            ))}
            <p className="mt-1 text-xs text-muted-foreground">{t("speech.settings.piperHint")}</p>
          </div>
        ) : (
          device && (
            <div>
              {langs.map((lang) => (
                <DeviceVoiceRow key={lang} lang={lang} />
              ))}
              <p className="mt-1 text-xs text-muted-foreground">
                {t("speech.settings.betterVoices")}
              </p>
            </div>
          )
        )}
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
      </div>
    </Panel>
  );
}

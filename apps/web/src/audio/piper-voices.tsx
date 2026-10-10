// Reading aloud with Piper on this computer (08; Settings → Speech → Read aloud): each language with
// the voice it is read with — automatic: the one the server picks — and "Listen", and its voices to
// download or remove, the language's best first (the server's order).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePiperVoiceActions, type usePiperVoices } from "@/api/hooks.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { DownloadRow } from "./download-row.tsx";
import { read } from "./speaker.ts";
import { AUTO, useChoice, VoicePick } from "./voice-pick.tsx";

type PiperState = NonNullable<ReturnType<typeof usePiperVoices>["data"]>;
type PiperVoice = PiperState["voices"][number];

/** Voices shown per language before "all voices". */
const SHOWN = 4;

export function PiperVoices({ state, langs }: { state: PiperState; langs: string[] }) {
  const { t } = useTranslation();
  return (
    <div>
      {langs.map((lang) => (
        <PiperLanguage key={lang} lang={lang} state={state} />
      ))}
      <p className="mt-1 text-xs text-muted-foreground">{t("speech.settings.piperHint")}</p>
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
function PiperLanguage({ lang, state }: { lang: string; state: PiperState }) {
  const { t, i18n } = useTranslation();
  const actions = usePiperVoiceActions();
  const nameOf = usePiperName();
  const { own, choose } = useChoice("piper", lang);
  const [all, setAll] = useState(false);
  const mine = state.voices.filter((v) => v.lang === lang);
  const installed = mine.filter((v) => v.installed);
  const auto = installed.find((v) => v.id === state.auto[lang]);
  const name = languageName(lang, i18n.language, true);
  const value = own[lang] && installed.some((v) => v.id === own[lang]) ? own[lang] : AUTO;
  const shown = all ? mine : mine.slice(0, SHOWN);
  // Automatic: the server reads with the voice it picks.
  const listen = (text: string) => {
    const voice = value === AUTO ? undefined : value;
    void read(`listen:${lang}`, [{ text, lang }], { wayFor: () => ({ server: { voice } }) });
  };
  return (
    <div className="space-y-2 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-sm font-medium">{name}</span>
        {installed.length ? (
          <VoicePick
            lang={lang}
            pick={{
              value,
              auto: auto ? nameOf(auto) : "",
              options: installed.map((v) => ({ id: v.id, name: nameOf(v) })),
              onChange: choose,
            }}
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
            <DownloadRow
              key={v.id}
              compact
              title={nameOf(v)}
              item={v}
              removeLabel={t("speech.settings.removeVoice", { voice: nameOf(v) })}
              onDownload={() => actions.download.mutate(v.id)}
              onRemove={() => actions.remove.mutate(v.id)}
            />
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

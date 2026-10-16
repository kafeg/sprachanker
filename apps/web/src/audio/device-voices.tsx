// Reading aloud with this device's voices (Settings → Speech → Read aloud): each language with its
// voice — automatic: the best one the device has — and "Listen"; where more voices are had (the Mac's
// settings, Android's).
import { useTranslation } from "react-i18next";
import { inPhoneApp } from "@/api/client.ts";
import { useSetting } from "@/api/settings.ts";
import { languageName } from "@/i18n/index.ts";
import { bestVoice, speaks } from "./speak.ts";
import { deviceVoice, read, useDeviceVoices, voiceInfo } from "./speaker.ts";
import { AUTO, useChoice, VoicePick } from "./voice-pick.tsx";

export function DeviceVoices({ langs }: { langs: string[] }) {
  const { t } = useTranslation();
  return (
    <div>
      {langs.map((lang) => (
        <DeviceLanguage key={lang} lang={lang} />
      ))}
      <p className="mt-1 text-xs text-muted-foreground">
        {t(inPhoneApp ? "speech.settings.phoneVoices" : "speech.settings.betterVoices")}
      </p>
    </div>
  );
}

/** One language with the device's voices. */
function DeviceLanguage({ lang }: { lang: string }) {
  const { t, i18n } = useTranslation();
  const voices = useDeviceVoices();
  const rate = useSetting("speech.readRate");
  const { own, choose } = useChoice("device", lang);
  const mine = voices.filter((v) => speaks(voiceInfo(v), lang));
  const name = languageName(lang, i18n.language, true);
  const value = own[lang] && mine.some((v) => v.voiceURI === own[lang]) ? own[lang] : AUTO;
  const listen = (text: string) => {
    const voice = deviceVoice(voices, own, lang);
    void read(`listen:${lang}`, [{ text, lang }], {
      wayFor: () => ({ device: voice, rate }),
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span className="w-28 text-sm font-medium">{name}</span>
      {mine.length ? (
        <VoicePick
          lang={lang}
          pick={{
            value,
            auto: bestVoice(mine.map(voiceInfo), lang)?.name ?? "",
            options: mine.map((v) => ({ id: v.voiceURI, name: v.name })),
            onChange: choose,
          }}
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

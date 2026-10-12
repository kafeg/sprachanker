// Reading aloud with Qwen3-TTS on this computer (08; Settings → Speech → Read aloud): its models to
// download, the one in use marked and another installed one to use instead (none chosen: the large
// one when it is there), and for each language its speaker with a phrase and "Listen".
import { useTranslation } from "react-i18next";
import { useSetSetting } from "@/api/settings.ts";
import { useQwenModelActions, type useQwenTts } from "@/api/speech.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { DownloadRow } from "./download-row.tsx";
import { InUse } from "./in-use.tsx";
import { read } from "./speaker.ts";
import { speakerName } from "./voice-names.ts";
import { AUTO, useChoice, VoicePick } from "./voice-pick.tsx";

type QwenState = NonNullable<ReturnType<typeof useQwenTts>["data"]>;

/** The speaker the profile chose for a language, while Qwen3-TTS has it. */
const chosenSpeaker = (state: QwenState, own: Record<string, string>, lang: string) => {
  const chosen = own[lang];
  return chosen && (state.speakers as readonly string[]).includes(chosen) ? chosen : undefined;
};

export function QwenVoices({ state, langs }: { state: QwenState; langs: string[] }) {
  const { t } = useTranslation();
  const actions = useQwenModelActions();
  const set = useSetSetting();
  const ready = state.models.some((m) => m.installed);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {state.models.map((m) => {
          const title = t(`speech.settings.qwenModel.${m.id === "0.6b" ? "small" : "large"}`);
          return (
            <DownloadRow
              key={m.id}
              title={title}
              item={m}
              removeLabel={t("speech.settings.removeModel")}
              starting={actions.download.isPending && actions.download.variables === m.id}
              onDownload={() => actions.download.mutate(m.id)}
              onRemove={() => actions.remove.mutate(m.id)}
              marked={m.inUse}
            >
              {m.inUse ? (
                <InUse />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => set.mutate({ key: "speech.qwenModel", value: m.id })}
                >
                  {t("speech.settings.use")}
                </Button>
              )}
            </DownloadRow>
          );
        })}
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

/** One language with Qwen3-TTS: its speaker, a phrase and "Listen". */
function QwenLanguage({ lang, state }: { lang: string; state: QwenState }) {
  const { t, i18n } = useTranslation();
  const { own, choose } = useChoice("qwen", lang);
  const name = languageName(lang, i18n.language, true);
  const voice = chosenSpeaker(state, own, lang);
  const listen = (text: string) => {
    void read(`listen:${lang}`, [{ text, lang }], { wayFor: () => ({ server: { voice } }) });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span className="w-28 text-sm font-medium">{name}</span>
      {state.languages.includes(lang) ? (
        <VoicePick
          lang={lang}
          pick={{
            options: state.speakers.map((s) => ({ id: s, name: speakerName(s) })),
            value: voice ?? AUTO,
            auto: speakerName(state.defaultSpeaker),
            onChange: choose,
          }}
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

// Settings → Speech → Read aloud: Qwen3-TTS on this computer alone (owner, 2026-10-14) — its state,
// its models and each language's speaker (qwen-voices). Where it cannot read a language, the device's
// voices read without a choice here.
import { useTranslation } from "react-i18next";
import { useQwenTts } from "@/api/speech.ts";
import { Panel } from "@/ui/panel.tsx";
import { QwenVoices } from "./qwen-voices.tsx";
import { useReadLanguages } from "./read-languages.ts";

export function ReadAloud() {
  const { t } = useTranslation();
  const qwen = useQwenTts().data;
  const langs = useReadLanguages();
  return (
    <Panel title={t("speech.settings.read")}>
      <div className="mt-2 space-y-4">
        <p className="text-sm text-muted-foreground">{t("speech.settings.readHint")}</p>
        {qwen && (
          <p className="text-sm">
            {!qwen.engine
              ? t("speech.settings.engine.qwenMissing")
              : qwen.models.some((m) => m.installed)
                ? t("speech.settings.engine.qwenReady")
                : t("speech.settings.engine.qwenNoModel")}
          </p>
        )}
        {qwen?.engine && <QwenVoices state={qwen} langs={langs} />}
      </div>
    </Panel>
  );
}

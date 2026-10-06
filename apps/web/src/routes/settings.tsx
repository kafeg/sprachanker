// Settings: interface language, theme, AI assistant.
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "@/api/hooks.ts";
import type { Theme } from "@/app/preferences.ts";
import { nativeName, UI_LANGUAGES } from "@/i18n/index.ts";
import { LlmSettings } from "@/llm/settings-section.tsx";
import { Page } from "@/ui/app-shell.tsx";
import { Choice } from "@/ui/choice.tsx";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const set = useSetSetting();
  const theme = (settings.data?.theme as Theme | undefined) ?? "system";
  return (
    <Page title={t("nav.settings")}>
      <div className="max-w-2xl space-y-8">
        <section className="space-y-2">
          <h2 className="text-xl font-bold">{t("settings.uiLanguage")}</h2>
          <Choice
            value={i18n.language}
            options={UI_LANGUAGES.map((l) => [l, nativeName(l)])}
            onChange={(value) => {
              void i18n.changeLanguage(value);
              set.mutate({ key: "uiLanguage", value });
            }}
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-bold">{t("settings.themeLabel")}</h2>
          <Choice
            value={theme}
            options={(["system", "light", "dark"] as const).map((v) => [
              v,
              t(`settings.theme.${v}`),
            ])}
            onChange={(value) => set.mutate({ key: "theme", value })}
          />
        </section>
        <LlmSettings />
      </div>
    </Page>
  );
}

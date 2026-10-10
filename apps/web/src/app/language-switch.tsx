// The interface language (09), each named in its own language: on "Who is studying?" — the only place to
// choose it before a profile exists, kept on this device — and in Settings → General, where the profile
// keeps it too (`keep`; preferences.ts applies it).
import { useTranslation } from "react-i18next";
import { useSetSetting } from "@/api/settings.ts";
import { isUiLanguage, languageName, switchLanguage, UI_LANGUAGES } from "@/i18n/index.ts";
import { Choice } from "@/ui/choice.tsx";

export function LanguageSwitch({ keep = false }: { keep?: boolean }) {
  const { t, i18n } = useTranslation();
  const set = useSetSetting();
  return (
    <Choice
      label={t("settings.uiLanguage")}
      value={i18n.language}
      options={UI_LANGUAGES.map((l) => [
        l,
        <span key={l} lang={l}>
          {languageName(l, l, true)}
        </span>,
      ])}
      onChange={(l) => {
        if (!isUiLanguage(l)) return;
        switchLanguage(l);
        if (keep) set.mutate({ key: "uiLanguage", value: l });
      }}
    />
  );
}

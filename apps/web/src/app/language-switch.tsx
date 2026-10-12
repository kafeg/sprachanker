// The interface language: a list of every language there is a catalog for, each named in its own
// language, on "Who is studying?" — the only place to choose it before a profile exists, kept on this
// device — and in Settings → General, where the profile keeps it too (`keep`; preferences.ts applies it).
import { useTranslation } from "react-i18next";
import { useSetSetting } from "@/api/settings.ts";
import { isUiLanguage, languageName, switchLanguage, UI_LANGUAGES } from "@/i18n/index.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";

export function LanguageSwitch({ keep = false }: { keep?: boolean }) {
  const { t, i18n } = useTranslation();
  const set = useSetSetting();
  return (
    <Select
      value={i18n.language}
      onValueChange={(l) => {
        if (!isUiLanguage(l)) return;
        void switchLanguage(l).then((shown) => {
          if (shown && keep) set.mutate({ key: "uiLanguage", value: l });
        });
      }}
    >
      <SelectTrigger className="h-11 w-full bg-card sm:w-64" aria-label={t("settings.uiLanguage")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UI_LANGUAGES.map((l) => (
          <SelectItem key={l} value={l} lang={l}>
            {languageName(l, l, true)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// The interface language as chips, each in its own language (09), on "Who is studying?" — the only place
// to choose it before a profile exists; kept on this device (a profile then keeps it: preferences.ts).
import { useTranslation } from "react-i18next";
import { languageName, switchLanguage, UI_LANGUAGES } from "@/i18n/index.ts";
import { Chip } from "@/ui/chip.tsx";

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <fieldset
      className="flex min-w-0 flex-wrap justify-center gap-2 border-0 p-0"
      aria-label={t("settings.uiLanguage")}
    >
      {UI_LANGUAGES.map((l) => (
        <Chip key={l} on={i18n.language === l} onClick={() => switchLanguage(l)}>
          <span lang={l}>{languageName(l, l, true)}</span>
        </Chip>
      ))}
    </fieldset>
  );
}

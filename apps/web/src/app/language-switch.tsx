// The interface language as chips, each in its own language (09): first thing on "Who is studying?"
// and in the onboarding's welcome, so the app speaks the learner's language from the start.
import { useTranslation } from "react-i18next";
import { languageName, switchLanguage, UI_LANGUAGES, type UiLanguage } from "@/i18n/index.ts";
import { Chip } from "@/ui/chip.tsx";

export function LanguageSwitch({ onPick }: { onPick?(language: UiLanguage): void }) {
  const { t, i18n } = useTranslation();
  return (
    <fieldset
      className="flex min-w-0 flex-wrap justify-center gap-2 border-0 p-0"
      aria-label={t("settings.uiLanguage")}
    >
      {UI_LANGUAGES.map((l) => (
        <Chip
          key={l}
          on={i18n.language === l}
          onClick={() => {
            switchLanguage(l);
            onPick?.(l);
          }}
        >
          <span lang={l}>{languageName(l, l, true)}</span>
        </Chip>
      ))}
    </fieldset>
  );
}

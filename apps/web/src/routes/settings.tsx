// Settings (09): six tabs, two rows on a phone — General (language, theme, storage, about), Profile
// (name, languages, sign-in, devices, switching, deleting), Review (Anki's deck options), Speech
// (microphone, recognition, reading aloud), AI assistant (providers, models, LM Studio; then where it
// works and its prompts), Experimental (what is not ready yet, turned on by section and source). The open tab is kept in the URL hash; a section's own (#prompts, #about)
// opens its tab there.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSetting } from "@/api/hooks.ts";
import { AboutSection } from "@/app/about.tsx";
import { ExperimentalSettings } from "@/app/experimental-settings.tsx";
import { ProfileSettings } from "@/app/profile-settings.tsx";
import { SpeechSettings } from "@/audio/speech-settings.tsx";
import { isUiLanguage, languageName, switchLanguage, UI_LANGUAGES } from "@/i18n/index.ts";
import { PromptsSettings } from "@/llm/prompts-info.tsx";
import { LlmSettings } from "@/llm/settings-section.tsx";
import { ReviewSettings } from "@/study/review-settings.tsx";
import { Choice } from "@/ui/choice.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs.tsx";
import { Page } from "@/ui/page.tsx";
import { StorageSection } from "./storage.tsx";

const TABS = ["general", "profile", "review", "speech", "ai", "experimental"] as const;
type Tab = (typeof TABS)[number];
/** Sections inside a tab that an address may name. */
const SECTIONS: Record<string, Tab> = { prompts: "ai", about: "general" };
const tabOfHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : (SECTIONS[hash] ?? "general");
};

function General() {
  const { t, i18n } = useTranslation();
  const set = useSetSetting();
  const theme = useSetting("theme");
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-xl font-bold">{t("settings.uiLanguage")}</h2>
        <Select
          value={i18n.language}
          onValueChange={(value) => {
            if (isUiLanguage(value)) switchLanguage(value);
            set.mutate({ key: "uiLanguage", value });
          }}
        >
          <SelectTrigger
            className="h-11 w-full max-w-xs bg-card"
            aria-label={t("settings.uiLanguage")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UI_LANGUAGES.map((l) => (
              <SelectItem key={l} value={l}>
                {languageName(l, l, true)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">{t("settings.themeLabel")}</h2>
        <Choice
          value={theme}
          options={(["system", "light", "dark"] as const).map((v) => [v, t(`settings.theme.${v}`)])}
          onChange={(value) => set.mutate({ key: "theme", value })}
        />
      </section>
      <StorageSection />
      <AboutSection />
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(tabOfHash);
  // A link or Back/Forward that changes only the hash opens that tab; one naming a section inside a
  // tab (#prompts) opens the tab there.
  useEffect(() => {
    const follow = () => {
      setTab(tabOfHash());
      const section = window.location.hash.slice(1);
      if (SECTIONS[section])
        requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView());
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  return (
    <Page title={t("nav.settings")}>
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as Tab);
          window.history.replaceState(null, "", `#${next}`);
        }}
        className="max-w-2xl"
      >
        {/* Six tabs: one row on a wide screen, two on a phone. */}
        <TabsList className="mb-6 grid h-auto! w-full grid-cols-3 sm:grid-cols-6">
          {TABS.map((id) => (
            <TabsTrigger
              key={id}
              value={id}
              className="min-h-9 px-1 text-[13px] pointer-coarse:min-h-11 sm:px-2 sm:text-sm"
            >
              {t(`settings.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <General />
        </TabsContent>
        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>
        <TabsContent value="review">
          <ReviewSettings />
        </TabsContent>
        <TabsContent value="speech">
          <SpeechSettings />
        </TabsContent>
        <TabsContent value="experimental">
          <ExperimentalSettings />
        </TabsContent>
        <TabsContent value="ai" className="space-y-10">
          <LlmSettings />
          <section id="prompts" className="space-y-2">
            <h2 className="text-xl font-bold">{t("settings.tabs.prompts")}</h2>
            <PromptsSettings />
          </section>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

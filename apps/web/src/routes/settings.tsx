// Settings (09): tabs — General (language, theme, storage), Profile (name, languages, sign-in, devices,
// switching), Review (Anki's deck options), AI assistant (providers, models, LM Studio), Prompts (the tasks' system prompts, the {}
// buttons), About. The open tab is kept in the URL hash.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSetting, useSettings } from "@/api/hooks.ts";
import { AboutSection } from "@/app/about.tsx";
import type { Theme } from "@/app/preferences.ts";
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

const TABS = ["general", "profile", "review", "speech", "ai", "prompts", "about"] as const;
type Tab = (typeof TABS)[number];
const tabOfHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : "general";
};

function General() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
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
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(tabOfHash);
  // A link or Back/Forward that changes only the hash opens that tab.
  useEffect(() => {
    const follow = () => setTab(tabOfHash());
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
        <TabsList className="mb-6 w-full justify-start overflow-x-auto">
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
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
        <TabsContent value="ai">
          <LlmSettings />
        </TabsContent>
        <TabsContent value="prompts">
          <PromptsSettings />
        </TabsContent>
        <TabsContent value="about">
          <AboutSection />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

// Settings (09): five tabs in one row, as a section's — General (language, theme, storage, about,
// experimental), Profile (name, sign-in, devices, switching, deleting), Review (Anki's deck options),
// Speech (microphone, recognition, reading aloud, recordings), AI assistant (providers, models, LM
// Studio, where it works; its prompts under Advanced). What is rarely changed is under one "Advanced"
// per tab. The open tab is kept in the URL hash; a section's own (#prompts, #about, #experimental) opens
// its tab there, a folded one opened.
import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSetting } from "@/api/hooks.ts";
import { AboutSection } from "@/app/about.tsx";
import { ExperimentalSettings } from "@/app/experimental-settings.tsx";
import { LanguageSwitch } from "@/app/language-switch.tsx";
import { ProfileSettings } from "@/app/profile-settings.tsx";
import { SpeechSettings } from "@/audio/speech-settings.tsx";
import { AiPlaces, PromptsSettings } from "@/llm/prompts-info.tsx";
import { LlmSettings } from "@/llm/settings-section.tsx";
import { ReviewSettings } from "@/study/review-settings.tsx";
import { Choice } from "@/ui/choice.tsx";
import { Tabs, TabsContent } from "@/ui/components/tabs.tsx";
import { Disclosure } from "@/ui/disclosure.tsx";
import { Page } from "@/ui/page.tsx";
import { SectionTabList } from "@/ui/section-tabs.tsx";
import { StorageSection } from "./storage.tsx";

const TABS = ["general", "profile", "review", "speech", "ai"] as const;
type Tab = (typeof TABS)[number];
/** Sections inside a tab that an address may name. */
const SECTIONS: Record<string, Tab> = { prompts: "ai", about: "general", experimental: "general" };
const tabOfHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : (SECTIONS[hash] ?? "general");
};

function General() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const theme = useSetting("theme");
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-xl font-bold">{t("settings.uiLanguage")}</h2>
        <LanguageSwitch keep />
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
      <ExperimentalSettings />
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(tabOfHash);
  const [section, setSection] = useState<string>();
  const fetching = useIsFetching();
  // A link or Back/Forward that changes only the hash opens that tab; one naming a section inside a
  // tab (#prompts) opens the tab there, and the section if it is folded.
  useEffect(() => {
    const follow = () => {
      setTab(tabOfHash());
      const hash = window.location.hash.slice(1);
      setSection(SECTIONS[hash] ? hash : undefined);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  // Scrolled to once what is above it has loaded, so it stays where it was scrolled to.
  useEffect(() => {
    if (!section || fetching) return;
    const element = document.getElementById(section);
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView?.();
    setSection(undefined);
  }, [section, fetching]);
  return (
    <Page title={t("nav.settings")}>
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as Tab);
          window.history.replaceState(null, "", `#${next}`);
        }}
        className="max-w-3xl gap-0"
      >
        <SectionTabList
          label={t("nav.settings")}
          value={tab}
          tabs={TABS.map((id) => ({ value: id, label: t(`settings.tabs.${id}`) }))}
        />
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
        <TabsContent value="ai" className="space-y-6">
          <LlmSettings />
          <AiPlaces />
          <Disclosure id="prompts" title={t("settings.advanced")}>
            <PromptsSettings />
          </Disclosure>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

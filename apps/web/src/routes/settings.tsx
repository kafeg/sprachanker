// Settings (09): five tabs in one row, as a section's — General (language, theme, storage with the
// recordings kept, about, experimental), Profile (name, sign-in, devices, switching, deleting), Review
// (daily limits, retention, card types), Speech (microphone, recognition, reading aloud), AI assistant
// (providers, models, LM Studio, where it works; its prompts under Advanced). The open tab is kept in the URL hash; a section's own (#prompts, #about, #experimental) opens
// its tab there, a folded one opened.
import { useIsFetching } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSetting } from "@/api/settings.ts";
import { AboutSection } from "@/app/about.tsx";
import { ExperimentalSettings } from "@/app/experimental-settings.tsx";
import { LanguageSwitch } from "@/app/language-switch.tsx";
import { ProfileSettings } from "@/app/profile-settings.tsx";
import { SpeechSetup } from "@/audio/speech-settings.tsx";
import { AiPlaces, PromptsSettings } from "@/llm/prompts-info.tsx";
import { LlmSettings } from "@/llm/settings-section.tsx";
import { ReviewSettings } from "@/study/review-settings.tsx";
import { Choice } from "@/ui/choice.tsx";
import { Tabs, TabsContent } from "@/ui/components/tabs.tsx";
import { Disclosure } from "@/ui/disclosure.tsx";
import { Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { SectionTabList } from "@/ui/section-tabs.tsx";
import { StorageSection } from "./storage.tsx";

const TABS = ["general", "profile", "review", "speech", "ai"] as const;
type Tab = (typeof TABS)[number];
/** Sections inside a tab that an address may name. */
const SECTIONS: Record<string, Tab> = { prompts: "ai", about: "general", experimental: "general" };
const tabOf = (hash: string): Tab =>
  (TABS as readonly string[]).includes(hash) ? (hash as Tab) : (SECTIONS[hash] ?? "general");

/** Scrolls to a section a link named once what is above it has loaded (so it stays where it was
 *  scrolled to), opening it when it is folded; mounted only while one is asked for. */
function ScrollToSection({ id }: { id: string }) {
  const fetching = useIsFetching();
  const done = useRef(false);
  useEffect(() => {
    if (fetching || done.current) return;
    done.current = true;
    const element = document.getElementById(id);
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView?.();
  }, [id, fetching]);
  return null;
}

function General() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const theme = useSetting("theme");
  return (
    <div className="space-y-6">
      <Panel title={t("settings.uiLanguage")} className="space-y-2">
        <LanguageSwitch keep />
      </Panel>
      <Panel title={t("settings.themeLabel")} className="space-y-2">
        <Choice
          value={theme}
          options={(["system", "light", "dark"] as const).map((v) => [v, t(`settings.theme.${v}`)])}
          onChange={(value) => set.mutate({ key: "theme", value })}
        />
      </Panel>
      <StorageSection />
      <AboutSection />
      <ExperimentalSettings />
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  // The hash is the open tab: a link, Back/Forward or a tab chosen here changes it; one naming a
  // section inside a tab (#prompts) opens the tab there, and the section if it is folded.
  const hash = useLocation({ select: (l) => l.hash });
  const navigate = useNavigate();
  const tab = tabOf(hash);
  const section = SECTIONS[hash] ? hash : undefined;
  return (
    <Page title={t("nav.settings")}>
      {section && <ScrollToSection key={section} id={section} />}
      <Tabs
        value={tab}
        onValueChange={(next) => void navigate({ to: "/settings", hash: next, replace: true })}
        className="max-w-3xl gap-0"
      >
        <SectionTabList
          label={t("nav.settings")}
          value={tab}
          tabs={TABS.map((id) => ({
            value: id,
            label: t(`settings.tabs.${id}`),
            short: id === "ai" ? t("settings.tabs.aiShort") : undefined,
          }))}
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
          <SpeechSetup />
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

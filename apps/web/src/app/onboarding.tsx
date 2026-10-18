// A profile's onboarding: the profile — welcome, where the courses come
// from, name (never empty) and colour — → the AI assistant
// (a slot: the llm folder's own settings) → speech (as Settings → Speech: the microphone, recognition,
// reading aloud) → a tour → choosing a course (among those downloaded, if any). A new profile is made by
// the first step's Next and signed in; the router then opens the onboarding again for it, at the step
// after the named profile's. On the first step Cancel takes it back: to who is studying before the
// profile is made, the profile deleted after. Every step but the tour can be changed later in Settings.

import { nextProfileColour, type ProfileColour } from "@sprachanker/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourses } from "@/api/courses.ts";
import {
  type SessionProfile,
  useCreateProfile,
  useDeleteProfile,
  useProfiles,
  useUpdateProfile,
} from "@/api/session.ts";
import { useSetSetting } from "@/api/settings.ts";
import { SpeechSetup } from "@/audio/speech-settings.tsx";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { NameAndColour } from "./name-colour.tsx";
import { Tour } from "./tour.tsx";

const STEPS = ["profile", "assistant", "speech", "tour"] as const;
type Step = (typeof STEPS)[number];

/** The tour, and where finishing goes once the courses are known: those downloaded (shown), else
 *  those to download (also when they cannot be read). */
function TourStep({ onTarget }: { onTarget(to: "/downloaded" | "/catalog"): void }) {
  const courses = useCourses();
  const known = courses.isSuccess || courses.isError;
  const downloaded = (courses.data ?? []).length > 0;
  useEffect(() => {
    if (known) onTarget(downloaded ? "/downloaded" : "/catalog");
  }, [known, downloaded, onTarget]);
  return <Tour />;
}

export function Onboarding({
  profile,
  assistant,
  onBack,
  madeHere,
  onDone,
}: {
  /** The profile onboarded; none while a new one is still to be named. */
  profile: SessionProfile | null;
  /** The AI assistant's settings, when the app has an assistant. */
  assistant?: React.ReactNode;
  /** Cancel on the first step before the profile exists: to "Who is studying?". */
  onBack?(): void;
  /** The profile was made by this onboarding: Cancel deletes it (never one that was there before). */
  madeHere?: boolean;
  /** Finished: where to go — the courses downloaded, or those to download when there are none. */
  onDone(to: "/downloaded" | "/catalog"): void;
}) {
  const { t, i18n } = useTranslation();
  const setSetting = useSetSetting();
  const steps = STEPS.filter((s) => s !== "assistant" || assistant);
  // A named profile has been through the first step (the profile from before profiles has no name).
  const [step, setStep] = useState<Step>(steps[profile?.name ? 1 : 0] ?? "profile");
  // Each step opens at its top (a long one, Speech, is scrolled to its end to go on).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on every change of step
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  const at = steps.indexOf(step);
  const last = at === steps.length - 1;
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const remove = useDeleteProfile();
  // Where finishing goes, known on the last step (the profile exists by then: its courses can be read).
  const [target, setTarget] = useState<"/downloaded" | "/catalog">();
  // Cancelled on the first step: before the profile is made, back; the one made here is deleted; one
  // that was there before (from before profiles, or made elsewhere) is never deleted from here.
  const cancel = profile ? (madeHere ? () => remove.mutate() : undefined) : onBack;
  const busy = create.isPending || update.isPending || remove.isPending;
  const profiles = useProfiles();
  const [name, setName] = useState(profile?.name ?? "");
  const [picked, setPicked] = useState<ProfileColour>();
  // A new profile's colour: the first no profile uses (the server's default too).
  const colour =
    picked ??
    profile?.colour ??
    nextProfileColour(profiles.data?.profiles.map((p) => p.colour) ?? []);

  const following = steps[at + 1];
  const next = () => {
    if (step === "profile") {
      if (!name.trim() || busy) return;
      const named = { name: name.trim(), colour };
      if (!profile) return create.mutate(named);
      // The name is kept before going on: a failure shows here, where it can be put right.
      return update
        .mutateAsync(named)
        .then(() => following && setStep(following))
        .catch(() => {});
    }
    if (following) return setStep(following);
    // The interface language on screen is the profile's (it may have kept another one before).
    setSetting.mutate({ key: "uiLanguage", value: i18n.language });
    // Awaited, not mutate's callback: the app replaces the onboarding before that would run; a failure
    // shows under the buttons.
    update
      .mutateAsync({ onboarded: true })
      .then(() => onDone(target ?? "/catalog"))
      .catch(() => {});
  };
  const failed = create.error ?? update.error ?? remove.error;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 pt-8">
      <ol
        className="flex gap-1.5"
        aria-label={t("onboarding.progress", { n: at + 1, total: steps.length })}
      >
        {steps.map((s, i) => (
          <li
            key={s}
            className={cn("h-1.5 flex-1 rounded-full bg-muted", i <= at && "bg-primary")}
          />
        ))}
      </ol>
      <h1 className="text-3xl font-bold">{t(`onboarding.${step}.title`)}</h1>
      <div className="flex-1 space-y-4">
        {step === "profile" && (
          <>
            <p className="text-lg">{t("onboarding.profile.text")}</p>
            <Panel as="div" className="space-y-2 text-sm text-muted-foreground">
              <p>{t("onboarding.profile.sources")}</p>
            </Panel>
            <h2 className="pt-2 text-xl font-semibold">{t("onboarding.profile.name")}</h2>
            <NameAndColour
              name={name}
              colour={colour}
              onName={setName}
              onColour={setPicked}
              onSubmit={next}
              autoFocus
            />
          </>
        )}
        {step === "assistant" && (
          <>
            <p className="text-muted-foreground">{t("onboarding.assistant.text")}</p>
            {assistant}
          </>
        )}
        {step === "speech" && (
          <>
            <p className="text-muted-foreground">{t("onboarding.speech.text")}</p>
            <SpeechSetup />
          </>
        )}
        {step === "tour" && <TourStep onTarget={setTarget} />}
      </div>
      {/* Back and Next stay at the bottom of the screen, a long step scrolling under them. */}
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {failed && <p className="pb-2 text-sm text-wrong">{errorText(t, failed)}</p>}
        <div className="flex items-center justify-between gap-3">
          {at > 0 ? (
            <Button variant="ghost" size="lg" onClick={() => setStep(steps[at - 1] ?? "profile")}>
              {t("onboarding.back")}
            </Button>
          ) : cancel ? (
            <Button
              variant="ghost"
              size="lg"
              disabled={busy}
              loading={remove.isPending}
              onClick={cancel}
            >
              {t("onboarding.cancel")}
            </Button>
          ) : (
            <span />
          )}
          <Button
            size="lg"
            disabled={(step === "profile" && !name.trim()) || remove.isPending || (last && !target)}
            loading={create.isPending || ((last || step === "profile") && update.isPending)}
            onClick={next}
          >
            {last ? t("onboarding.finish") : t("onboarding.next")}
          </Button>
        </div>
      </div>
    </main>
  );
}

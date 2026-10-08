// A new profile's onboarding (06, "Profiles and access"; 09): welcome with the interface language
// (courses come straight from their publishers) → name (never empty) and colour → languages (own,
// learnt: the pair filters the courses) → sign-in (none or a PIN) → the AI assistant (a slot: the llm
// folder's own settings) → speech (the microphone test, the recogniser's download) → a tour → the
// courses, filtered by the pair. Every step but the tour can be
// changed later in Settings.

import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting } from "@/api/hooks.ts";
import { type SessionProfile, useSetPin, useUpdateProfile } from "@/api/session.ts";
import { SpeechSetup } from "@/audio/speech-settings.tsx";
import { CATALOG_FILTERS, MY_FILTERS } from "@/courses/filter.ts";
import { languageName, UI_LANGUAGES } from "@/i18n/index.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Chip } from "@/ui/chip.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { cn } from "@/ui/utils.ts";
import { LanguageSwitch } from "./language-switch.tsx";
import { targetsOf, useLanguagePairs } from "./pairs.ts";
import { Tour } from "./tour.tsx";

const STEPS = ["welcome", "name", "languages", "signIn", "assistant", "speech", "tour"] as const;
type Step = (typeof STEPS)[number];
const COLOURS = ["amber", "teal", "rose", "violet", "sky", "lime"] as const;

export function Onboarding({
  profile,
  assistant,
  onDone,
}: {
  profile: SessionProfile;
  /** The AI assistant's settings, when the app has an assistant. */
  assistant?: React.ReactNode;
  /** Finished: where to go (All courses). */
  onDone(): void;
}) {
  const { t, i18n } = useTranslation();
  const steps = STEPS.filter((s) => s !== "assistant" || assistant);
  const [step, setStep] = useState<Step>("welcome");
  const at = steps.indexOf(step);
  const update = useUpdateProfile();
  const setSetting = useSetSetting();
  const pairs = useLanguagePairs();
  const [name, setName] = useState(profile.name);
  const [colour, setColour] = useState(profile.colour);
  const [native, setNative] = useState<string>(
    (UI_LANGUAGES as readonly string[]).includes(i18n.language) ? i18n.language : "en",
  );
  const targets = targetsOf(pairs, native);
  const [target, setTarget] = useState<string>();
  const learnt = target && targets.includes(target) ? target : targets[0];

  const next = async () => {
    if (step === "welcome") setSetting.mutate({ key: "uiLanguage", value: i18n.language });
    if (step === "name") update.mutate({ name: name.trim(), colour });
    if (step === "languages" && learnt) {
      setSetting.mutate({ key: "learner.native", value: native });
      setSetting.mutate({ key: "learner.target", value: learnt });
      // The courses open filtered by the pair (cleared from the filter bar).
      if (pairs.includes(`${native}-${learnt}`))
        for (const key of [CATALOG_FILTERS.pair, MY_FILTERS.pair])
          setSetting.mutate({ key, value: `${native}-${learnt}` });
    }
    const following = steps[at + 1];
    if (following) setStep(following);
    else {
      await update.mutateAsync({ onboarded: true });
      onDone();
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
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
        {step === "welcome" && (
          <>
            <LanguageSwitch onPick={(value) => setSetting.mutate({ key: "uiLanguage", value })} />
            <p className="text-lg">{t("onboarding.welcome.text")}</p>
            <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
              {t("onboarding.welcome.sources")}
            </p>
          </>
        )}
        {step === "name" && (
          <>
            <Input
              className="h-12 text-lg"
              autoFocus
              maxLength={40}
              aria-label={t("onboarding.name.label")}
              placeholder={t("onboarding.name.label")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <fieldset
              className="flex min-w-0 flex-wrap gap-2 border-0 p-0"
              aria-label={t("onboarding.name.colour")}
            >
              {COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={colour === c}
                  aria-label={t(`onboarding.colour.${c}`)}
                  onClick={() => setColour(c)}
                  className={cn("rounded-full p-0.5", colour === c && "ring-2 ring-primary")}
                >
                  <Avatar name={name || "?"} colour={c} className="size-12 text-xl" />
                </button>
              ))}
            </fieldset>
          </>
        )}
        {step === "languages" && (
          <>
            <Choice
              label={t("onboarding.languages.native")}
              options={[...UI_LANGUAGES]}
              value={native}
              onPick={setNative}
            />
            <Choice
              label={t("onboarding.languages.target")}
              options={targets}
              value={learnt}
              onPick={setTarget}
            />
            {!targets.length && (
              <p className="text-sm text-muted-foreground">{t("onboarding.languages.none")}</p>
            )}
          </>
        )}
        {step === "signIn" && <SignInStep />}
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
        {step === "tour" && <Tour />}
      </div>
      <div className="flex items-center justify-between gap-3">
        {at > 0 ? (
          <Button variant="ghost" size="lg" onClick={() => setStep(steps[at - 1] ?? "welcome")}>
            {t("onboarding.back")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="lg"
          disabled={(step === "languages" && !learnt) || (step === "name" && !name.trim())}
          loading={update.isPending && at === steps.length - 1}
          onClick={() => void next()}
        >
          {at === steps.length - 1 ? t("onboarding.finish") : t("onboarding.next")}
        </Button>
      </div>
    </main>
  );
}

function Choice({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: string[];
  value?: string;
  onPick(lang: string): void;
}) {
  const { i18n } = useTranslation();
  return (
    <fieldset className="min-w-0 space-y-2 border-0 p-0" aria-label={label}>
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((l) => (
          <Chip key={l} on={l === value} onClick={() => onPick(l)}>
            {languageName(l, i18n.language, true)}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}

/** Sign-in: none or a PIN (typed twice). */
function SignInStep() {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const savePin = useSetPin();
  const ready = /^\d{4,8}$/.test(pin) && pin === again;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{t("onboarding.signIn.text")}</p>
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <p className="font-medium">{t("onboarding.signIn.pin")}</p>
        {savePin.isSuccess ? (
          <p className="flex items-center gap-1.5 text-sm">
            <Check className="size-4 text-correct" /> {t("onboarding.signIn.pinSet")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[
              [pin, setPin, t("onboarding.signIn.pinNew")],
              [again, setAgain, t("onboarding.signIn.pinAgain")],
            ].map(([value, set, label]) => (
              <Input
                key={label as string}
                className="h-11 w-40 tracking-widest"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                aria-label={label as string}
                placeholder={label as string}
                value={value as string}
                onChange={(e) => (set as (v: string) => void)(e.target.value.replace(/\D/g, ""))}
              />
            ))}
            <Button
              size="lg"
              disabled={!ready}
              onClick={() => savePin.mutate(pin)}
              loading={savePin.isPending}
            >
              {t("onboarding.signIn.setPin")}
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t("onboarding.signIn.none")}</p>
    </div>
  );
}

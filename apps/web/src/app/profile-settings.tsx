// Settings → Profile (06, "Profiles and access"; 09): the name and colour, the languages, how this
// profile signs in (PIN, passkeys), the devices signed in to it, the tour again, switching profile.
import { Check, Fingerprint, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "@/api/hooks.ts";
import {
  passkeysHere,
  useAddPasskey,
  useDevices,
  usePasskeys,
  useRemovePasskey,
  useRevokeDevice,
  useSession,
  useSetPin,
  useSignOut,
  useUpdateProfile,
} from "@/api/session.ts";
import { languageName, UI_LANGUAGES } from "@/i18n/index.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Chip } from "@/ui/chip.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { deviceName } from "./device-name.ts";
import { targetsOf, useLanguagePairs } from "./pairs.ts";
import { Tour } from "./tour.tsx";

const COLOURS = ["amber", "teal", "rose", "violet", "sky", "lime"] as const;

export function ProfileSettings() {
  const { t, i18n } = useTranslation();
  const profile = useSession().data?.profile;
  const update = useUpdateProfile();
  const settings = useSettings().data;
  const setSetting = useSetSetting();
  const signOut = useSignOut();
  const [name, setName] = useState(profile?.name ?? "");
  const [tour, setTour] = useState(false);
  const pairs = useLanguagePairs();
  if (!profile) return null;
  const saveName = () => name.trim() !== profile.name && update.mutate({ name: name.trim() });
  const lang = (key: "learner.native" | "learner.target") => settings?.[key] as string | undefined;

  return (
    <div className="space-y-6">
      <Panel title={t("profile.who")}>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Avatar name={name || "?"} colour={profile.colour} className="size-12 text-xl" />
          <Input
            className="h-11 max-w-xs"
            maxLength={40}
            aria-label={t("onboarding.name.label")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
          />
        </div>
        <fieldset
          className="mt-3 flex min-w-0 flex-wrap gap-2 border-0 p-0"
          aria-label={t("onboarding.name.colour")}
        >
          {COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={profile.colour === c}
              aria-label={t(`onboarding.colour.${c}`)}
              onClick={() => update.mutate({ colour: c })}
              className={cn("rounded-full p-0.5", profile.colour === c && "ring-2 ring-primary")}
            >
              <Avatar name={name || "?"} colour={c} className="size-9" />
            </button>
          ))}
        </fieldset>
      </Panel>
      <Panel title={t("profile.languages")}>
        {(["learner.native", "learner.target"] as const).map((key) => (
          <fieldset
            key={key}
            className="mt-2 min-w-0 space-y-1.5 border-0 p-0"
            aria-label={t(`profile.${key}`)}
          >
            <p className="text-sm font-medium">{t(`profile.${key}`)}</p>
            <div className="flex flex-wrap gap-2">
              {(key === "learner.native"
                ? [...UI_LANGUAGES]
                : targetsOf(pairs, lang("learner.native") ?? i18n.language)
              ).map((l) => (
                <Chip
                  key={l}
                  on={lang(key) === l}
                  onClick={() => setSetting.mutate({ key, value: l })}
                >
                  {languageName(l, i18n.language, true)}
                </Chip>
              ))}
            </div>
          </fieldset>
        ))}
      </Panel>
      <SignInPanel hasPin={profile.hasPin} />
      <DevicesPanel />
      <Panel title={t("profile.tour")}>
        {tour ? (
          <div className="mt-2">
            <Tour />
          </div>
        ) : (
          <Button className="mt-2" variant="outline" onClick={() => setTour(true)}>
            {t("profile.showTour")}
          </Button>
        )}
      </Panel>
      <Button
        variant="outline"
        size="lg"
        onClick={() => signOut.mutate()}
        loading={signOut.isPending}
      >
        <LogOut /> {t("profile.switch")}
      </Button>
    </div>
  );
}

function SignInPanel({ hasPin }: { hasPin: boolean }) {
  const { t } = useTranslation();
  const when = useDateFormat("day");
  const setPin = useSetPin();
  const passkeys = usePasskeys();
  const add = useAddPasskey();
  const remove = useRemovePasskey();
  const [pin, setPinValue] = useState("");
  const [again, setAgain] = useState("");
  const [changing, setChanging] = useState(false);
  const ready = /^\d{4,8}$/.test(pin) && pin === again;
  const save = () =>
    setPin.mutate(pin, {
      onSuccess: () => {
        setPinValue("");
        setAgain("");
        setChanging(false);
      },
    });
  return (
    <Panel title={t("profile.signIn")}>
      <p className="mt-1 text-sm text-muted-foreground">{t("profile.signInHint")}</p>
      <div className="mt-3 space-y-2">
        <p className="text-sm font-medium">{t("onboarding.signIn.pin")}</p>
        {hasPin && !changing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm">
              <Check className="size-4 text-correct" /> {t("onboarding.signIn.pinSet")}
            </span>
            <Button variant="outline" size="sm" onClick={() => setChanging(true)}>
              {t("profile.changePin")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPin.mutate(null)}>
              {t("profile.removePin")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-11 w-40 tracking-widest"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              aria-label={t("onboarding.signIn.pinNew")}
              placeholder={t("onboarding.signIn.pinNew")}
              value={pin}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
            />
            <Input
              className="h-11 w-40 tracking-widest"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              aria-label={t("onboarding.signIn.pinAgain")}
              placeholder={t("onboarding.signIn.pinAgain")}
              value={again}
              onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))}
            />
            <Button disabled={!ready} onClick={save} loading={setPin.isPending}>
              {t("onboarding.signIn.setPin")}
            </Button>
          </div>
        )}
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-sm font-medium">{t("onboarding.signIn.passkey")}</p>
        <ul className="space-y-1">
          {(passkeys.data?.passkeys ?? []).map((k) => (
            <li key={k.id} className="flex items-center gap-2 text-sm">
              <Fingerprint className="size-4 text-muted-foreground" />
              <span className="flex-1">
                {t("profile.passkeyFor", { site: k.rpId, date: when.format(k.createdAt) })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("profile.removePasskey")}
                onClick={() => remove.mutate(k.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        {passkeysHere() ? (
          <Button variant="outline" onClick={() => add.mutate()} loading={add.isPending}>
            <Fingerprint /> {t("onboarding.signIn.addPasskey")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("profile.passkeyHttps")}</p>
        )}
        {add.isError && <p className="text-sm text-wrong">{t("profiles.error.passkey_failed")}</p>}
      </div>
    </Panel>
  );
}

function DevicesPanel() {
  const { t } = useTranslation();
  const when = useDateFormat("dayTime");
  const devices = useDevices();
  const revoke = useRevokeDevice();
  return (
    <Panel title={t("profile.devices")}>
      <ul className="mt-2 space-y-2">
        {(devices.data?.devices ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              <span className="font-medium">{deviceName(d.userAgent)}</span>
              {d.current && (
                <span className="ml-2 text-muted-foreground">{t("profile.thisDevice")}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                {t("profile.lastSeen", { date: when.format(d.lastSeenAt) })}
              </span>
            </span>
            {!d.current && (
              <Button variant="outline" size="sm" onClick={() => revoke.mutate(d.id)}>
                {t("profile.signOutDevice")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

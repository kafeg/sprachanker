// Settings → Profile (06, "Profiles and access"; 09): the name and colour, the devices signed in to
// it, switching profile, deleting it (asked to confirm).
import { ProfileColour } from "@sprachanker/schema";
import { LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteProfile,
  useDevices,
  useRevokeDevice,
  useSession,
  useSignOut,
  useUpdateProfile,
} from "@/api/session.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { deviceName } from "./device-name.ts";

export function ProfileSettings() {
  const { t } = useTranslation();
  const profile = useSession().data?.profile;
  const update = useUpdateProfile();
  const signOut = useSignOut();
  const [name, setName] = useState(profile?.name ?? "");
  if (!profile) return null;
  // An emptied name is not saved: the field shows the name kept again.
  const saveName = () => {
    if (!name.trim()) setName(profile.name);
    else if (name.trim() !== profile.name) update.mutate({ name: name.trim() });
  };

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
          {ProfileColour.options.map((c) => (
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
      <DevicesPanel />
      <Button
        variant="outline"
        size="lg"
        onClick={() => signOut.mutate()}
        loading={signOut.isPending}
      >
        <LogOut /> {t("profile.switch")}
      </Button>
      <DeleteProfile />
    </div>
  );
}

/** Deleting the profile with its progress, words, recordings and devices — after asking. */
function DeleteProfile() {
  const { t } = useTranslation();
  const name = useSession().data?.profile?.name ?? "";
  const remove = useDeleteProfile();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="lg"
        className="text-muted-foreground hover:text-wrong"
        onClick={() => setAsking(true)}
      >
        <Trash2 /> {t("profile.delete")}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("profile.deleteTitle", { name })}
        description={t("profile.deleteBody")}
        confirm={t("profile.deleteConfirm")}
        cancel={t("common.cancel")}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
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

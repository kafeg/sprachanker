// Settings → Profile (06, "Profiles and access"; 09): the name and colour, the devices signed in to
// it, its export as a file, switching profile, deleting it (asked to confirm).
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
import { Button } from "@/ui/components/button.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { deviceName } from "./device-name.ts";
import { NameAndColour } from "./name-colour.tsx";
import { ProfileExport } from "./profile-export.tsx";

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
        <div className="mt-2">
          <NameAndColour
            name={name}
            colour={profile.colour}
            onName={setName}
            onNameDone={saveName}
            onColour={(colour) => update.mutate({ colour })}
          />
        </div>
      </Panel>
      <DevicesPanel />
      <ProfileExport />
      <Button
        variant="outline"
        size="lg"
        onClick={() => signOut.mutate()}
        loading={signOut.isPending}
      >
        <LogOut className="rtl:-scale-x-100" /> {t("profile.switch")}
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
                <span className="ms-2 text-muted-foreground">{t("profile.thisDevice")}</span>
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

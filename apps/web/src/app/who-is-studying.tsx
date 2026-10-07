// "Who is studying?" (06, "Profiles and access"; 09): the profiles on this server as tiles and a new one
// while registration is open. A profile without a PIN or passkey opens on a tap; one with them asks
// for its PIN or a passkey. Shown while this device is signed in to none.
import { Fingerprint, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client.ts";
import {
  passkeysHere,
  useCreateProfile,
  useProfiles,
  useSignIn,
  useSignInWithPasskey,
} from "@/api/session.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { cn } from "@/ui/utils.ts";

type Listed = NonNullable<ReturnType<typeof useProfiles>["data"]>["profiles"][number];

export function WhoIsStudying() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const create = useCreateProfile();
  const [asking, setAsking] = useState<Listed>();
  const signIn = useSignIn();
  if (profiles.isPending) return <Loading />;
  if (profiles.isError)
    return <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />;
  const { profiles: list, registration } = profiles.data;
  const choose = (p: Listed) =>
    p.hasPin || p.hasPasskey ? setAsking(p) : signIn.mutate({ profile: p.id });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-4 py-10">
      <div className="space-y-2 text-center">
        <img src="/favicon.svg" alt="" className="mx-auto size-14" />
        <h1 className="text-3xl font-bold">
          {list.length ? t("profiles.who") : t("profiles.welcome")}
        </h1>
        {!list.length && <p className="text-muted-foreground">{t("profiles.firstHint")}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => choose(p)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 hover:bg-accent/60",
              asking?.id === p.id && "border-2 border-primary",
            )}
          >
            <Avatar name={p.name || "?"} colour={p.colour} className="size-16 text-2xl" />
            <span className="font-semibold">{p.name || t("profiles.unnamed")}</span>
            {(p.hasPin || p.hasPasskey) && (
              <span className="text-xs text-muted-foreground">{t("profiles.protected")}</span>
            )}
          </button>
        ))}
        {(registration || !list.length) && (
          <button
            type="button"
            onClick={() => create.mutate({})}
            disabled={create.isPending}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-4 text-muted-foreground hover:bg-accent/60"
          >
            <Plus className="size-8" />
            <span className="font-semibold">{t("profiles.new")}</span>
          </button>
        )}
      </div>
      {asking && <Unlock profile={asking} onCancel={() => setAsking(undefined)} />}
      {(signIn.isError || create.isError) && (
        <p className="text-center text-sm text-wrong">{t("profiles.error.other")}</p>
      )}
    </main>
  );
}

/** A protected profile: its PIN, or a passkey where this browser has one. */
function Unlock({ profile, onCancel }: { profile: Listed; onCancel(): void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const signIn = useSignIn();
  const passkey = useSignInWithPasskey();
  const error = signIn.error ?? passkey.error;
  const code = error instanceof ApiError ? error.message : error ? "other" : undefined;
  const submit = () => pin.length >= 4 && signIn.mutate({ profile: profile.id, pin });
  return (
    <div className="mx-auto w-full max-w-sm space-y-3 rounded-2xl border bg-card p-4">
      <p className="font-semibold">
        {t("profiles.unlock", { name: profile.name || t("profiles.unnamed") })}
      </p>
      {profile.hasPin && (
        <div className="flex gap-2">
          <Input
            className="h-11 text-lg tracking-widest"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={8}
            aria-label={t("profiles.pin")}
            placeholder={t("profiles.pin")}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Button size="lg" onClick={submit} loading={signIn.isPending}>
            {t("profiles.signIn")}
          </Button>
        </div>
      )}
      {profile.hasPasskey && passkeysHere() && (
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => passkey.mutate(profile.id)}
          loading={passkey.isPending}
        >
          <Fingerprint /> {t("profiles.withPasskey")}
        </Button>
      )}
      {code && (
        <p className="text-sm text-wrong">
          {t(`profiles.error.${code}`, t("profiles.error.other"))}
        </p>
      )}
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t("profiles.cancel")}
      </Button>
    </div>
  );
}

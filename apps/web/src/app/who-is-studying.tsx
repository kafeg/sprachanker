// "Who is studying?" (06, "Profiles and access"; 09): the interface language first, then the profiles on
// this server as tiles and a new one (named before it is made) while registration is open. A profile
// without a PIN opens on a tap; one with a PIN asks for it. Shown while this device is signed in to none.
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client.ts";
import { useCreateProfile, useProfiles, useSignIn } from "@/api/session.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { cn } from "@/ui/utils.ts";
import { LanguageSwitch } from "./language-switch.tsx";

type Listed = NonNullable<ReturnType<typeof useProfiles>["data"]>["profiles"][number];

export function WhoIsStudying() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const create = useCreateProfile();
  const [asking, setAsking] = useState<Listed>();
  const [naming, setNaming] = useState(false);
  const signIn = useSignIn();
  if (profiles.isPending) return <Loading />;
  if (profiles.isError)
    return <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />;
  const { profiles: list, registration } = profiles.data;
  const choose = (p: Listed) => (p.hasPin ? setAsking(p) : signIn.mutate({ profile: p.id }));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-4 py-10">
      <LanguageSwitch />
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
            {p.hasPin && (
              <span className="text-xs text-muted-foreground">{t("profiles.protected")}</span>
            )}
          </button>
        ))}
        {(registration || !list.length) && (
          <button
            type="button"
            onClick={() => {
              setAsking(undefined);
              setNaming(true);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-4 text-muted-foreground hover:bg-accent/60",
              naming && "border-2 border-solid border-primary",
            )}
          >
            <Plus className="size-8" />
            <span className="font-semibold">{t("profiles.new")}</span>
          </button>
        )}
      </div>
      {asking && <Unlock profile={asking} onCancel={() => setAsking(undefined)} />}
      {naming && !asking && (
        <NewProfile
          busy={create.isPending}
          onCreate={(name) => create.mutate({ name })}
          onCancel={() => setNaming(false)}
        />
      )}
      {(signIn.isError || create.isError) && (
        <p className="text-center text-sm text-wrong">{t("profiles.error.other")}</p>
      )}
    </main>
  );
}

/** A new profile's name, asked before it is made: a profile is never nameless. */
function NewProfile({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate(name: string): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const ready = name.trim().length > 0;
  const submit = () => ready && onCreate(name.trim());
  return (
    <div className="mx-auto w-full max-w-sm space-y-3 rounded-2xl border bg-card p-4">
      <p className="font-semibold">{t("profiles.nameIt")}</p>
      <div className="flex gap-2">
        <Input
          className="h-11 text-lg"
          autoFocus
          maxLength={40}
          aria-label={t("onboarding.name.label")}
          placeholder={t("onboarding.name.label")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Button size="lg" disabled={!ready} onClick={submit} loading={busy}>
          {t("profiles.create")}
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t("profiles.cancel")}
      </Button>
    </div>
  );
}

/** A protected profile: its PIN. */
function Unlock({ profile, onCancel }: { profile: Listed; onCancel(): void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const signIn = useSignIn();
  const error = signIn.error;
  const code = error instanceof ApiError ? error.message : error ? "other" : undefined;
  const submit = () => pin.length >= 4 && signIn.mutate({ profile: profile.id, pin });
  return (
    <div className="mx-auto w-full max-w-sm space-y-3 rounded-2xl border bg-card p-4">
      <p className="font-semibold">
        {t("profiles.unlock", { name: profile.name || t("profiles.unnamed") })}
      </p>
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

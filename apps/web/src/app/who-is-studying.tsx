// "Who is studying?" (06, "Profiles and access"; 09): the interface language first, then the profiles on
// this server as tiles and a new one (named before it is made) while registration is open. A profile
// opens on a tap (profiles keep learning apart; they are not locked). Shown while this device is signed
// in to none.
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateProfile, useProfiles, useSignIn } from "@/api/session.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { errorText } from "@/ui/error-text.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { cn } from "@/ui/utils.ts";
import { LanguageSwitch } from "./language-switch.tsx";

export function WhoIsStudying() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const create = useCreateProfile();
  const [naming, setNaming] = useState(false);
  const signIn = useSignIn();
  if (profiles.isPending) return <Loading />;
  if (profiles.isError)
    return <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />;
  const { profiles: list, registration } = profiles.data;

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
            onClick={() => signIn.mutate({ profile: p.id })}
            className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 hover:bg-accent/60"
          >
            <Avatar name={p.name || "?"} colour={p.colour} className="size-16 text-2xl" />
            <span className="font-semibold">{p.name || t("profiles.unnamed")}</span>
          </button>
        ))}
        {(registration || !list.length) && (
          <button
            type="button"
            onClick={() => setNaming(true)}
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
      {naming && (
        <NewProfile
          busy={create.isPending}
          onCreate={(name) => create.mutate({ name })}
          onCancel={() => setNaming(false)}
        />
      )}
      {(signIn.isError || create.isError) && (
        <p className="text-center text-sm text-wrong">
          {errorText(t, signIn.error ?? create.error)}
        </p>
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

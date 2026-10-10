// "Who is studying?" (06, "Profiles and access"; 09): the interface language first, then the profiles
// on this server as tiles, centred, five to a page (← / → and the arrow keys page them), and "New
// profile" after them while registration is open — it starts the onboarding, whose first step names
// the profile. A profile opens on a tap (profiles keep learning apart; they are not locked). Shown
// while this device is signed in to none.
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProfiles, useSignIn } from "@/api/session.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { cn } from "@/ui/utils.ts";
import { LanguageSwitch } from "./language-switch.tsx";

/** Profile tiles on a page ("New profile" besides). */
const PROFILES_PER_PAGE = 5;

const TILE =
  "flex h-full w-full flex-col items-center gap-2 rounded-2xl border p-4 hover:bg-accent/60";

export function WhoIsStudying({ onNew }: { onNew(): void }) {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const signIn = useSignIn();
  const [page, setPage] = useState(0);
  const list = profiles.data?.profiles ?? [];
  const pages = Math.max(1, Math.ceil(list.length / PROFILES_PER_PAGE));
  const at = Math.min(page, pages - 1);
  // Round from the last page to the first and back: the buttons stay enabled, so keep their focus.
  const go = (to: number) => setPage((to + pages) % pages);
  // biome-ignore lint/correctness/useExhaustiveDependencies: go reads at and pages
  useEffect(() => {
    if (pages < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === "ArrowLeft") go(at - 1);
      if (e.key === "ArrowRight") go(at + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, pages]);
  if (profiles.isPending) return <Loading />;
  if (profiles.isError)
    return <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />;
  const shown = list.slice(at * PROFILES_PER_PAGE, (at + 1) * PROFILES_PER_PAGE);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col justify-center gap-8 px-4 py-10">
      <div className="flex justify-center">
        <LanguageSwitch />
      </div>
      <div className="space-y-2 text-center">
        <img src="/favicon.svg" alt="" className="mx-auto size-14" />
        <h1 className="text-3xl font-bold">
          {list.length ? t("profiles.who") : t("profiles.welcome")}
        </h1>
        {!list.length && <p className="text-muted-foreground">{t("profiles.firstHint")}</p>}
      </div>
      <ul className="flex flex-wrap justify-center gap-3">
        {shown.map((p) => (
          <li key={p.id} className="w-32">
            <button
              type="button"
              onClick={() => signIn.mutate({ profile: p.id })}
              className={cn(TILE, "bg-card")}
            >
              <Avatar name={p.name || "?"} colour={p.colour} className="size-16 text-2xl" />
              <span className="w-full truncate text-center font-semibold">
                {p.name || t("profiles.unnamed")}
              </span>
            </button>
          </li>
        ))}
        {(profiles.data.registration || !list.length) && (
          <li className="w-32">
            <button
              type="button"
              onClick={onNew}
              className={cn(TILE, "justify-center border-dashed text-muted-foreground")}
            >
              <Plus className="size-8" />
              <span className="text-center font-semibold">{t("profiles.new")}</span>
            </button>
          </li>
        )}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label={t("profiles.previous")}
            onClick={() => go(at - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
            {t("profiles.page", { n: at + 1, total: pages })}
          </span>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label={t("profiles.next")}
            onClick={() => go(at + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
      {signIn.isError && (
        <p className="text-center text-sm text-wrong">{errorText(t, signIn.error)}</p>
      )}
    </main>
  );
}

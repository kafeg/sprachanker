// The app's frame (09, "Layouts"): sidebar on desktop, bottom tab bar on phones, the cards due on the
// Review entry, background downloads in the window title.
import { Link, Outlet } from "@tanstack/react-router";
import { BookOpen, Layers, Library, NotebookPen, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDecks, useDownloads, useDownloadsWatch } from "@/api/hooks.ts";
import { cn } from "@/ui/utils.ts";
import { useWindowBusy } from "@/ui/window-title.ts";
import { AboutLine } from "./about.tsx";

const NAV = [
  { to: "/", key: "nav.myCourses", icon: BookOpen },
  { to: "/catalog", key: "nav.allCourses", icon: Library },
  { to: "/review", key: "nav.review", icon: Layers },
  { to: "/notebook", key: "nav.notebook", icon: NotebookPen },
  { to: "/settings", key: "nav.settings", icon: Settings },
] as const;

export function AppShell() {
  const { t } = useTranslation();
  // Courses downloading in the background keep every screen current, and show in the window title.
  useDownloadsWatch();
  // Cards to study now (new, learning and review of every deck), on the Review entry.
  const due = (useDecks().data?.decks ?? []).reduce(
    (n, d) => n + d.counts.new + d.counts.learning + d.counts.review,
    0,
  );
  const running = useDownloads().data?.jobs.find((j) => j.status === "running");
  const media = running?.progress?.phase === "media" ? running.progress.media : undefined;
  useWindowBusy(
    running
      ? media?.total
        ? t("windowTitle.download", { percent: Math.floor((media.done / media.total) * 100) / 100 })
        : t("windowTitle.downloading")
      : undefined,
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r bg-sidebar p-4 lg:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="size-9" />
          <span className="font-heading text-xl font-bold">{t("app.name")}</span>
        </Link>
        {NAV.map(({ to, key, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            activeProps={{ className: "bg-accent text-foreground" }}
          >
            <Icon className="size-5" /> {t(key)}
            {to === "/review" && due > 0 && <DueBadge count={due} />}
          </Link>
        ))}
        <div className="mt-auto px-3">
          <AboutLine />
        </div>
      </aside>
      <main className="min-w-0 pb-20 lg:pb-0">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map(({ to, key, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground",
            )}
            activeProps={{ className: "text-foreground font-semibold" }}
          >
            <span className="relative">
              <Icon className="size-5" />
              {to === "/review" && due > 0 && <DueBadge count={due} corner />}
            </span>
            {t(key)}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** How many cards are waiting, on the Review entry (in the corner of its icon on a phone). */
function DueBadge({ count, corner = false }: { count: number; corner?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      title={t("study.due", { count })}
      className={cn(
        "rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground",
        corner ? "absolute -top-1.5 -right-3" : "ml-auto",
      )}
    >
      {count}
    </span>
  );
}

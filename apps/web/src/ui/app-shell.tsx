// App layout: sidebar on desktop, bottom tab bar on phones (09, "Layouts").
import { Link, Outlet } from "@tanstack/react-router";
import { BookOpen, Layers, Library, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDecks, useDownloads, useDownloadsWatch } from "@/api/hooks.ts";
import { AboutLine } from "./about.tsx";
import { cn } from "./utils.ts";
import { useWindowBusy, useWindowPlace } from "./window-title.ts";

const NAV = [
  { to: "/", key: "nav.myCourses", icon: BookOpen },
  { to: "/catalog", key: "nav.allCourses", icon: Library },
  { to: "/review", key: "nav.review", icon: Layers },
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

export function Page({
  title,
  children,
  actions,
}: {
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  useWindowPlace(title);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
      {(title || actions) && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          {title && <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="p-8 text-muted-foreground">{t("common.loading")}</p>;
}

/** A course (or a lesson of it) that is not installed: a stale link, a course removed. */
export function NotInstalled() {
  const { t } = useTranslation();
  return (
    <div className="m-6 space-y-2 rounded-xl border p-4">
      <p>{t("course.notInstalled")}</p>
      <Link to="/catalog" className="font-semibold underline">
        {t("nav.allCourses")}
      </Link>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-6 rounded-xl border border-wrong/40 bg-wrong-soft p-4">
      <p>
        {t("common.error", { message: error instanceof Error ? error.message : String(error) })}
      </p>
      {onRetry && (
        <button type="button" className="mt-2 font-semibold underline" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

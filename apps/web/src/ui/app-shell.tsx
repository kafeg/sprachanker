// App layout: sidebar on desktop, bottom tab bar on phones (09, "Layouts").
import { Link, Outlet } from "@tanstack/react-router";
import { BookOpen, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./utils.ts";

const NAV = [
  { to: "/", key: "nav.courses", icon: BookOpen },
  { to: "/settings", key: "nav.settings", icon: Settings },
] as const;

/** `footer`: shown at the bottom of the desktop sidebar (the router puts the AI assistant there). */
export function AppShell({ footer }: { footer?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r bg-sidebar p-4 lg:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">
            S
          </span>
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
          </Link>
        ))}
        {footer && <div className="mt-auto px-2">{footer}</div>}
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
            <Icon className="size-5" /> {t(key)}
          </Link>
        ))}
      </nav>
    </div>
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

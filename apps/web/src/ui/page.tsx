// Page pieces every screen uses (09): the page with its title, loading, errors, empty states, a link back,
// a course that is not installed. Presentational: no data of their own.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "./utils.ts";
import { useWindowPlace } from "./window-title.ts";

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

/** A page or list with nothing in it yet: what comes here, and how (`children` can hold a link). */
export function EmptyState({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed p-8 text-center text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A quiet link back to where the page was opened from (Review ↔ Decks ↔ My words). */
export function BackLink({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 text-sm text-muted-foreground underline pointer-coarse:min-h-11"
    >
      {children}
    </button>
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
        {t("courses.tabs.available")}
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

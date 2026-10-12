// Page pieces every screen uses: the page with its title, loading, errors, empty states, a link back,
// a course that is not installed. Presentational: no data of their own.
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { errorText } from "./error-text.ts";
import { cn } from "./utils.ts";
import { useWindowPlace } from "./window-title.ts";

export function Page({
  title,
  children,
  actions,
  back,
}: {
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** The way back up (a BackLink), above the title. */
  back?: React.ReactNode;
}) {
  useWindowPlace(title);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
      {back}
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

/** The way back up from a page (Page's `back`): an arrow and where it leads. */
export function BackLink({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
    >
      <ArrowLeft className="rtl:-scale-x-100 size-4" /> {children}
    </button>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="p-8 text-muted-foreground">{t("common.loading")}</p>;
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  /** Its margin, when not a page's (`m-6`). */
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("m-6 rounded-xl border border-wrong/40 bg-wrong-soft p-4", className)}>
      <p>{errorText(t, error)}</p>
      {onRetry && (
        <button
          type="button"
          className="mt-2 inline-flex items-center font-semibold underline pointer-coarse:min-h-11"
          onClick={onRetry}
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

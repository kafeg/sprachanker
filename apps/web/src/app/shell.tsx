// The app's frame: sidebar on desktop, bottom tab bar on phones, the cards due on the
// Review entry, background downloads in the window title, "On a phone" beside the profile (the
// sidebar's: a phone has it in Settings); an optional feature's section (the Tutor) after the
// learning modules while it is there.
import { Link, type LinkProps, Outlet, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  GraduationCap,
  Layers,
  type LucideIcon,
  NotebookPen,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDecks } from "@/api/cards.ts";
import { inPhoneApp } from "@/api/client.ts";
import { useDownloads, useDownloadsWatch } from "@/api/downloads.ts";
import { useUpdate } from "@/api/update.ts";
import { cn } from "@/ui/utils.ts";
import { useWindowBusy } from "@/ui/window-title.ts";
import { AboutLine } from "./about.tsx";
import { OnPhoneButton } from "./other-devices.tsx";
import { ProfileChip } from "./profile-chip.tsx";

/** The app's sections, in the sidebar and the tab bar (and the onboarding's tour); `short`: the
 *  label on a phone's tab bar, where the full one does not fit some languages' share of it. */
export const NAV = [
  { to: "/", key: "nav.courses", icon: BookOpen },
  { to: "/review", key: "nav.review", short: "nav.short.review", icon: Layers },
  { to: "/exams", key: "nav.exams", icon: GraduationCap },
  { to: "/notebook", key: "nav.notebook", icon: NotebookPen },
  { to: "/settings", key: "nav.settings", short: "nav.short.settings", icon: Settings },
] as const;

/** A section an optional feature adds (the router's: the Tutor), shown while `useShown` says so. */
export interface ExtraSection {
  to: LinkProps["to"] & string;
  key: string;
  icon: LucideIcon;
  useShown(): boolean | undefined;
}

/** The Courses entry is active on any of its tabs. */
const COURSE_PATHS = ["/", "/downloaded", "/catalog"];

const noExtra = () => false;

export function AppShell({ extra }: { extra?: ExtraSection }) {
  const { t } = useTranslation();
  // An optional section goes after the learning modules, before the Notebook.
  const shown = (extra?.useShown ?? noExtra)();
  const sections = shown && extra ? [...NAV.slice(0, 3), extra, ...NAV.slice(3)] : NAV;
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Exams is active on its tabs and on an exam's pages (`/exam/…`).
  const active = (to: string) =>
    to === "/" ? COURSE_PATHS.includes(path) : path.startsWith(to === "/exams" ? "/exam" : to);
  // Courses downloading in the background keep every screen current, and show in the window title.
  useDownloadsWatch();
  // Cards to study now (new, learning and review of every deck), on the Review entry.
  const due = (useDecks().data?.decks ?? []).reduce(
    (n, d) => n + d.counts.new + d.counts.learning + d.counts.review,
    0,
  );
  // A newer version out: a dot on Settings, where About says how to take it.
  const newer = useUpdate().data?.newer?.version;
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
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-e bg-sidebar p-4 lg:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="size-9" />
          <span className="font-heading text-xl font-bold">{t("app.name")}</span>
        </Link>
        {sections.map(({ to, key, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            aria-current={active(to) ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
              active(to) && "bg-accent text-foreground",
            )}
          >
            <Icon className="size-5" /> {t(key)}
            {to === "/review" && due > 0 && <DueBadge count={due} />}
            {to === "/settings" && newer && <UpdateDot version={newer} />}
          </Link>
        ))}
        <div className="mt-auto space-y-3 px-1">
          <div>
            <ProfileChip />
            {!inPhoneApp && <OnPhoneButton />}
          </div>
          <div className="px-2">
            <AboutLine />
          </div>
        </div>
      </aside>
      <main className="min-w-0 pb-20 lg:pb-0">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {sections.map((section) => {
          const { to, key, icon: Icon } = section;
          const label = t(key);
          const short = "short" in section && section.short ? t(section.short) : label;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active(to) ? "page" : undefined}
              aria-label={short !== label ? label : undefined}
              // Each label fits its sixth of a 375 px phone: the short one there where the full
              // one does not; on a narrower screen it wraps, hyphenated where the language allows.
              className={cn(
                "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-px text-center text-xs leading-tight text-muted-foreground hyphens-auto [overflow-wrap:anywhere]",
                active(to) && "font-semibold text-foreground",
              )}
            >
              <span className="relative">
                <Icon className="size-5" />
                {to === "/review" && due > 0 && <DueBadge count={due} corner />}
                {to === "/settings" && newer && <UpdateDot version={newer} corner />}
              </span>
              {short !== label ? (
                <>
                  <span className="sm:hidden">{short}</span>
                  <span className="max-sm:hidden">{label}</span>
                </>
              ) : (
                label
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** A newer version is out: a quiet dot on the Settings entry (in the corner of its icon on a phone). */
function UpdateDot({ version, corner = false }: { version: string; corner?: boolean }) {
  const { t } = useTranslation();
  const said = t("about.newer", { version });
  return (
    <span
      role="img"
      aria-label={said}
      title={said}
      className={cn(
        "size-2 rounded-full bg-primary",
        corner ? "absolute -top-0.5 -end-1" : "ms-auto",
      )}
    />
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
        corner ? "absolute -top-1.5 -end-3" : "ms-auto",
      )}
    >
      {count}
    </span>
  );
}

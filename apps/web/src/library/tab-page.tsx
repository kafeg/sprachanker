// A part of the library in three tabs (09), Courses' and Exams' alike: My … (begun), Downloaded
// (installed) and Available (offered, not here yet), each tab its own address with its count; the
// cards in a grid; a tab with none says so, with the way to where there are some.
import { Link } from "@tanstack/react-router";
import { EmptyState, Page } from "@/ui/page.tsx";
import { SectionTabs } from "@/ui/section-tabs.tsx";

export const LIBRARY_TABS = ["mine", "downloaded", "available"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export function LibraryTabPage({
  title,
  tab,
  paths,
  label,
  counts,
  children,
}: {
  title: string;
  tab: LibraryTab;
  paths: Record<LibraryTab, string>;
  label(tab: LibraryTab): string;
  /** Each tab's count, once known. */
  counts?: Record<LibraryTab, number>;
  children: React.ReactNode;
}) {
  return (
    <Page title={title}>
      <SectionTabs
        label={title}
        tabs={LIBRARY_TABS.map((id) => ({
          to: paths[id],
          label: label(id),
          count: counts?.[id],
          current: tab === id,
        }))}
      />
      {children}
    </Page>
  );
}

/** The cards of a tab. */
export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

/** A tab with nothing in it: what is missing, and the way to where there is some. */
export function NoneHere({ text, link }: { text: string; link?: { to: string; label: string } }) {
  return (
    <EmptyState className="text-foreground">
      <p className="text-lg">{text}</p>
      {link && (
        <Link
          to={link.to}
          className="mt-3 inline-flex items-center font-medium underline pointer-coarse:min-h-11"
        >
          {link.label}
        </Link>
      )}
    </EmptyState>
  );
}

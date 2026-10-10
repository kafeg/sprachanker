// The head of a course's and an exam's page (09), the same frame: a ring of how far the learner is,
// the title, its chips (the pair, the source, …), a line under them, the way in beside, and what the
// page adds below.
import { usePercent } from "@/ui/format.ts";
import { ProgressRing } from "@/ui/progress-ring.tsx";

export function LibraryHero({
  share,
  title,
  chips,
  line,
  action,
  children,
}: {
  /** How far the learner is, 0..1 (lessons done, an exam's readiness). */
  share: number;
  title: string;
  chips: React.ReactNode;
  line?: React.ReactNode;
  /** The way in, beside on a wide screen. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const percent = usePercent();
  return (
    <section className="mb-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="flex min-w-0 flex-1 basis-80 items-center gap-4 sm:gap-5">
          <ProgressRing value={share} text={percent(share)} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight sm:text-4xl">{title}</h1>
            <div className="my-2 flex flex-wrap items-center gap-1.5 text-sm">{chips}</div>
            {line && <p className="text-sm text-muted-foreground">{line}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

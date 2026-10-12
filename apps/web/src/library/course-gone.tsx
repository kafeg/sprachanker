// A course or an exam not on this computer (a course removed, a stale link): said so, with its offer
// to download it again — the learner's runs and cards meet it by its keys (02) — or, when nothing
// offers it, the way to what is available. Pages outside the shell (a lesson, an exam run) keep the
// screens current while it downloads too.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCatalog } from "@/api/courses.ts";
import { useDownloadsWatch } from "@/api/downloads.ts";
import { OfferCard } from "./card.tsx";

export function CourseGone({
  series,
  course,
  kind = "course",
}: {
  series: string;
  course: string;
  kind?: "course" | "exam";
}) {
  const { t } = useTranslation();
  useDownloadsWatch();
  const offers = (useCatalog().data ?? []).filter(
    (o) => o.series === series && o.course === course && !o.installed,
  );
  return (
    <div className="m-6 max-w-xl space-y-4 rounded-xl border p-4">
      <p>{t(kind === "exam" ? "course.examGone" : "course.gone")}</p>
      {offers.length ? (
        offers.map((offer) => <OfferCard key={offer.key} offer={offer} />)
      ) : (
        <Link
          to={kind === "exam" ? "/exams/catalog" : "/catalog"}
          className="inline-flex items-center font-semibold underline pointer-coarse:min-h-11"
        >
          {t(kind === "exam" ? "exams.tabs.available" : "courses.tabs.available")}
        </Link>
      )}
    </div>
  );
}

// The two filters of a list of courses (09): which language pair and which course, the pair first. Each
// offers only what fits the other one, so the two never combine into an empty page; kept in the profile
// per page. The choosing is `filterCourses` (pure, tested); the hook adds the stored values and the bar.
import { parseEditionId } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useSetSetting } from "@/api/hooks.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { LanguageFlag, usePairName } from "@/ui/flags.tsx";

/** No filter: every course, every pair. */
export const ALL = "all";
/** Where each page keeps its two filters (profile settings). */
export const CATALOG_FILTERS = { course: "catalog.course", pair: "catalog.pair" };
export const MY_FILTERS = { course: "mine.course", pair: "mine.pair" };

/** The items a course title and a pair let through, and what each filter can still offer. */
export function filterCourses<T extends { titles: string[]; editions: string[] }>(
  items: T[],
  title: string,
  pair: string,
) {
  const fitsTitle = (item: T) => title === ALL || item.titles.includes(title);
  const fitsPair = (item: T) => pair === ALL || item.editions.includes(pair);
  return {
    shown: items.filter((i) => fitsTitle(i) && fitsPair(i)),
    titles: [...new Set(items.filter(fitsPair).flatMap((i) => i.titles))].sort((a, b) =>
      a.localeCompare(b),
    ),
    pairs: [...new Set(items.filter(fitsTitle).flatMap((i) => i.editions))].sort(),
    /** A filter is set: its bar must show, so it can be cleared. */
    active: title !== ALL || pair !== ALL,
  };
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, React.ReactNode]>;
  onChange(value: string): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-full space-y-1 sm:w-64">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 w-full bg-card" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("courses.any")}</SelectItem>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function useCourseFilters<T extends { titles: string[]; editions: string[] }>(
  items: T[],
  keys: { course: string; pair: string },
  settings: Record<string, unknown>,
) {
  const { t } = useTranslation();
  const pairName = usePairName();
  const set = useSetSetting();
  const stored = (key: string) => {
    const v = settings[key];
    return typeof v === "string" ? v : ALL;
  };
  const title = stored(keys.course);
  const pair = stored(keys.pair);
  const { shown, titles, pairs, active } = filterCourses(items, title, pair);
  return {
    shown,
    active,
    bar: (
      <div className="mb-6 flex flex-wrap gap-3">
        <Filter
          label={t("courses.pair")}
          value={pair}
          options={pairs.map((p) => [
            p,
            <span key={p} className="flex items-center gap-2">
              <LanguageFlag lang={parseEditionId(p).source} />
              <LanguageFlag lang={parseEditionId(p).target} />
              {pairName(p)}
            </span>,
          ])}
          onChange={(value) => set.mutate({ key: keys.pair, value })}
        />
        <Filter
          label={t("courses.course")}
          value={title}
          options={titles.map((x) => [x, x])}
          onChange={(value) => set.mutate({ key: keys.course, value })}
        />
      </div>
    ),
  };
}

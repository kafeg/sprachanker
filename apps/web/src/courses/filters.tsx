// The two filters of a list of courses (09), the pair first, kept in the profile per page: the hook reads
// the stored values, chooses with `filterCourses` (filter.ts) and draws the bar.
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
import { ALL, filterCourses } from "./filter.ts";

export { FILTERS } from "./filter.ts";

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
  const { shown, titles, pairs, active, title, pair } = filterCourses(
    items,
    stored(keys.course),
    stored(keys.pair),
  );
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

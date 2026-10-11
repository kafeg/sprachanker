// The two filters of a list of courses (09), the pair first, kept in the profile per page (unset, the pair
// is the interface language's): the hook reads the stored values, chooses with `filterCourses`
// (filter.ts) and draws the bar.
import { parseEditionId } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useSetSetting } from "@/api/settings.ts";
import { languageName } from "@/i18n/index.ts";
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
  const { t, i18n } = useTranslation();
  const pairName = usePairName();
  const set = useSetSetting();
  // A pair, or every pair from one language ("Русский → any").
  const pairLabel = (p: string) => {
    const from = /^from:(.+)$/.exec(p)?.[1];
    if (!from)
      return (
        <>
          <LanguageFlag lang={parseEditionId(p).source} />
          <LanguageFlag lang={parseEditionId(p).target} />
          {pairName(p)}
        </>
      );
    return (
      <>
        <LanguageFlag lang={from} />
        {t("courses.languages", {
          from: languageName(from, i18n.language),
          to: t("courses.anyLanguage"),
        })}
      </>
    );
  };
  const stored = (key: string) => {
    const v = settings[key];
    return typeof v === "string" ? v : undefined;
  };
  const { shown, titles, pairs, active, title, pair } = filterCourses(
    items,
    stored(keys.course) ?? ALL,
    stored(keys.pair),
    i18n.language,
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
              {pairLabel(p)}
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

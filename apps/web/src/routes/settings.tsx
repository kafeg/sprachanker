// Settings: interface language, theme, course editions.
import { useTranslation } from "react-i18next";
import { useCourses, useSetSetting, useSettings } from "@/api/hooks.ts";
import { editionSetting, type Theme, useEdition } from "@/app/preferences.ts";
import { nativeName, UI_LANGUAGES } from "@/i18n/index.ts";
import { Page } from "@/ui/app-shell.tsx";
import { cn } from "@/ui/utils.ts";

function Choice({
  options,
  value,
  onChange,
}: {
  options: Array<[string, string]>;
  value?: string;
  onChange(v: string): void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border bg-card p-1">
      {options.map(([v, label]) => (
        <button
          type="button"
          key={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-10 rounded-lg px-4",
            value === v ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function EditionRow({
  series,
  course,
  editions,
  title,
}: {
  series: string;
  course: string;
  editions: string[];
  title: string;
}) {
  const set = useSetSetting();
  const edition = useEdition(series, course, editions);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0">
      <span className="font-medium">{title}</span>
      <Choice
        value={edition}
        options={editions.map((e) => [e, nativeName(e.split("-")[0] ?? e)])}
        onChange={(value) => set.mutate({ key: editionSetting(series, course), value })}
      />
    </div>
  );
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const set = useSetSetting();
  const courses = useCourses();
  const theme = (settings.data?.theme as Theme | undefined) ?? "system";
  return (
    <Page title={t("nav.settings")}>
      <div className="max-w-2xl space-y-8">
        <section className="space-y-2">
          <h2 className="text-xl font-bold">{t("settings.uiLanguage")}</h2>
          <Choice
            value={i18n.language}
            options={UI_LANGUAGES.map((l) => [l, nativeName(l)])}
            onChange={(value) => {
              void i18n.changeLanguage(value);
              set.mutate({ key: "uiLanguage", value });
            }}
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-bold">{t("settings.themeLabel")}</h2>
          <Choice
            value={theme}
            options={(["system", "light", "dark"] as const).map((v) => [
              v,
              t(`settings.theme.${v}`),
            ])}
            onChange={(value) => set.mutate({ key: "theme", value })}
          />
        </section>
        {!!courses.data?.length && (
          <section className="space-y-2">
            <h2 className="text-xl font-bold">{t("settings.editions")}</h2>
            <p className="text-sm text-muted-foreground">{t("settings.editionsHint")}</p>
            <div className="rounded-2xl border bg-card px-4">
              {courses.data
                .filter((c) => c.editions.length > 1)
                .map((c) => (
                  <EditionRow
                    key={c.key}
                    series={c.series}
                    course={c.course}
                    editions={c.editions}
                    title={Object.values(c.titles)[0] ?? c.key}
                  />
                ))}
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}

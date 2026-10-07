// About SprachAnker: what it is, its version, licence and source code (settings, sidebar footer).
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppInfo } from "@/api/hooks.ts";

export const REPOSITORY = "https://github.com/kafeg/sprachanker";

export function AboutSection() {
  const { t } = useTranslation();
  const version = useAppInfo().data?.version;
  return (
    <section id="about" className="space-y-2">
      <h2 className="text-xl font-bold">{t("about.title")}</h2>
      <p className="text-muted-foreground">{t("about.intro")}</p>
      <ul className="space-y-1 text-sm">
        {version && (
          <li>
            {t("about.version")}: <span className="tabular-nums">{version}</span>
          </li>
        )}
        <li>{t("about.licence")}</li>
        <li>
          <a
            href={REPOSITORY}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
          >
            {t("about.source")} <ExternalLink className="size-3.5" />
          </a>
        </li>
      </ul>
    </section>
  );
}

/** The sidebar's last line: version and a link to the source. */
export function AboutLine() {
  const version = useAppInfo().data?.version;
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      {version && <span className="tabular-nums">v{version}</span>}
      <a
        href={REPOSITORY}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 hover:text-foreground"
      >
        GitHub <ExternalLink className="size-3" />
      </a>
    </p>
  );
}

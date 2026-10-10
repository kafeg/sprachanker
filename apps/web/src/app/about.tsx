// About SprachAnker: what it is, its version, licence and source code (settings, sidebar footer).
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppInfo } from "@/api/settings.ts";
import { Panel } from "@/ui/panel.tsx";

const REPOSITORY = "https://github.com/kafeg/sprachanker";

export function AboutSection() {
  const { t } = useTranslation();
  const version = useAppInfo().data?.version;
  return (
    <Panel id="about" title={t("about.title")} className="space-y-2">
      <p className="text-sm text-muted-foreground">{t("about.intro")}</p>
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
            className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline pointer-coarse:min-h-11"
          >
            {t("about.source")} <ExternalLink className="size-3.5" />
          </a>
        </li>
      </ul>
    </Panel>
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
        className="inline-flex items-center gap-0.5 hover:text-foreground pointer-coarse:min-h-11"
      >
        GitHub <ExternalLink className="size-3" />
      </a>
    </p>
  );
}

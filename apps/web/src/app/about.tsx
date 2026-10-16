// About SprachAnker: what it is, its version, licence, source code and the third-party components with
// their licences (settings, sidebar footer).
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppInfo, useThirdPartyNotices } from "@/api/settings.ts";
import { errorText } from "@/ui/error-text.ts";
import { Panel } from "@/ui/panel.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";

const REPOSITORY = "https://github.com/kafeg/sprachanker";

const linkClass =
  "inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline pointer-coarse:min-h-11";

/** The third-party components and their licences as the build carries them, in a side panel. */
function ThirdPartyNotices({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const notices = useThirdPartyNotices(open);
  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("about.notices")}
      className="overflow-y-auto sm:max-w-2xl"
    >
      <div className="space-y-3 px-4 pb-6 text-sm">
        {notices.isPending ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : notices.isError ? (
          <p role="alert" className="text-destructive">
            {errorText(t, notices.error)}
          </p>
        ) : notices.data === null ? (
          <p className="text-muted-foreground">{t("about.noticesMissing")}</p>
        ) : (
          <>
            <p className="text-muted-foreground">{t("about.noticesIntro")}</p>
            <pre dir="ltr" className="whitespace-pre-wrap break-words font-mono text-xs">
              {notices.data}
            </pre>
          </>
        )}
      </div>
    </SideSheet>
  );
}

export function AboutSection() {
  const { t } = useTranslation();
  const version = useAppInfo().data?.version;
  const [notices, setNotices] = useState(false);
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
          <a href={REPOSITORY} target="_blank" rel="noreferrer" className={linkClass}>
            {t("about.source")} <ExternalLink className="size-3.5" />
          </a>
        </li>
        <li>
          <button type="button" className={linkClass} onClick={() => setNotices(true)}>
            {t("about.notices")}
          </button>
        </li>
      </ul>
      <ThirdPartyNotices open={notices} onOpenChange={setNotices} />
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

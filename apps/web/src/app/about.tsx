// About SprachAnker: what it is, its version — a newer one when it is out, with the way this build
// is updated —, licence, source code and the third-party components with their licences (settings,
// sidebar footer).
import type { UpdateStatus } from "@sprachanker/schema";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppInfo, useThirdPartyNotices } from "@/api/settings.ts";
import { desktopShell, useDesktopUpdate, useInstallUpdate, useUpdate } from "@/api/update.ts";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { Panel } from "@/ui/panel.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";
import { CopyButton } from "./other-devices.tsx";

const REPOSITORY = "https://github.com/kafeg/sprachanker";
/** The installer's program is updated by its install command again (README's Install). */
export const INSTALL_COMMAND =
  "curl -fsSL https://github.com/kafeg/sprachanker/releases/latest/download/install.sh | bash";

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

/** How this build takes the newer version: the desktop app's window updates it (elsewhere: on the
 *  computer), the phone app downloads and installs it, the installer's program runs its command
 *  again — a new archive on Windows —, iOS's app is built again by hand. */
function UpdateHow({ status }: { status: UpdateStatus }) {
  const { t } = useTranslation();
  const desktop = useDesktopUpdate();
  const install = useInstallUpdate();
  const failed = desktop.error ?? install.error;
  let how: ReactNode = null;
  if (status.by === "desktop")
    how = desktopShell() ? (
      <Button size="sm" loading={desktop.isPending} onClick={() => desktop.mutate()}>
        {desktop.isPending ? t("about.updating") : t("about.updateRestart")}
      </Button>
    ) : (
      <p>{t("about.updateOnComputer")}</p>
    );
  else if (status.by === "phone")
    how = status.installs ? (
      <>
        <Button size="sm" loading={install.isPending} onClick={() => install.mutate()}>
          {install.isPending ? t("about.updating") : t("about.updateInstall")}
        </Button>
        <p className="text-muted-foreground">{t("about.updateInstallHint")}</p>
      </>
    ) : status.system === "ios" ? (
      <p>{t("about.updateIos")}</p>
    ) : null;
  else if (status.by === "program")
    how =
      status.system === "windows" ? (
        <p>{t("about.updateArchive")}</p>
      ) : (
        <>
          <p>{t("about.updateCommand")}</p>
          <div className="flex items-center gap-1">
            <code
              dir="ltr"
              className="min-w-0 break-all rounded bg-muted px-2 py-1 font-mono text-xs"
            >
              {INSTALL_COMMAND}
            </code>
            <CopyButton text={INSTALL_COMMAND} label={t("about.copyCommand")} />
          </div>
        </>
      );
  return (
    <>
      {how}
      {failed && (
        <p role="alert" className="text-destructive">
          {errorText(t, failed)}
        </p>
      )}
    </>
  );
}

/** A newer version, when one is out: its number, how to take it, what is new in it. */
function UpdateLine() {
  const { t } = useTranslation();
  const status = useUpdate().data;
  if (!status?.newer) return null;
  return (
    <li className="space-y-2 rounded-lg border border-primary/40 p-3">
      <p className="font-medium">{t("about.newer", { version: status.newer.version })}</p>
      <UpdateHow status={status} />
      <a href={status.newer.url} target="_blank" rel="noreferrer" className={linkClass}>
        {t("about.whatsNew")} <ExternalLink className="size-3.5" />
      </a>
    </li>
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
        <UpdateLine />
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

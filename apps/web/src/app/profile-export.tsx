// Settings → Profile → moving the profile to another computer (05, "Profile file"; 09): the server
// makes its file ready, the browser downloads it; what it holds and leaves out said in a line.
import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ExportedProfile, exportUrl, prepareExport } from "@/api/session.ts";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useBytes } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";

/** A file downloaded by the browser, under its own name. */
function startDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

export function ProfileExport({
  prepare = prepareExport,
  download = startDownload,
}: {
  /** Tests give their own: the file made ready, and downloaded. */
  prepare?: () => Promise<ExportedProfile>;
  download?: (url: string, fileName: string) => void;
}) {
  const { t } = useTranslation();
  const bytes = useBytes();
  const exported = useMutation({
    mutationFn: prepare,
    onSuccess: (ready) => download(exportUrl(ready.id), ready.fileName),
  });
  return (
    <Panel title={t("profile.export.title")}>
      <p className="text-sm text-muted-foreground">{t("profile.export.body")}</p>
      <Button
        variant="outline"
        className="mt-3"
        loading={exported.isPending}
        onClick={() => exported.mutate()}
      >
        <Download /> {t("profile.export.button")}
      </Button>
      {exported.data && (
        <p className="mt-2 text-sm" role="status">
          {t("profile.export.started", {
            file: exported.data.fileName,
            size: bytes(exported.data.bytes),
          })}
        </p>
      )}
      {exported.isError && (
        <p className="mt-2 text-sm text-wrong">{errorText(t, exported.error)}</p>
      )}
    </Panel>
  );
}

// A model or voice the server downloads (08; Settings → Speech): its name, size and a failed download
// noted, what it offers once there (use it, the mark of the one in use), and its action — download,
// the download's progress, or remove.
import { Download, LoaderCircle, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { useBytes, usePercent } from "@/ui/format.ts";
import { cn } from "@/ui/utils.ts";

interface Downloadable {
  installed: boolean;
  bytes: number;
  /** Bytes so far while it downloads. */
  downloaded?: number;
  /** Why its last download failed. */
  error?: string;
}

export function DownloadRow({
  title,
  item,
  removeLabel,
  onDownload,
  onRemove,
  starting = false,
  marked = false,
  compact = false,
  children,
}: {
  title: React.ReactNode;
  item: Downloadable;
  /** The remove button's name ("Remove thorsten"). */
  removeLabel: string;
  onDownload(): void;
  onRemove(): void;
  /** The download asked for and not begun yet. */
  starting?: boolean;
  /** The one in use: bordered. */
  marked?: boolean;
  /** A line in a list (a language's voices) rather than a card. */
  compact?: boolean;
  /** What it offers once there (shown while installed). */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const bytes = useBytes();
  const percent = usePercent();
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3",
        compact ? "gap-2 text-sm" : "rounded-xl border p-3",
        marked && "border-primary",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block", !compact && "font-medium")}>{title}</span>
        <span className="text-xs text-muted-foreground">
          {bytes(item.bytes)}
          {item.error && ` · ${t("speech.settings.downloadFailed")}`}
        </span>
      </span>
      {item.installed && children}
      {item.installed ? (
        <Button variant="ghost" size="sm" aria-label={removeLabel} onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      ) : item.downloaded !== undefined ? (
        <span className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {percent(item.downloaded / item.bytes)}
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={onDownload} loading={starting}>
          <Download className="size-4" /> {t("speech.settings.download")}
        </Button>
      )}
    </li>
  );
}

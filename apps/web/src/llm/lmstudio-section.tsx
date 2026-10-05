// Settings → AI assistant → LM Studio: is it running, which of its models to use, suggested downloads.
// LM Studio stores the models and picks the engine; the app only asks it.
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { cn } from "@/ui/utils.ts";
import { type LlmState, useLmStudio, useLmStudioAction, useSetRoute } from "./api.ts";
import { errorText } from "./errors.ts";

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);

export function LmStudioSection({ state }: { state: LlmState }) {
  const { t } = useTranslation();
  const studio = useLmStudio();
  const action = useLmStudioAction();
  const setRoute = useSetRoute();
  const status = studio.data;
  const models = status?.models ?? [];
  const chosen = models.some((m) => m.key === state.model);

  // Nothing chosen yet (or the chosen model is gone): take the suggested one if LM Studio has it.
  const pick =
    status?.suggestions.find((s) => s.recommended && s.downloaded)?.key ?? models[0]?.key;
  useEffect(() => {
    if (pick && !chosen && !setRoute.isPending)
      setRoute.mutate({ provider: "lmstudio", model: pick });
  }, [pick, chosen, setRoute]);

  if (!status) return studio.isPending ? <LoaderCircle className="size-5 animate-spin" /> : null;

  if (!status.running) {
    const canStart = status.installed && status.local;
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-1.5">
          <CircleX className="mt-0.5 size-4 shrink-0 text-wrong" />
          {status.error === "llm_unauthorized"
            ? t("lmstudio.needsToken")
            : canStart
              ? t("lmstudio.notRunning")
              : status.local && !status.installed
                ? t("lmstudio.notInstalled")
                : errorText(t, new Error(status.error ?? "llm_unreachable"), "lmstudio")}
        </p>
        {canStart && status.error !== "llm_unauthorized" && (
          <Button onClick={() => action.mutate({ start: true })} disabled={action.isPending}>
            {action.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {t("lmstudio.start")}
          </Button>
        )}
        {action.isError && <p className="text-sm text-wrong">{errorText(t, action.error)}</p>}
      </div>
    );
  }

  const missing = status.suggestions.filter((s) => !s.downloaded);
  return (
    <div className="space-y-4">
      <p role="status" className="flex items-center gap-1.5 text-sm">
        <CircleCheck className="size-4 text-correct" /> {t("lmstudio.running")}
      </p>
      {models.length === 0 ? (
        <p className="text-muted-foreground">{t("lmstudio.noModels")}</p>
      ) : (
        <div className="space-y-2">
          <p className="font-medium">{t("lmstudio.models")}</p>
          <ul className="space-y-2">
            {models.map((m) => {
              const inUse = m.key === state.model;
              return (
                <li
                  key={m.key}
                  className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3",
                    inUse && "border-primary bg-accent/40",
                  )}
                >
                  <span className="font-semibold">{m.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {[
                      m.format.toUpperCase(),
                      m.quantization,
                      `${gb(m.sizeBytes)} ${t("lmstudio.gb")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {m.loaded.length > 0 && <Badge variant="secondary">{t("lmstudio.loaded")}</Badge>}
                  <span className="ml-auto">
                    {inUse ? (
                      <Badge>{t("lmstudio.inUse")}</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRoute.mutate({ provider: "lmstudio", model: m.key })}
                      >
                        {t("lmstudio.use")}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">{t("lmstudio.suggested")}</p>
          <p className="text-sm text-muted-foreground">
            {t("lmstudio.suggestedHint", { memory: status.memoryGb })}
          </p>
          <ul className="space-y-2">
            {missing.map((s) => {
              const d = s.download;
              const busy = d?.status === "downloading" || d?.status === "paused";
              return (
                <li key={s.key} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{s.title}</span>
                    {s.recommended && (
                      <Badge variant="secondary">{t("lmstudio.recommended")}</Badge>
                    )}
                    <span className="text-sm text-muted-foreground">
                      {t("lmstudio.size", { size: s.sizeGb.toFixed(1), ram: s.ramGb })}
                    </span>
                  </div>
                  {busy && d?.totalBytes ? (
                    <div className="mt-2 space-y-1">
                      <Progress
                        value={((d.downloadedBytes ?? 0) / d.totalBytes) * 100}
                        className="h-2"
                      />
                      <p className="text-sm text-muted-foreground">
                        {t("lmstudio.progress", {
                          done: gb(d.downloadedBytes ?? 0),
                          total: gb(d.totalBytes),
                        })}
                      </p>
                    </div>
                  ) : (
                    <Button
                      className="mt-2"
                      onClick={() => action.mutate({ download: s.key })}
                      disabled={action.isPending}
                    >
                      {t("lmstudio.download")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

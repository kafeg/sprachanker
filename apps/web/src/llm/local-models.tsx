// Settings → AI assistant → built-in model: download a model, pick it, see whether it runs.
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Choice } from "@/ui/choice.tsx";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { cn } from "@/ui/utils.ts";
import {
  type EngineId,
  type LlmState,
  type LocalStatus,
  useLocalAction,
  useLocalModels,
  useSetLocalEngine,
  useSetRoute,
} from "./api.ts";

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
const mb = (bytes: number) => Math.round(bytes / 1e6);
const ENGINE_NAMES = { mlx: "MLX", llama: "llama.cpp" } as const;

function Running({ status, state }: { status: LocalStatus; state: LlmState }) {
  const { t } = useTranslation();
  const run = status.running;
  if (!run || run.model !== state.model) return null;
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm">
      {run.state === "starting" && (
        <>
          <LoaderCircle className="size-4 animate-spin" /> {t("local.starting")}
        </>
      )}
      {run.state === "ready" && (
        <>
          <CircleCheck className="size-4 text-correct" /> {t("local.running")}
        </>
      )}
      {run.state === "failed" && (
        <>
          <CircleX className="size-4 shrink-0 text-wrong" />{" "}
          {t("local.failed", { error: run.error })}
        </>
      )}
    </p>
  );
}

export function LocalModels({ state }: { state: LlmState }) {
  const { t } = useTranslation();
  const local = useLocalModels(true);
  const action = useLocalAction();
  const setRoute = useSetRoute();
  const setEngine = useSetLocalEngine();
  const status = local.data;
  const engines = status?.engines.filter((e) => e.available) ?? [];
  const engine = status?.engines.find((e) => e.id === status.engine);
  const ready = status?.models.filter((m) => m.state === "ready") ?? [];
  const chosen = ready.some((m) => m.id === state.model);

  // The first downloaded model becomes the one in use.
  const first = ready[0]?.id;
  useEffect(() => {
    if (first && !chosen && !setRoute.isPending)
      setRoute.mutate({ provider: "builtin", model: first });
  }, [first, chosen, setRoute]);

  if (!status) return null;
  if (!status.available) return <p className="text-muted-foreground">{t("local.unavailable")}</p>;
  const act = (id: string, kind: "download" | "cancel" | "remove") =>
    action.mutate({ id, action: kind });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("local.intro", { memory: status.memoryGb })}
      </p>
      <Running status={status} state={state} />
      {engines.length > 1 && (
        <div className="space-y-1.5">
          <p className="font-medium">{t("local.engineLabel")}</p>
          <Choice
            value={status.engine ?? undefined}
            options={engines.map((e): [string, string] => [
              e.id,
              e.recommended
                ? t("local.recommendedEngine", { name: ENGINE_NAMES[e.id] })
                : ENGINE_NAMES[e.id],
            ])}
            onChange={(id) => setEngine.mutate(id as EngineId)}
          />
          <p className="text-sm text-muted-foreground">
            {t(`local.engineHint.${status.engine ?? "llama"}`)}
          </p>
        </div>
      )}
      {engine && engine.state !== "ready" && (
        <div className="space-y-1">
          {engine.state === "downloading" && (
            <Progress value={(engine.received / engine.downloadSize) * 100} className="h-1.5" />
          )}
          <p
            className={cn(
              "text-sm",
              engine.state === "failed" ? "text-wrong" : "text-muted-foreground",
            )}
          >
            {engine.state === "failed"
              ? t("local.engineFailed", { name: ENGINE_NAMES[engine.id], error: engine.error })
              : engine.state === "setup"
                ? t("local.engineSetup", { name: ENGINE_NAMES[engine.id] })
                : engine.state === "downloading"
                  ? t("local.engine", {
                      name: ENGINE_NAMES[engine.id],
                      done: mb(engine.received),
                      total: mb(engine.downloadSize),
                    })
                  : t("local.engineAbsent", {
                      name: ENGINE_NAMES[engine.id],
                      size: mb(engine.installSize),
                    })}
          </p>
        </div>
      )}
      <ul className="space-y-3">
        {status.models.map((m) => {
          const inUse = m.state === "ready" && m.id === state.model;
          const progress = (m.received / m.sizeBytes) * 100;
          return (
            <li
              key={m.id}
              className={cn("rounded-xl border p-3 sm:p-4", inUse && "border-primary bg-accent/40")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{m.title}</span>
                {m.recommended && <Badge variant="secondary">{t("local.recommended")}</Badge>}
                {inUse && <Badge>{t("local.inUse")}</Badge>}
                <span className="text-sm text-muted-foreground">
                  {t("local.size", { size: gb(m.sizeBytes), ram: m.ramGb })}
                </span>
              </div>
              {m.inLmStudio && m.state !== "ready" && (
                <p className="mt-1 text-sm text-muted-foreground">{t("local.inLmStudio")}</p>
              )}
              {(m.state === "downloading" || m.state === "paused" || m.state === "failed") && (
                <div className="mt-2 space-y-1">
                  <Progress value={progress} className="h-2" />
                  <p className="text-sm text-muted-foreground">
                    {m.state === "failed"
                      ? t("local.downloadFailed")
                      : t("local.progress", { done: gb(m.received), total: gb(m.sizeBytes) })}
                  </p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {m.state === "absent" && (
                  <Button onClick={() => act(m.id, "download")}>{t("local.download")}</Button>
                )}
                {m.state === "downloading" && (
                  <Button variant="outline" onClick={() => act(m.id, "cancel")}>
                    {t("local.pause")}
                  </Button>
                )}
                {(m.state === "paused" || m.state === "failed") && (
                  <Button onClick={() => act(m.id, "download")}>{t("local.resume")}</Button>
                )}
                {m.state === "ready" && !inUse && (
                  <Button onClick={() => setRoute.mutate({ provider: "builtin", model: m.id })}>
                    {t("local.use")}
                  </Button>
                )}
                {m.state !== "absent" && m.state !== "downloading" && (
                  <Button variant="ghost" onClick={() => act(m.id, "remove")}>
                    {t("local.remove")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

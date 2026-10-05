// Settings → AI assistant: provider, endpoint, API key, model, connection check.
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import {
  type LlmState,
  type ProviderId,
  useLlm,
  useModels,
  useSetProvider,
  useSetRoute,
} from "./api.ts";
import { errorText } from "./errors.ts";
import { LmStudioSection } from "./lmstudio-section.tsx";

type Provider = LlmState["providers"][number];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="block space-y-1.5">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
    </label>
  );
}

function EndpointField({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const set = useSetProvider();
  const [value, setValue] = useState(provider.baseUrl);
  useEffect(() => setValue(provider.baseUrl), [provider.baseUrl]);
  const save = () => {
    const url = value.trim();
    if (url === provider.baseUrl) return;
    set.mutate({ id: provider.id, baseUrl: url && url !== provider.defaultUrl ? url : null });
  };
  return (
    <Field label={t("llm.endpoint")} hint={set.isError ? t("llm.endpointInvalid") : undefined}>
      <Input
        className="h-11"
        inputMode="url"
        spellCheck={false}
        placeholder={provider.defaultUrl || "http://192.168.1.10:8080/v1"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
    </Field>
  );
}

function KeyField({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const set = useSetProvider();
  const [value, setValue] = useState("");
  const save = () => {
    if (!value.trim()) return;
    set.mutate({ id: provider.id, apiKey: value.trim() }, { onSuccess: () => setValue("") });
  };
  return (
    <Field
      label={t("llm.apiKey")}
      hint={provider.id === "openrouter" ? t("llm.openrouterKeyHint") : t("llm.keyHint")}
    >
      <div className="flex gap-2">
        <Input
          className="h-11"
          type="password"
          autoComplete="off"
          placeholder={provider.hasKey ? t("llm.keySaved") : "sk-…"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        {value.trim() ? (
          <Button size="lg" onClick={save}>
            {t("llm.save")}
          </Button>
        ) : (
          provider.hasKey && (
            <Button
              size="lg"
              variant="outline"
              onClick={() => set.mutate({ id: provider.id, apiKey: null })}
            >
              {t("llm.removeKey")}
            </Button>
          )
        )}
      </div>
    </Field>
  );
}

function ModelField({ state, provider }: { state: LlmState; provider: Provider }) {
  const { t } = useTranslation();
  const listId = useId();
  const setRoute = useSetRoute();
  const models = useModels(provider.id);
  const [value, setValue] = useState(state.model ?? "");
  useEffect(() => setValue(state.model ?? ""), [state.model]);
  // Check the connection whenever the provider or its endpoint/key changes.
  const { refetch } = models;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check when the endpoint or key changes
  useEffect(() => {
    void refetch();
  }, [provider.id, provider.baseUrl, provider.hasKey, refetch]);
  const save = (model: string) => {
    const m = model.trim();
    if (m !== (state.model ?? "")) setRoute.mutate({ provider: provider.id, model: m || null });
  };
  const list = models.data?.models ?? [];
  // A local server with exactly one model: take it.
  useEffect(() => {
    const only = list.length === 1 ? list[0]?.id : undefined;
    if (only && !state.model && !setRoute.isPending)
      setRoute.mutate({ provider: provider.id, model: only });
  }, [list, state.model, provider.id, setRoute]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="lg" onClick={() => void models.refetch()}>
          {t("llm.check")}
        </Button>
        <span role="status" className="flex items-center gap-1.5 text-sm">
          {models.isFetching ? (
            <>
              <LoaderCircle className="size-4 animate-spin" /> {t("llm.checking")}
            </>
          ) : models.isError ? (
            <>
              <CircleX className="size-4 shrink-0 text-wrong" />
              {errorText(t, models.error, provider.id)}
            </>
          ) : models.data ? (
            <>
              <CircleCheck className="size-4 shrink-0 text-correct" />
              {t("llm.connected", { count: list.length, ms: models.data.ms })}
            </>
          ) : null}
        </span>
      </div>
      <Field label={t("llm.model")} hint={t("llm.modelHint")}>
        <Input
          className="h-11"
          list={listId}
          spellCheck={false}
          placeholder={list[0]?.id ?? "qwen3-8b"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            // Picking from the list saves at once; typing saves on blur.
            if (list.some((m) => m.id === e.target.value)) save(e.target.value);
          }}
          onBlur={() => save(value)}
          onKeyDown={(e) => e.key === "Enter" && save(value)}
        />
        <datalist id={listId}>
          {list.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
      </Field>
    </div>
  );
}

export function LlmSettings() {
  const { t } = useTranslation();
  const llm = useLlm();
  const setRoute = useSetRoute();
  const state = llm.data;
  if (!state) return null;
  const provider = state.providers.find((p) => p.id === state.provider);
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-bold">{t("llm.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("llm.intro")}</p>
      <Choice
        value={state.provider ?? "off"}
        options={[
          ["off", t("llm.off")],
          ...state.providers.map((p): [string, string] => [p.id, t(`llm.provider.${p.id}`)]),
        ]}
        onChange={(v) =>
          setRoute.mutate({
            provider: v === "off" ? null : (v as ProviderId),
            model: v === state.provider ? state.model : null,
          })
        }
      />
      {provider && (
        <div className="mt-3 space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
          {provider.id === "lmstudio" && (
            <p className="text-sm text-muted-foreground">{t("llm.lmstudioHint")}</p>
          )}
          {provider.editableUrl && <EndpointField provider={provider} />}
          {provider.key !== "none" && <KeyField provider={provider} />}
          {provider.id === "lmstudio" ? (
            <LmStudioSection state={state} />
          ) : (
            <ModelField state={state} provider={provider} />
          )}
        </div>
      )}
    </section>
  );
}

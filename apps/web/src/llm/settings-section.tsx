// Settings → AI assistant (07; 09): the providers as cards, then the chosen one's endpoint, key (with
// what OpenRouter tells of it), connection check and model list. `AssistantSetup` is also the
// onboarding's AI step.
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { errorText, setupProblem } from "./errors.ts";
import { KeyState } from "./key-state.tsx";
import { LmStudioSection } from "./lmstudio-section.tsx";
import { ModelList } from "./model-list.tsx";
import { ProviderCards } from "./provider-cards.tsx";
import {
  type LlmState,
  type ProviderId,
  useLlm,
  useModels,
  useSetProvider,
  useSetRoute,
} from "./setup-api.ts";

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
      hint={t(`llm.keyHintFor.${provider.id}`, { defaultValue: t("llm.keyHint") })}
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
  const setRoute = useSetRoute();
  const models = useModels(provider.id);
  const [value, setValue] = useState(state.model ?? "");
  useEffect(() => setValue(state.model ?? ""), [state.model]);
  // What the provider lacks, if anything: said at once, without asking the server.
  const problem = setupProblem(provider);
  // Check the connection whenever the provider or its endpoint/key changes (once it can be checked).
  const { refetch } = models;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check when the endpoint or key changes
  useEffect(() => {
    if (!problem) void refetch();
  }, [provider.id, provider.baseUrl, provider.hasKey, problem, refetch]);
  const save = (model: string) => {
    const m = model.trim();
    if (m !== (state.model ?? "")) setRoute.mutate({ provider: provider.id, model: m || null });
  };
  const list = models.data?.models ?? [];
  const [other, setOther] = useState(false);
  // Typing a name: chosen as "another model", or the saved model is not in the provider's list.
  const typing =
    other || (!!state.model && !!list.length && !list.some((m) => m.id === state.model));
  // A local server with exactly one model: take it.
  useEffect(() => {
    const only = list.length === 1 ? list[0]?.id : undefined;
    if (only && !state.model && !setRoute.isPending)
      setRoute.mutate({ provider: provider.id, model: only });
  }, [list, state.model, provider.id, setRoute]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="lg"
          disabled={!!problem}
          onClick={() => void models.refetch()}
        >
          {t("llm.check")}
        </Button>
        <span role="status" className="flex items-center gap-1.5 text-sm">
          {problem ? (
            <>
              <CircleX className="size-4 shrink-0 text-wrong" />
              {errorText(t, new Error(problem), provider.id)}
            </>
          ) : models.isFetching ? (
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
      <div className="space-y-1.5">
        <p className="font-medium">{t("llm.model")}</p>
        {/* The provider's models in a list; a model it does not list (or none listed) is typed. */}
        {!!list.length && !typing && (
          <ModelList key={provider.id} models={list} value={state.model} onPick={save} />
        )}
        {!!list.length && (
          <Button variant="ghost" size="sm" onClick={() => setOther((on) => !on)}>
            {typing ? t("llm.list.backToList") : t("llm.otherModel")}
          </Button>
        )}
        {(typing || !list.length) && (
          <Input
            className="mt-2 h-11 max-w-md"
            spellCheck={false}
            placeholder="qwen3-8b"
            aria-label={t("llm.modelName")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => save(value)}
            onKeyDown={(e) => e.key === "Enter" && save(value)}
          />
        )}
        {(typing || !list.length) && (
          <p className="text-sm text-muted-foreground">{t("llm.modelTypeHint")}</p>
        )}
      </div>
    </div>
  );
}

/** The providers as cards and the chosen one's settings: Settings → AI assistant and onboarding. */
export function AssistantSetup() {
  const { t } = useTranslation();
  const llm = useLlm();
  const setRoute = useSetRoute();
  const state = llm.data;
  if (!state) return null;
  const provider = state.providers.find((p) => p.id === state.provider);
  return (
    <div className="space-y-3">
      <ProviderCards
        state={state}
        onPick={(id: ProviderId | null) =>
          setRoute.mutate({ provider: id, model: id === state.provider ? state.model : null })
        }
      />
      {provider && (
        <div className="space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
          <p className="text-sm text-muted-foreground">{t(`llm.about.${provider.id}`)}</p>
          {provider.installed === false && (
            <p className="flex items-start gap-1.5 text-sm">
              <CircleX className="mt-0.5 size-4 shrink-0 text-wrong" />
              {t(`llm.cliMissing.${provider.id}`)}
            </p>
          )}
          {provider.editableUrl && <EndpointField provider={provider} />}
          {provider.key !== "none" && <KeyField provider={provider} />}
          {provider.id === "openrouter" && <KeyState provider={provider} />}
          {provider.id === "lmstudio" ? (
            <LmStudioSection state={state} />
          ) : (
            <ModelField state={state} provider={provider} />
          )}
        </div>
      )}
    </div>
  );
}

export function LlmSettings() {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-bold">{t("llm.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("llm.intro")}</p>
      <AssistantSetup />
    </section>
  );
}

// Debugging: what exactly goes to the model — provider, model, request fields and every message.
import { Braces, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetting } from "@/api/hooks.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { DEBUG_PROMPTS, fetchPrompt, type PromptPreview, type PromptRequest } from "./api.ts";
import { errorText } from "./errors.ts";

export const useDebugPrompts = () => useSetting(DEBUG_PROMPTS);

function Preview({ preview }: { preview: PromptPreview }) {
  const { t } = useTranslation();
  const { messages, ...fields } = preview.body;
  const total = messages.reduce((n, m) => n + m.content.length, 0);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("prompt.endpoint")}</dt>
        <dd className="break-all font-mono">{preview.url}</dd>
        {Object.entries(fields).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="font-mono">{JSON.stringify(value)}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">{t("prompt.size")}</dt>
        <dd>
          {t("prompt.sizeValue", {
            chars: total,
            tokens: preview.tokens.reduce((n, k) => n + k, 0),
          })}
        </dd>
      </dl>
      {messages.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: messages of one request, fixed order
        <section key={i} className="space-y-1">
          <p className="flex items-center gap-2 text-sm">
            <Badge variant={m.role === "system" ? "default" : "secondary"}>{m.role}</Badge>
            <span className="text-muted-foreground">
              {t("prompt.sizeValue", { chars: m.content.length, tokens: preview.tokens[i] ?? 0 })}
            </span>
          </p>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[13px] leading-relaxed">
            {m.content}
          </pre>
        </section>
      ))}
      <Button
        variant="outline"
        onClick={() => void navigator.clipboard?.writeText(JSON.stringify(preview.body, null, 2))}
      >
        <Copy className="size-4" /> {t("prompt.copy")}
      </Button>
    </div>
  );
}

/** "Prompt" button, shown when debugging prompts is on in the settings. */
export function PromptButton({ request }: { request: PromptRequest | (() => PromptRequest) }) {
  const { t } = useTranslation();
  const debug = useDebugPrompts();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PromptPreview>();
  const [error, setError] = useState<unknown>();
  if (!debug) return null;
  const show = () => {
    setOpen(true);
    setPreview(undefined);
    setError(undefined);
    fetchPrompt(typeof request === "function" ? request() : request)
      .then(setPreview)
      .catch(setError);
  };
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={show}
        aria-label={t("prompt.button")}
        title={t("prompt.button")}
        className="size-8 text-muted-foreground/60 hover:text-foreground"
      >
        <Braces className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-2xl">
          <SheetHeader className="p-0">
            <SheetTitle>
              {preview
                ? `${t("prompt.title")} · ${t(`llm.provider.${preview.provider}`)} · ${preview.model}`
                : t("prompt.title")}
            </SheetTitle>
          </SheetHeader>
          {preview ? (
            <Preview preview={preview} />
          ) : error ? (
            <p className="text-wrong">{errorText(t, error)}</p>
          ) : (
            <LoaderCircle className="size-5 animate-spin" />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

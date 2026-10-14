// More of a step's practice (owner, 2026-10-14): made into the course's practice, as many as chosen
// (1–3), the next taken here. Making needs an AI model — and, for a text to hear, Qwen3-TTS to record
// it —: without them the button says why instead.
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { inPhoneApp } from "@/api/client.ts";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import { usePracticeVoice } from "./api.ts";
import { useLlm } from "./setup-api.ts";

type MoreProps = Parameters<typeof MoreControls>[0];

/** None in the phone app: the practice is made on the computer and comes with the course. */
export const MoreButton = (props: MoreProps) => (inPhoneApp ? null : <MoreControls {...props} />);

function MoreControls({
  label,
  busyLabel,
  preparing,
  disabled = false,
  edition,
  needsVoice = false,
  onMake,
}: {
  label: string;
  busyLabel: string;
  preparing: boolean;
  disabled?: boolean;
  edition: string;
  /** Its work is recorded (a text to hear): Qwen3-TTS needed. */
  needsVoice?: boolean;
  onMake(count: number): void;
}) {
  const { t } = useTranslation();
  const llm = useLlm();
  const voice = usePracticeVoice(edition, needsVoice);
  const [count, setCount] = useState("1");
  const why = !llm.data?.model
    ? t("practice.needsModel")
    : needsVoice && voice.data && !voice.data.voice
      ? t("error.practice_needs_voice")
      : undefined;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!why && (
        <Choice
          label={t("practice.count")}
          value={count}
          onChange={setCount}
          options={["1", "2", "3"].map((n) => [n, t("practice.times", { count: Number(n) })])}
        />
      )}
      <Button
        variant="outline"
        loading={preparing}
        disabled={preparing || disabled || !!why}
        onClick={() => onMake(Number(count))}
      >
        {!preparing && <RefreshCw className="size-4" />}
        {preparing ? busyLabel : label}
      </Button>
      {why && <p className="basis-full text-end text-sm text-muted-foreground">{why}</p>}
    </div>
  );
}

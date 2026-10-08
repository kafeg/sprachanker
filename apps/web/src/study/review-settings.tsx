// Settings → Review (04; 09): Anki's deck options for the profile — daily limits, desired retention,
// learning and relearning steps, when the day starts, whether new cards count against the review
// limit, and the card types a new word gets. Each saved when changed; Anki's defaults one tap away.
import { SRS_DEFAULTS, STEP } from "@sprachanker/engine";
import {
  CardFace,
  type LearnerSettingKey,
  SETTING_DEFAULTS,
  type SettingValue,
  settingOf,
} from "@sprachanker/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "@/api/hooks.ts";
import { Chip } from "@/ui/chip.tsx";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { Slider } from "@/ui/components/slider.tsx";
import { useDateFormat, usePercent } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";

type Option = Extract<LearnerSettingKey, `srs.${string}`> & keyof typeof DEFAULT_VALUES;
/** Anki's defaults of every option here: the engine's for the scheduler, the schema's for the rest. */
const DEFAULT_VALUES = {
  "srs.newPerDay": SRS_DEFAULTS.newPerDay,
  "srs.reviewsPerDay": SRS_DEFAULTS.reviewsPerDay,
  "srs.retention": SRS_DEFAULTS.retention,
  "srs.learningSteps": [...SRS_DEFAULTS.learningSteps],
  "srs.relearningSteps": [...SRS_DEFAULTS.relearningSteps],
  "srs.dayStartHour": SRS_DEFAULTS.dayStartHour,
  "srs.newIgnoresReviewLimit": SETTING_DEFAULTS["srs.newIgnoresReviewLimit"],
  "srs.faces": [...SETTING_DEFAULTS["srs.faces"]],
} satisfies { [K in LearnerSettingKey]?: SettingValue<K> };
const DEFAULTS: { [K in Option]: SettingValue<K> } = DEFAULT_VALUES;

/** Steps as typed ("1m 10m") into the stored list, or undefined while one does not read. */
export function parseSteps(text: string, allowNone = false): string[] | undefined {
  const steps = text.split(/[\s,]+/).filter(Boolean);
  if (!steps.length) return allowNone ? [] : undefined;
  return steps.every((s) => STEP.test(s)) ? steps : undefined;
}

function NumberField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave(n: number): void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const save = () => {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 0 && n <= 9999 && n !== value) onSave(n);
    else setText(String(value));
  };
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is inside
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      <Input
        className="h-11 w-32"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
    </label>
  );
}

function StepsField({
  label,
  hint,
  value,
  allowNone,
  onSave,
}: {
  label: string;
  hint: string;
  value: string[];
  allowNone?: boolean;
  onSave(steps: string[]): void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value.join(" "));
  useEffect(() => setText(value.join(" ")), [value]);
  const steps = parseSteps(text, allowNone);
  const save = () => {
    if (steps && steps.join(" ") !== value.join(" ")) onSave(steps);
  };
  return (
    <div className="space-y-1">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is inside */}
      <label className="block space-y-1">
        <span className="block text-sm font-medium">{label}</span>
        <Input
          className="h-11 w-48"
          spellCheck={false}
          value={text}
          aria-invalid={!steps}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </label>
      <p className={steps ? "text-sm text-muted-foreground" : "text-sm text-wrong"}>
        {steps ? hint : t("reviewSettings.badSteps")}
      </p>
    </div>
  );
}

export function ReviewSettings() {
  const { t } = useTranslation();
  const settings = useSettings().data ?? {};
  const set = useSetSetting();
  const percent = usePercent();
  // SettingRead of a generic key does not narrow: as a value or unset.
  const get = <K extends Option>(key: K): SettingValue<K> =>
    (settingOf(settings, key) as SettingValue<K> | undefined) ?? DEFAULTS[key];
  const save = <K extends Option>(key: K, value: SettingValue<K>) => set.mutate({ key, value });
  const [retention, setRetention] = useState<number>();
  const shownRetention = retention ?? get("srs.retention");
  const faces = get("srs.faces");
  const time = useDateFormat("time");
  const hour = (h: number) => time.format(new Date(2026, 0, 1, h));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("reviewSettings.intro")}</p>
      <Panel title={t("reviewSettings.limits")}>
        <div className="mt-2 flex flex-wrap gap-6">
          <NumberField
            label={t("reviewSettings.newPerDay")}
            value={get("srs.newPerDay")}
            onSave={(n) => save("srs.newPerDay", n)}
          />
          <NumberField
            label={t("reviewSettings.reviewsPerDay")}
            value={get("srs.reviewsPerDay")}
            onSave={(n) => save("srs.reviewsPerDay", n)}
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("reviewSettings.limitsHint")}</p>
        <div className="mt-4 space-y-1.5">
          <p className="text-sm font-medium">{t("reviewSettings.newIgnoresReviewLimit")}</p>
          <Choice
            value={get("srs.newIgnoresReviewLimit") ? "yes" : "no"}
            options={[
              ["no", t("reviewSettings.no")],
              ["yes", t("reviewSettings.yes")],
            ]}
            onChange={(v) => save("srs.newIgnoresReviewLimit", v === "yes")}
          />
          <p className="text-sm text-muted-foreground">
            {t("reviewSettings.newIgnoresReviewLimitHint")}
          </p>
        </div>
      </Panel>
      <Panel title={t("reviewSettings.retention")}>
        <div className="mt-3 flex items-center gap-4">
          <Slider
            className="max-w-xs"
            min={70}
            max={99}
            step={1}
            value={[Math.round(shownRetention * 100)]}
            aria-label={t("reviewSettings.retention")}
            onValueChange={([v]) => setRetention((v ?? 90) / 100)}
            onValueCommit={([v]) => {
              save("srs.retention", (v ?? 90) / 100);
              setRetention(undefined);
            }}
          />
          <span className="w-14 font-semibold tabular-nums">{percent(shownRetention)}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("reviewSettings.retentionHint")}</p>
      </Panel>
      <Panel title={t("reviewSettings.steps")}>
        <div className="mt-2 flex flex-wrap gap-6">
          <StepsField
            label={t("reviewSettings.learningSteps")}
            hint={t("reviewSettings.learningStepsHint")}
            value={get("srs.learningSteps")}
            onSave={(v) => save("srs.learningSteps", v)}
          />
          <StepsField
            label={t("reviewSettings.relearningSteps")}
            hint={t("reviewSettings.relearningStepsHint")}
            value={get("srs.relearningSteps")}
            allowNone
            onSave={(v) => save("srs.relearningSteps", v)}
          />
        </div>
      </Panel>
      <Panel title={t("reviewSettings.day")}>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[0, 2, 3, 4, 5, 6].map((h) => (
            <Chip
              key={h}
              on={get("srs.dayStartHour") === h}
              onClick={() => save("srs.dayStartHour", h)}
            >
              {hour(h)}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("reviewSettings.dayHint")}</p>
      </Panel>
      <Panel title={t("reviewSettings.faces")}>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CardFace.options.map((f) => (
            <Chip
              key={f}
              on={faces.includes(f)}
              onClick={() => {
                const next = faces.includes(f) ? faces.filter((x) => x !== f) : [...faces, f];
                if (next.length)
                  save(
                    "srs.faces",
                    CardFace.options.filter((x) => next.includes(x)),
                  );
              }}
            >
              {t(`myWords.face.${f}`)}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("reviewSettings.facesHint")}</p>
      </Panel>
      <Panel title={t("reviewSettings.optimizer")}>
        <p className="mt-1 text-sm text-muted-foreground">{t("reviewSettings.optimizerHint")}</p>
      </Panel>
      <Button
        variant="outline"
        onClick={() => {
          for (const [key, value] of Object.entries(DEFAULTS)) set.mutate({ key, value });
        }}
      >
        {t("reviewSettings.defaults")}
      </Button>
    </div>
  );
}

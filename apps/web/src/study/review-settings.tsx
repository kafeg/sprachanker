// Settings → Review (04; 09): Anki's deck options for the profile — daily limits and the card types a
// new word gets; under Advanced desired retention, learning and relearning steps, whether new cards
// count against the review limit, when the day starts. Each saved when changed; Anki's defaults one
// tap away.
import { STEP } from "@sprachanker/engine";
import { CardFace, SETTING_DEFAULTS, type SettingValue, settingOf } from "@sprachanker/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "@/api/settings.ts";
import { CheckRow } from "@/ui/check-row.tsx";
import { Chip } from "@/ui/chip.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { Slider } from "@/ui/components/slider.tsx";
import { Disclosure } from "@/ui/disclosure.tsx";
import { useDateFormat, usePercent } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";

/** The deck options here, each with Anki's default (schema `SETTING_DEFAULTS`). */
const OPTIONS = [
  "srs.newPerDay",
  "srs.reviewsPerDay",
  "srs.retention",
  "srs.learningSteps",
  "srs.relearningSteps",
  "srs.dayStartHour",
  "srs.newIgnoresReviewLimit",
  "srs.faces",
] as const satisfies Array<keyof typeof SETTING_DEFAULTS>;
type Option = (typeof OPTIONS)[number];

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
  // SettingRead of a generic key does not narrow: every option here has a default.
  const get = <K extends Option>(key: K): SettingValue<K> =>
    settingOf(settings, key) as SettingValue<K>;
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
      <Disclosure title={t("settings.advanced")}>
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
        <Panel>
          <CheckRow
            checked={!!get("srs.newIgnoresReviewLimit")}
            onChange={(value) => save("srs.newIgnoresReviewLimit", value)}
            title={t("reviewSettings.newIgnoresReviewLimit")}
            hint={t("reviewSettings.newIgnoresReviewLimitHint")}
          />
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
      </Disclosure>
      <Button
        variant="outline"
        onClick={() => {
          for (const key of OPTIONS) set.mutate({ key, value: SETTING_DEFAULTS[key] });
        }}
      >
        {t("reviewSettings.defaults")}
      </Button>
    </div>
  );
}

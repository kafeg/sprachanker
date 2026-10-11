// Settings → Review (04; 09): the profile's spaced repetition — daily limits, desired retention and the
// card types a new word gets, each saved when changed; what is not set here (steps, the day's start,
// new cards within the review limit) said in a few lines.

import { SRS_DEFAULTS } from "@sprachanker/engine";
import { CardFace, type SettingValue, settingOf } from "@sprachanker/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "@/api/settings.ts";
import { Chip } from "@/ui/chip.tsx";
import { Input } from "@/ui/components/input.tsx";
import { Slider } from "@/ui/components/slider.tsx";
import { useDateFormat, usePercent } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";

type Option = "srs.newPerDay" | "srs.reviewsPerDay" | "srs.retention" | "srs.faces";

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
      <Panel title={t("reviewSettings.how")}>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("reviewSettings.howSteps")}</li>
          <li>
            {t("reviewSettings.howDay", {
              time: time.format(new Date(2026, 0, 1, SRS_DEFAULTS.dayStartHour)),
            })}
          </li>
          <li>{t("reviewSettings.howLimit")}</li>
        </ul>
      </Panel>
    </div>
  );
}

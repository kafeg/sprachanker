// "How it works", opened from Review and from Settings → Review: the method and where it comes
// from — the forgetting curve, active recall, spacing, FSRS — what the buttons and counts mean, the
// steps and the day, the card types of a word, the actions under "…" and the keys. A side panel, as the
// tutor and the reference open.
import { SRS_DEFAULTS } from "@sprachanker/engine";
import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { SideSheet } from "@/ui/side-sheet.tsx";

/** Remembering falls off with time; each review at the edge of forgetting makes the fall slower. */
function ForgettingCurve() {
  const { t } = useTranslation();
  // Retention over days for growing stabilities (FSRS: R = (1 + t/(9S))^-1), each from a review to
  // the next: days 0–30 across the axis, 100 % at its top.
  const curve = (s: number, from: number, to: number) =>
    Array.from({ length: 41 }, (_, i) => {
      const day = from + ((to - from) * i) / 40;
      const r = (1 + (day - from) / (9 * s)) ** -1;
      return `${20 + day * 9},${20 + (1 - r) * 90}`;
    }).join(" ");
  return (
    <figure className="space-y-2">
      <svg viewBox="0 0 300 120" role="img" aria-label={t("guide.curveAlt")} className="w-full">
        <line x1="20" y1="20" x2="20" y2="110" className="stroke-border" />
        <line x1="20" y1="110" x2="290" y2="110" className="stroke-border" />
        {/* The reviews: each brings the curve back to the top. */}
        {[3, 10].map((day) => (
          <line
            key={day}
            x1={20 + day * 9}
            y1="20"
            x2={20 + day * 9}
            y2="110"
            strokeDasharray="3 3"
            className="stroke-border"
          />
        ))}
        <polyline points={curve(0.3, 0, 3)} className="fill-none stroke-wrong" strokeWidth="2" />
        <polyline
          points={curve(1.2, 3, 10)}
          className="fill-none stroke-amber-500"
          strokeWidth="2"
        />
        <polyline points={curve(5, 10, 30)} className="fill-none stroke-correct" strokeWidth="2" />
        <text x="24" y="16" className="fill-muted-foreground text-[9px]">
          100%
        </text>
        <text x="250" y="106" className="fill-muted-foreground text-[9px]">
          {t("guide.days")}
        </text>
      </svg>
      <figcaption className="text-sm text-muted-foreground">{t("guide.curveCaption")}</figcaption>
    </figure>
  );
}

function StudyGuide() {
  const { t } = useTranslation();
  const time = useDateFormat("time");
  const section = (key: string, body: React.ReactNode) => (
    <section key={key} className="space-y-1.5">
      <h3 className="font-semibold">{t(`guide.${key}.title`)}</h3>
      {body}
    </section>
  );
  const text = (key: string) => <p className="text-sm">{t(`guide.${key}.text`)}</p>;
  const list = (key: string, items: string[]) => (
    <ul className="space-y-1 text-sm">
      {items.map((i) => (
        <li key={i}>
          <span className="font-medium">{t(`guide.${key}.${i}.name`)}</span> —{" "}
          {t(`guide.${key}.${i}.text`)}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-5 overflow-y-auto px-4 pb-6">
      {section(
        "method",
        <>
          {text("method")}
          <ForgettingCurve />
        </>,
      )}
      {section("recall", text("recall"))}
      {section("buttons", list("buttons", ["again", "hard", "good", "easy"]))}
      {section("counts", text("counts"))}
      {section(
        "schedule",
        <ul className="list-disc space-y-1 ps-5 text-sm">
          <li>{t("guide.schedule.steps")}</li>
          <li>
            {t("guide.schedule.day", {
              time: time.format(new Date(2026, 0, 1, SRS_DEFAULTS.dayStartHour)),
            })}
          </li>
          <li>{t("guide.schedule.limit")}</li>
        </ul>,
      )}
      {section("faces", list("faces", ["recognition", "production", "listening"]))}
      {section("more", list("more", ["replay", "bury", "suspend", "flag", "mark"]))}
      {section("keys", text("keys"))}
      {section("fsrs", text("fsrs"))}
    </div>
  );
}

/** "How it works" as a button that opens the guide beside. */
export function GuideButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <HelpCircle /> {t("guide.open")}
      </Button>
      <SideSheet open={open} onOpenChange={setOpen} title={t("guide.title")}>
        <StudyGuide />
      </SideSheet>
    </>
  );
}

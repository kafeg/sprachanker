// Review → "How it works" (04; 09): the method and where it comes from — the forgetting curve, active
// recall, spacing, FSRS — what the buttons and counts mean, the two card types of a word, the actions
// under "…" and the keys. A side panel, as the tutor and the reference open.
import { useTranslation } from "react-i18next";

/** Remembering falls off with time; each review at the edge of forgetting makes the fall slower. */
function ForgettingCurve() {
  const { t } = useTranslation();
  // Retention over days for growing stabilities (FSRS: R = (1 + t/(9S))^-1).
  const curve = (s: number, from: number) =>
    Array.from({ length: 61 }, (_, i) => {
      const day = from + i * 0.5;
      const r = (1 + (day - from) / (9 * s)) ** -1;
      return `${20 + day * 9},${20 + (1 - r) * 280}`;
    }).join(" ");
  return (
    <figure className="space-y-2">
      <svg viewBox="0 0 300 120" role="img" aria-label={t("guide.curveAlt")} className="w-full">
        <line x1="20" y1="20" x2="20" y2="110" className="stroke-border" />
        <line x1="20" y1="110" x2="290" y2="110" className="stroke-border" />
        <polyline points={curve(1, 0)} className="fill-none stroke-wrong" strokeWidth="2" />
        <polyline points={curve(4, 3)} className="fill-none stroke-amber-500" strokeWidth="2" />
        <polyline points={curve(15, 10)} className="fill-none stroke-correct" strokeWidth="2" />
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

export function StudyGuide() {
  const { t } = useTranslation();
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
      {section("faces", list("faces", ["recognition", "production"]))}
      {section("more", list("more", ["replay", "bury", "suspend", "flag", "mark"]))}
      {section("keys", text("keys"))}
      {section("fsrs", text("fsrs"))}
    </div>
  );
}

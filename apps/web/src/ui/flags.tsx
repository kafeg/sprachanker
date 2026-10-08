// Language flags (09): a language is shown by the flag we chose for it — a language is not a
// country, so this table is ours (English → the British flag, Portuguese → Brazil's as DW teaches it,
// Arabic → Saudi Arabia's, Swahili → Tanzania's). A language not in it shows its code.
// Flags come from country-flag-icons, one module per flag, so only these are bundled.

import { parseEditionId } from "@sprachanker/schema";
import BA from "country-flag-icons/react/3x2/BA";
import BR from "country-flag-icons/react/3x2/BR";
import CN from "country-flag-icons/react/3x2/CN";
import DE from "country-flag-icons/react/3x2/DE";
import ES from "country-flag-icons/react/3x2/ES";
import FR from "country-flag-icons/react/3x2/FR";
import GB from "country-flag-icons/react/3x2/GB";
import GR from "country-flag-icons/react/3x2/GR";
import HU from "country-flag-icons/react/3x2/HU";
import ID from "country-flag-icons/react/3x2/ID";
import IN from "country-flag-icons/react/3x2/IN";
import IR from "country-flag-icons/react/3x2/IR";
import IT from "country-flag-icons/react/3x2/IT";
import PL from "country-flag-icons/react/3x2/PL";
import RO from "country-flag-icons/react/3x2/RO";
import RU from "country-flag-icons/react/3x2/RU";
import SA from "country-flag-icons/react/3x2/SA";
import TR from "country-flag-icons/react/3x2/TR";
import TZ from "country-flag-icons/react/3x2/TZ";
import UA from "country-flag-icons/react/3x2/UA";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import { cn } from "./utils.ts";

const FLAGS: Record<string, typeof DE> = {
  ar: SA,
  bs: BA,
  de: DE,
  el: GR,
  en: GB,
  es: ES,
  fa: IR,
  fr: FR,
  hi: IN,
  hu: HU,
  id: ID,
  it: IT,
  pl: PL,
  pt: BR,
  ro: RO,
  ru: RU,
  sw: TZ,
  tr: TR,
  uk: UA,
  zh: CN,
};

/** "ru-de" → "русский → немецкий" in the interface language. */
export function usePairName() {
  const { t, i18n } = useTranslation();
  return (edition: string) => {
    const { source, target } = parseEditionId(edition);
    const name = (code: string) => languageName(code, i18n.language);
    return t("courses.languages", { from: name(source), to: name(target) });
  };
}

/** One language's flag (decorative: the caller names the language). */
const SIZES = { sm: "h-4 w-6", md: "h-5 w-7.5" } as const;

export function LanguageFlag({
  lang,
  size = "sm",
  className,
}: {
  lang: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const Flag = FLAGS[lang];
  const box = cn(
    "inline-block shrink-0 rounded-[3px] ring-1 ring-black/10",
    SIZES[size],
    className,
  );
  return Flag ? (
    <Flag className={box} aria-hidden="true" />
  ) : (
    <span
      className={cn(box, "grid place-items-center bg-muted text-[10px] font-semibold uppercase")}
      aria-hidden="true"
    >
      {lang}
    </span>
  );
}

/** The flags of a language pair, "mine → the one learnt"; named for screen readers and on hover. */
export function PairFlags({
  edition,
  size,
  className,
}: {
  edition: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const name = usePairName()(edition);
  const { source, target } = parseEditionId(edition);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <LanguageFlag lang={source} size={size} />
      <ArrowRight className="size-3.5 opacity-60" aria-hidden="true" />
      <LanguageFlag lang={target} size={size} />
    </span>
  );
}

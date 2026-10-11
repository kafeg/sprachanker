// The interface's writing direction (09, "Writing direction"): Radix's controls told it (sliders, tabs'
// arrow keys, menus), arrow keys stepping along it, and text in a language marked with its own.
import { Direction } from "radix-ui";
import { useTranslation } from "react-i18next";
import { languageDir } from "@/i18n/index.ts";

/** Radix's controls follow the interface language's direction. */
export function DirectionRoot({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <Direction.DirectionProvider dir={languageDir(i18n.language)}>
      {children}
    </Direction.DirectionProvider>
  );
}

/** Where an arrow key moves along the reading direction: 1 forward (→, or ← right to left), -1 back,
 *  0 for any other key. */
export function arrowStep(key: string): -1 | 0 | 1 {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return document.documentElement.dir === "rtl" ? ((-step || 0) as -1 | 0 | 1) : step;
}

/** `lang` and `dir` of an element whose text is in `lang` (a course's language): its own direction
 *  inside an interface written the other way (German in an Arabic interface). */
export const inLang = (lang: string | undefined) =>
  lang ? { lang, dir: languageDir(lang) } : { lang: undefined };

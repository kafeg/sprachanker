// The language the open course teaches (the target of its edition): `lang` of target-language text,
// so screen readers, hyphenation and fonts treat it right. Provided by the course and lesson screens.
import { createContext, useContext } from "react";

export const TargetLang = createContext<string | undefined>(undefined);

export const useTargetLang = () => useContext(TargetLang);

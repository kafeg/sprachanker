// A deck's name (Review, Decks, My words): a language, or a course's title in the edition of its cards
// (the server's, with the decks; the shell keeps them read).
import { useTranslation } from "react-i18next";
import { useDecks } from "@/api/cards.ts";
import { languageName } from "@/i18n/index.ts";

export function useDeckName() {
  const { i18n } = useTranslation();
  const courses = (useDecks().data?.decks ?? []).flatMap((d) => d.courses);
  return (scope: string) => {
    if (scope.startsWith("lang:")) return languageName(scope.slice(5), i18n.language, true);
    return courses.find((c) => c.scope === scope)?.title ?? scope.slice("course:".length);
  };
}

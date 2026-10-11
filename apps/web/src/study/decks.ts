// A deck's name (Review, Decks, My words): a language, a course's title in the edition of its cards, or
// an imported deck's title (the server's, with the decks; the shell keeps them read).
import { useTranslation } from "react-i18next";
import { useDecks } from "@/api/cards.ts";
import { languageName } from "@/i18n/index.ts";

export function useDeckName() {
  const { i18n } = useTranslation();
  const decks = (useDecks().data?.decks ?? []).flatMap((d) => d.decks);
  return (scope: string) => {
    if (scope.startsWith("lang:")) return languageName(scope.slice(5), i18n.language, true);
    return decks.find((d) => d.scope === scope)?.title ?? scope.slice(scope.indexOf(":") + 1);
  };
}

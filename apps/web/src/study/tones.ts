// Anki's ratings and counts in our own hues (the gender hues mean gender only, 09): Again and Learning
// as wrong, Good and Review as correct, Easy and New as new cards. One place for the reviewer, the
// decks, My words and the word sheet.
/** The four ratings: their names, their text hue, and on a phone the button's colour (AnkiDroid). */
export const RATINGS = [
  {
    rating: 1,
    key: "again",
    tone: "text-wrong",
    phone: "max-sm:bg-wrong max-sm:hover:bg-wrong/90",
  },
  {
    rating: 2,
    key: "hard",
    tone: "text-muted-foreground",
    phone: "max-sm:bg-slate-600 max-sm:hover:bg-slate-700",
  },
  {
    rating: 3,
    key: "good",
    tone: "text-correct",
    phone: "max-sm:bg-correct max-sm:hover:bg-correct/90",
  },
  {
    rating: 4,
    key: "easy",
    tone: "text-srs-new",
    phone: "max-sm:bg-srs-new max-sm:hover:bg-srs-new/90",
  },
] as const;

export const ratingOf = (rating: number) => RATINGS[rating - 1] ?? RATINGS[0];

/** Anki's three counts, and a word's state: new, learning (as Again), to review (as Good). */
export const COUNT_TONE = {
  new: "text-srs-new",
  learning: "text-wrong",
  review: "text-correct",
} as const;

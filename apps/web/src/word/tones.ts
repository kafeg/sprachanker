// Anki's ratings and counts in our own hues (the gender hues mean gender only, 09): Again and Learning
// as wrong, Good and Review as correct, Easy and New as new cards. One place for the reviewer, the
// decks, My words, the word sheet and the Notebook.
/** The four ratings: their names, their text hue, and their button's colour (as in AnkiDroid). */
export const RATINGS = [
  {
    rating: 1,
    key: "again",
    tone: "text-wrong",
    button: "bg-wrong hover:bg-wrong/90",
  },
  {
    rating: 2,
    key: "hard",
    tone: "text-muted-foreground",
    button: "bg-slate-600 hover:bg-slate-700",
  },
  {
    rating: 3,
    key: "good",
    tone: "text-correct",
    button: "bg-correct hover:bg-correct/90",
  },
  {
    rating: 4,
    key: "easy",
    tone: "text-srs-new",
    button: "bg-srs-new hover:bg-srs-new/90",
  },
] as const;

export const ratingOf = (rating: number) => RATINGS[rating - 1] ?? RATINGS[0];

/** Anki's three counts, and a word's state: new, learning (as Again), to review (as Good). */
export const COUNT_TONE = {
  new: "text-srs-new",
  learning: "text-wrong",
  review: "text-correct",
} as const;

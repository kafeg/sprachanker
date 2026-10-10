// An answer from a solution page matched to the option it names (research exams.md: every answer of
// the pages resolves this way): by its text, its letter, or its letter and text.

/** An answer as compared: lower case, without a final full stop, "Bild c" as "c". */
const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/^bild\s+/, "")
    .replace(/[.\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** The option an answer names: its letter, its text, or its letter and text ("c sollen …"). */
export function optionFor(
  answer: string,
  options: Array<{ id: string; text?: string }>,
): string | undefined {
  const want = comparable(answer);
  const byText = options.find((o) => o.text !== undefined && comparable(o.text) === want);
  if (byText) return byText.id;
  if (want.length === 1)
    return options.find((o) => o.id === want || comparable(o.text ?? "") === want)?.id;
  // "c sollen …": the letter's option, only when its text says the same.
  const [, letter, rest] = /^([a-j])\s+(.*)$/.exec(want) ?? [];
  if (!letter) return undefined;
  const option = options.find((o) => o.id === letter);
  const text = comparable(option?.text ?? "").replace(/^[a-j]\s+/, "");
  return option && text === rest ? option.id : undefined;
}

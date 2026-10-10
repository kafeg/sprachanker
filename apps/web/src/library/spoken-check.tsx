// An answer said aloud as the model checked it (08), kept in the pass: shown under the item, for the
// words the answer has.
import type { NotebookPass } from "@/api/hooks.ts";
import { SpokenCheckView } from "@/ui/checked-text.tsx";

/** A check as kept in a pass: `input` is what was heard. */
type KeptCheck = NotebookPass["spoken"][number];

/** The check of an item's answer, by the words heard (the newest for the same words). */
export const spokenCheckOf = <C extends KeptCheck>(
  checks: C[],
  itemKey: string,
  answer: unknown,
) => {
  const heard = (answer as { transcript?: unknown } | undefined)?.transcript;
  return checks.find((c) => c.itemKey === itemKey && c.input === heard);
};

export function SpokenCheckNote({ check }: { check: KeptCheck | undefined }) {
  if (!check) return null;
  return (
    <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
      <SpokenCheckView transcript={check.input} check={check.result} />
    </div>
  );
}

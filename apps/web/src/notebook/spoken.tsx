// An answer said aloud as the model checked it (08), kept in the pass: shown under the item, for the
// words the answer has.
import type { SpokenCheck } from "@sprachanker/schema";
import { SpokenCheckView } from "@/ui/checked-text.tsx";

interface KeptCheck {
  itemKey: string | null;
  transcript: string;
  result: SpokenCheck;
}

/** The check of an item's answer, by the words heard (the newest for the same words). */
export const spokenCheckOf = <C extends KeptCheck>(
  checks: C[],
  itemKey: string,
  answer: unknown,
) => {
  const heard = (answer as { transcript?: unknown } | undefined)?.transcript;
  return checks.find((c) => c.itemKey === itemKey && c.transcript === heard);
};

export function SpokenCheckNote({ check }: { check: KeptCheck | undefined }) {
  if (!check) return null;
  return (
    <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
      <SpokenCheckView transcript={check.transcript} check={check.result} />
    </div>
  );
}

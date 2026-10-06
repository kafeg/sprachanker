import type { Option } from "@sprachanker/schema";
import { Check, X } from "lucide-react";
import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";

/** Stable shuffled order for one item (display order is not the canonical order, 02). */
export function useShuffled<T>(items: T[], seed: string): T[] {
  // biome-ignore lint/correctness/useExhaustiveDependencies: reshuffle only for another item
  return useMemo(() => {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
    const rand = () => {
      h = (h * 1103515245 + 12345) | 0;
      return (h >>> 0) / 2 ** 32;
    };
    return items
      .map((x) => [rand(), x] as const)
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1]);
  }, [seed]);
}

export type Mark = "correct" | "wrong" | undefined;

export function OptionContent({ option, url }: { option: Option; url(path: string): string }) {
  const lang = useTargetLang();
  if (option.media?.image)
    return <img src={url(option.media.image)} alt="" className="h-28 w-auto rounded-lg sm:h-32" />;
  return <span lang={lang}>{option.text}</span>;
}

export function OptionButton({
  option,
  url,
  selected,
  mark,
  disabled,
  onClick,
}: {
  option: Option;
  url(path: string): string;
  selected: boolean;
  mark: Mark;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative flex min-h-12 items-center gap-2 rounded-xl border-2 bg-card px-4 py-2 text-left text-lg transition",
        !disabled && "hover:border-primary/60",
        selected && "border-primary bg-accent",
        mark === "correct" && "border-correct bg-correct-soft",
        mark === "wrong" && "border-wrong bg-wrong-soft",
      )}
    >
      <OptionContent option={option} url={url} />
      {mark === "correct" && <Check className="size-5 shrink-0 text-correct" aria-hidden />}
      {mark === "wrong" && <X className="size-5 shrink-0 text-wrong" aria-hidden />}
    </button>
  );
}

/** A pick from a short list inside an exercise (a gap, the right side of a pair): the app's select,
 *  sized for touch, with the item's state as its border. */
export function PickSelect({
  value,
  options,
  placeholder,
  label,
  disabled,
  className,
  onChange,
}: {
  value: string | undefined;
  options: Array<{ id: string; text: string }>;
  placeholder: string;
  label: string;
  disabled?: boolean;
  /** State classes (border colours) and width. */
  className?: string;
  onChange(id: string): void;
}) {
  const lang = useTargetLang();
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-11 rounded-lg border-2 bg-card text-lg data-[size=default]:h-11",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-lg" lang={lang}>
            {o.text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

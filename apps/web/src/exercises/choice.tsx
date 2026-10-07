// single_choice and multi_choice: options as buttons (pictures as a grid of tiles), chosen by tap or,
// in the active item, by the number keys; several choices show square boxes and how many are chosen.
import type { Option } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";
import { allPictures, type Mark, OptionButton, useNumberKeys, useShuffled } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

function Options({
  options,
  url,
  multi = false,
  active,
  locked,
  selected,
  mark,
  choose,
}: {
  options: Option[];
  url(path: string): string;
  multi?: boolean;
  active?: boolean;
  locked: boolean;
  selected(id: string): boolean;
  mark(id: string): Mark;
  choose(id: string): void;
}) {
  const grid = allPictures(options);
  useNumberKeys(!!active && !locked, options.length, (i) => {
    const option = options[i];
    if (option) choose(option.id);
  });
  return (
    <div className={cn(grid ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "flex flex-wrap gap-2")}>
      {options.map((o, i) => (
        <OptionButton
          key={o.id}
          option={o}
          url={url}
          multi={multi}
          fill={grid}
          number={active && i < 9 ? i + 1 : undefined}
          selected={selected(o.id)}
          disabled={locked}
          mark={mark(o.id)}
          onClick={() => choose(o.id)}
        />
      ))}
    </div>
  );
}

export function SingleChoice({
  item,
  answer,
  onAnswer,
  outcome,
  url,
  active,
}: RendererProps<"single_choice">) {
  const options = useShuffled(item.options, item.key);
  const right = item.answer.optionIds[0];
  return (
    <Options
      options={options}
      url={url}
      active={active}
      locked={!!outcome}
      selected={(id) => answer?.optionId === id}
      // The chosen option takes the outcome (an option with the same text as the right one is
      // right too, 04); the right one is shown when the choice was wrong.
      mark={(id) => {
        if (!outcome) return undefined;
        if (id === answer?.optionId) return outcome.result === "correct" ? "correct" : "wrong";
        return id === right && outcome.result !== "correct" ? "correct" : undefined;
      }}
      choose={(id) => onAnswer({ optionId: id })}
    />
  );
}

export function MultiChoice({
  item,
  answer,
  onAnswer,
  outcome,
  url,
  active,
}: RendererProps<"multi_choice">) {
  const { t } = useTranslation();
  const options = useShuffled(item.options, item.key);
  const chosen = new Set(answer?.optionIds ?? []);
  const right = new Set(item.answer.optionIds);
  const toggle = (id: string) => {
    const next = new Set(chosen);
    next.has(id) ? next.delete(id) : next.add(id);
    onAnswer({ optionIds: [...next] });
  };
  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        {t("ex.chooseSeveral")}
        {chosen.size > 0 && !outcome && ` · ${t("ex.chosen", { count: chosen.size })}`}
      </p>
      <Options
        options={options}
        url={url}
        multi
        active={active}
        locked={!!outcome}
        selected={(id) => chosen.has(id)}
        mark={(id) =>
          outcome ? (right.has(id) ? "correct" : chosen.has(id) ? "wrong" : undefined) : undefined
        }
        choose={toggle}
      />
    </div>
  );
}

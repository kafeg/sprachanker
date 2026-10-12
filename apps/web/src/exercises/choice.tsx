// single_choice and multi_choice: options as buttons (pictures as a grid of tiles), chosen by tap or,
// in the active item, by the number keys; several choices show square boxes and how many are chosen.
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import {
  allPictures,
  type Mark,
  OptionButton,
  SeveralSaid,
  type ShownOption,
  shownOptions,
  TILES,
  useNumberKeys,
  useOptionOrder,
} from "./shared.tsx";
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
  options: ShownOption[];
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
    <div className={grid ? TILES : "grid gap-2"}>
      {options.map((o) => (
        <OptionButton
          key={o.id}
          option={o}
          url={url}
          multi={multi}
          fill={grid}
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
  locale,
}: RendererProps<"single_choice">) {
  const options = useOptionOrder(shownOptions(item.options, locale), item.key);
  const right = item.answer.optionIds[0];
  return (
    <Options
      options={options}
      url={url}
      active={active}
      locked={!!outcome}
      selected={(id) => answer?.optionId === id}
      // The chosen option takes the outcome (an option with the same text as the right one is
      // right too); the right one is shown, as missed, when the choice was wrong.
      mark={(id) => {
        if (!outcome) return undefined;
        if (id === answer?.optionId) return outcome.result === "correct" ? "correct" : "wrong";
        return id === right && outcome.result !== "correct" ? "missed" : undefined;
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
  locale,
}: RendererProps<"multi_choice">) {
  const { t } = useTranslation();
  const options = useOptionOrder(shownOptions(item.options, locale), item.key);
  const chosen = new Set(answer?.optionIds ?? []);
  const said = useContext(SeveralSaid);
  const right = new Set(item.answer.optionIds);
  const toggle = (id: string) => {
    const next = new Set(chosen);
    next.has(id) ? next.delete(id) : next.add(id);
    onAnswer({ optionIds: [...next] });
  };
  return (
    <div>
      {/* Said above the items, only how many are chosen (the line keeps its place: nothing moves). */}
      <p className="mb-2 min-h-5 text-sm text-muted-foreground">
        {said
          ? !outcome && chosen.size > 0 && t("ex.chosen", { count: chosen.size })
          : `${t("ex.chooseSeveral")}${chosen.size > 0 && !outcome ? ` · ${t("ex.chosen", { count: chosen.size })}` : ""}`}
      </p>
      <Options
        options={options}
        url={url}
        multi
        active={active}
        locked={!!outcome}
        selected={(id) => chosen.has(id)}
        mark={(id) =>
          !outcome
            ? undefined
            : right.has(id)
              ? chosen.has(id)
                ? "correct"
                : "missed"
              : chosen.has(id)
                ? "wrong"
                : undefined
        }
        choose={toggle}
      />
    </div>
  );
}

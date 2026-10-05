import { useTranslation } from "react-i18next";
import { OptionButton, useShuffled } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

export function SingleChoice({
  item,
  answer,
  onAnswer,
  outcome,
  url,
}: RendererProps<"single_choice">) {
  const options = useShuffled(item.options, item.key);
  const right = item.answer.optionIds[0];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <OptionButton
          key={o.id}
          option={o}
          url={url}
          selected={answer?.optionId === o.id}
          disabled={!!outcome}
          mark={
            outcome
              ? o.id === right
                ? "correct"
                : answer?.optionId === o.id
                  ? "wrong"
                  : undefined
              : undefined
          }
          onClick={() => onAnswer({ optionId: o.id })}
        />
      ))}
    </div>
  );
}

export function MultiChoice({
  item,
  answer,
  onAnswer,
  outcome,
  url,
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
      <p className="mb-2 text-sm text-muted-foreground">{t("ex.chooseSeveral")}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <OptionButton
            key={o.id}
            option={o}
            url={url}
            selected={chosen.has(o.id)}
            disabled={!!outcome}
            mark={
              outcome
                ? right.has(o.id)
                  ? "correct"
                  : chosen.has(o.id)
                    ? "wrong"
                    : undefined
                : undefined
            }
            onClick={() => toggle(o.id)}
          />
        ))}
      </div>
    </div>
  );
}

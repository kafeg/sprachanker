// The reviewer's More menu (09): replay, bury and suspend the card or its note, mark, Anki's seven
// flags — each with its key (study/reviewer-keys.ts), and the deck's buried cards back.
import { Flag, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { useStudy } from "@/api/cards.ts";
import { Button } from "@/ui/components/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu.tsx";
import { cn } from "@/ui/utils.ts";
import type { ReviewerAction } from "./reviewer-keys.ts";

/** On a Mac, Ctrl is ⌘ (the reviewer takes either). */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Anki's flag colours, 1–7 (small icons named by their colour: the one exception to the hues). */
export const FLAGS = ["red", "orange", "green", "blue", "pink", "turquoise", "purple"] as const;
export const FLAG_CLASS = [
  "text-red-600",
  "text-orange-500",
  "text-green-600",
  "text-blue-600",
  "text-pink-500",
  "text-teal-500",
  "text-purple-600",
];

type Current = NonNullable<NonNullable<ReturnType<typeof useStudy>["data"]>["current"]>;

export function MoreMenu({
  current,
  buried,
  act,
  onUnbury,
}: {
  current: Current;
  buried: number;
  act(action: ReviewerAction): void;
  onUnbury(): void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("study.more")}>
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => act({ do: "replay" })} disabled={!current.display.audio}>
          {t("study.replay")}
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => act({ do: "bury", note: false })}>
          {t("study.buryCard")}
          <DropdownMenuShortcut>-</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act({ do: "bury", note: true })}>
          {t("study.buryNote")}
          <DropdownMenuShortcut>=</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act({ do: "suspend", note: false })}>
          {t("study.suspendCard")}
          <DropdownMenuShortcut>@</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act({ do: "suspend", note: true })}>
          {t("study.suspendNote")}
          <DropdownMenuShortcut>!</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act({ do: "mark" })}>
          {current.marked ? t("study.unmark") : t("study.mark")}
          <DropdownMenuShortcut>*</DropdownMenuShortcut>
        </DropdownMenuItem>
        {buried > 0 && (
          // The deck's buried cards back today (Anki: Unbury, on the deck's overview).
          <DropdownMenuItem onSelect={onUnbury}>{t("study.unbury")}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {FLAGS.map((name, i) => (
          <DropdownMenuItem key={name} onSelect={() => act({ do: "flag", flag: i + 1 })}>
            <Flag className={cn("size-4 fill-current", FLAG_CLASS[i])} />
            {t(`study.flag.${name}`)}
            {current.flag === i + 1 && " ✓"}
            <DropdownMenuShortcut>
              {MAC ? `⌘${i + 1}` : t("study.flagKey", { n: i + 1 })}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

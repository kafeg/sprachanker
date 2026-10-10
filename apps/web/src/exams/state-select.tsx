// The federal state whose questions an exam asks (the profile setting `exam.federalState`), chosen and
// changed on the exam's page.
import { FEDERAL_STATES, type FederalState } from "@sprachanker/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "@/api/hooks.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { cn } from "@/ui/utils.ts";

export function StateSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const set = useSetSetting();
  const client = useQueryClient();
  const value = settings.data?.["exam.federalState"] as FederalState | undefined;
  // In the order of their names in the interface's language.
  const states = [...FEDERAL_STATES].sort((a, b) =>
    t(`exams.states.${a}`).localeCompare(t(`exams.states.${b}`)),
  );
  return (
    <Select
      value={value ?? ""}
      onValueChange={(v) =>
        set.mutate(
          { key: "exam.federalState", value: v },
          // Which questions are open, and so how ready the learner is, follows the state.
          {
            onSuccess: () => {
              void client.invalidateQueries({ queryKey: ["exams"] });
              void client.invalidateQueries({ queryKey: ["exam"] });
            },
          },
        )
      }
    >
      <SelectTrigger
        className={cn("h-9 bg-card pointer-coarse:h-11", className)}
        aria-label={t("exams.state")}
      >
        <SelectValue placeholder={t("exams.chooseState")} />
      </SelectTrigger>
      <SelectContent>
        {states.map((s) => (
          <SelectItem key={s} value={s}>
            {t(`exams.states.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

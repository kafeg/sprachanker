// A profile's name and colour (06): edited alike in the onboarding's first step and in Settings →
// Profile; the screen decides when a change is kept.
import { PROFILE_NAME_MAX, ProfileColour } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/ui/avatar.tsx";
import { Input } from "@/ui/components/input.tsx";
import { cn } from "@/ui/utils.ts";

export function NameAndColour({
  name,
  colour,
  onName,
  onColour,
  onNameDone,
}: {
  name: string;
  colour: ProfileColour;
  onName(name: string): void;
  onColour(colour: ProfileColour): void;
  /** The name's field left or Enter pressed in it. */
  onNameDone?(): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name={name || "?"} colour={colour} className="size-12 text-xl" />
        <Input
          className="h-11 max-w-xs"
          maxLength={PROFILE_NAME_MAX}
          aria-label={t("profile.name")}
          placeholder={t("profile.name")}
          value={name}
          onChange={(e) => onName(e.target.value)}
          onBlur={onNameDone}
          onKeyDown={(e) => e.key === "Enter" && onNameDone?.()}
        />
      </div>
      <fieldset
        className="flex min-w-0 flex-wrap gap-2 border-0 p-0"
        aria-label={t("profile.colour")}
      >
        {ProfileColour.options.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={colour === c}
            aria-label={t(`profile.colours.${c}`)}
            onClick={() => onColour(c)}
            className={cn("rounded-full p-0.5", colour === c && "ring-2 ring-primary")}
          >
            <Avatar name={name || "?"} colour={c} />
          </button>
        ))}
      </fieldset>
    </div>
  );
}

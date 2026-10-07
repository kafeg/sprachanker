// The signed-in profile at the foot of the sidebar: its tile and name; its menu leads to Settings →
// Profile or back to "Who is studying?" (switching profile signs this device out).
import { Link } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession, useSignOut } from "@/api/session.ts";
import { Avatar } from "@/ui/avatar.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu.tsx";

export function ProfileChip() {
  const { t } = useTranslation();
  const profile = useSession().data?.profile;
  const signOut = useSignOut();
  if (!profile) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-accent"
        >
          <Avatar name={profile.name || "?"} colour={profile.colour} className="size-8 text-sm" />
          <span className="truncate font-medium">{profile.name || t("profiles.unnamed")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem asChild>
          <Link to="/settings" hash="profile">
            <UserRound /> {t("profile.open")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut.mutate()}>
          <LogOut /> {t("profile.switch")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

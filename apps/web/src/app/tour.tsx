// A short tour of the app's sections (09): each with its icon and one line — at the end of the
// onboarding, and again from Settings → Profile.
import { useTranslation } from "react-i18next";
import { NAV } from "./shell.tsx";

export function Tour() {
  const { t } = useTranslation();
  return (
    <ul className="space-y-2">
      {NAV.map(({ to, key, icon: Icon }) => (
        <li key={to} className="flex items-start gap-3 rounded-2xl border bg-card p-3">
          <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="block font-semibold">{t(key)}</span>
            <span className="text-sm text-muted-foreground">{t(`tour.${key.slice(4)}`)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

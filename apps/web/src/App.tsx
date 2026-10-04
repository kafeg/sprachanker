import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/client.ts";
import { UI_LANGUAGES } from "./i18n/index.ts";

type ServerStatus = "checking" | "ok" | "error";

/** A language's own name ("Deutsch", "Русский"), from Intl rather than a catalog. */
function nativeName(code: string): string {
  const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}

export function App() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    api.health
      .$get()
      .then((res) => (res.ok ? res.json() : undefined))
      .then((body) => setStatus(body?.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    document.title = t("app.name");
  }, [t]);

  return (
    <main>
      <p className="brand">{t("app.name")}</p>
      <h1>{t("hello.title")}</h1>
      <p>{t("hello.text")}</p>
      <p data-testid="server-status" data-status={status}>
        {t("server.status", { status })}
      </p>
      <nav aria-label={t("language.label")}>
        {UI_LANGUAGES.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={i18n.resolvedLanguage === code}
            onClick={() => i18n.changeLanguage(code)}
          >
            {nativeName(code)}
          </button>
        ))}
      </nav>
    </main>
  );
}

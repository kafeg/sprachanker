// A catalog whose chunk does not load (offline before it was cached, or the app upgraded under the open
// page): the start falls back to English, a switch changes nothing and keeps nothing, the page reloads
// once for the new build.
import { afterEach, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { fireEvent, waitFor } from "@testing-library/react";

const I18N = join(import.meta.dir, "../src/i18n");
const read = (name: string) =>
  import(join(I18N, name)).then((m: { default: Record<string, unknown> }) => m.default);
let failing = true;
mock.module(join(I18N, "catalogs.ts"), () => ({
  catalogs: {
    "./de.json": () => read("de.json"),
    "./fa.json": () =>
      failing
        ? Promise.reject(new TypeError("Failed to fetch dynamically imported module"))
        : read("fa.json"),
  },
}));
localStorage.setItem("sprachanker.uiLanguage", "fa");
let reloads = 0;
Object.defineProperty(location, "reload", { value: () => reloads++, configurable: true });

const { default: i18n, switchLanguage } = await import("../src/i18n/index.ts");
const { LanguageSwitch } = await import("../src/app/language-switch.tsx");
const { renderApp } = await import("./render.tsx");

const page = () => [document.documentElement.lang, document.documentElement.dir];
const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

test("a start language whose catalog does not load: English", () => {
  expect(i18n.language).toBe("en");
  expect(page()).toEqual(["en", "ltr"]);
});

test("a switch to it changes nothing and keeps nothing; the page reloads once, until a catalog loads", async () => {
  expect(await switchLanguage("de")).toBe(true);
  expect(await switchLanguage("fa")).toBe(false);
  expect(i18n.language).toBe("de");
  expect(page()).toEqual(["de", "ltr"]);
  expect(localStorage.getItem("sprachanker.uiLanguage")).toBe("de");
  expect(reloads).toBe(1);
  // Failing again after the reload: it stays.
  expect(await switchLanguage("fa")).toBe(false);
  expect(reloads).toBe(1);

  // Settings → General: the profile does not keep a language that was not shown.
  const saved: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    saved.push(await request.json());
    return Response.json({ ok: true });
  }) as typeof fetch;
  const view = await renderApp(<LanguageSwitch keep />);
  fireEvent.click(view.getByRole("combobox"));
  fireEvent.click(await view.findByRole("option", { name: "فارسی" }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(saved).toEqual([]);
  expect(i18n.language).toBe("de");
  view.unmount();

  // Loading now: shown, right to left, kept; the guard cleared.
  failing = false;
  expect(await switchLanguage("fa")).toBe(true);
  await waitFor(() => expect(page()).toEqual(["fa", "rtl"]));
  expect(localStorage.getItem("sprachanker.uiLanguage")).toBe("fa");
  expect(sessionStorage.getItem("sprachanker.catalogReload")).toBeNull();
  await switchLanguage("en");
});

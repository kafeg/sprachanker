import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { LanguageSwitch } from "../../src/app/language-switch.tsx";
import i18n, {
  languageDir,
  languageName,
  switchLanguage,
  UI_LANGUAGES,
} from "../../src/i18n/index.ts";
import { ReviewSettings } from "../../src/study/review-settings.tsx";
import { CheckRow } from "../../src/ui/check-row.tsx";
import { Tabs, TabsContent } from "../../src/ui/components/tabs.tsx";
import { SectionTabList } from "../../src/ui/section-tabs.tsx";
import { renderApp } from "../render.tsx";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

test("a page's tabs: one tablist named, the open one selected, another opened by a click", async () => {
  function Page() {
    const [tab, setTab] = useState("general");
    return (
      <Tabs value={tab} onValueChange={setTab}>
        <SectionTabList
          label="Settings"
          value={tab}
          tabs={[
            { value: "general", label: "General" },
            { value: "review", label: "Review" },
          ]}
        />
        <TabsContent value="general">general here</TabsContent>
        <TabsContent value="review">review here</TabsContent>
      </Tabs>
    );
  }
  const view = await renderApp(<Page />);
  expect(view.getByRole("tablist", { name: "Settings" })).toBeTruthy();
  expect(view.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
  expect(view.getByText("general here")).toBeTruthy();
  const review = view.getByRole("tab", { name: "Review" });
  // Radix opens a tab on mouse down.
  fireEvent.mouseDown(review);
  expect(review.getAttribute("aria-selected")).toBe("true");
  expect(view.getByText("review here")).toBeTruthy();
});

test("a setting's checkbox row: the whole row toggles it; disabled, nothing", async () => {
  const changes: boolean[] = [];
  const view = await renderApp(
    <>
      <CheckRow checked={false} onChange={(v) => changes.push(v)} title="Exams" hint="shown" />
      <CheckRow checked onChange={(v) => changes.push(v)} title="Goethe" disabled />
    </>,
  );
  const exams = view.getByRole("checkbox", { name: /Exams/ });
  expect(exams.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(view.getByText("shown"));
  fireEvent.click(view.getByText("Goethe"));
  expect(changes).toEqual([true]);
});

test("the interface language: one control; in Settings the profile keeps it, on who is studying not", async () => {
  const saved: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    saved.push(await request.json());
    return Response.json({ ok: true });
  }) as typeof fetch;
  const view = await renderApp(<LanguageSwitch keep />);
  const list = view.getByRole("combobox", { name: "Interface language" });
  expect(list.textContent).toBe("English");
  fireEvent.click(list);
  // Every language there is a catalog for, each in its own name, in the order of those names.
  const options = await view.findAllByRole("option");
  expect(options.map((o) => o.getAttribute("lang"))).toEqual([...UI_LANGUAGES]);
  expect(options.map((o) => o.textContent)).toEqual(
    [...UI_LANGUAGES].map((l) => languageName(l, l, true)),
  );
  expect(UI_LANGUAGES).toContain("de");
  fireEvent.click(view.getByRole("option", { name: "Deutsch" }));
  // Its catalog loaded first, then shown; the page's language and direction follow.
  await waitFor(() => expect(i18n.language).toBe("de"));
  expect(i18n.t("settings.uiLanguage")).not.toBe("Interface language");
  expect([document.documentElement.lang, document.documentElement.dir]).toEqual(["de", "ltr"]);
  await waitFor(() => expect(saved).toEqual([{ key: "uiLanguage", value: "de" }]));
  view.unmount();

  const device = await renderApp(<LanguageSwitch />);
  fireEvent.click(device.getByRole("combobox"));
  fireEvent.click(await device.findByRole("option", { name: "Русский" }));
  await waitFor(() => expect(i18n.language).toBe("ru"));
  expect(saved).toHaveLength(1);
  device.unmount();
  await switchLanguage("en");
});

test("a language's direction: right to left for Arabic and Persian, else left to right", () => {
  expect(["ar", "fa", "de", "zh", "ru"].map(languageDir)).toEqual([
    "rtl",
    "rtl",
    "ltr",
    "ltr",
    "ltr",
  ]);
});

test("Settings → Review: limits, retention and card types, no Advanced; the rest in the guide", async () => {
  const view = await renderApp(<ReviewSettings />);
  for (const text of ["New cards per day", "Desired retention", "Card types of a new word"])
    expect(view.getByText(text)).toBeTruthy();
  expect(view.queryByText("Advanced")).toBeNull();
  expect(view.queryByText(/Anki/)).toBeNull();
  // The rest in "How it works", the guide Review opens too.
  fireEvent.click(view.getByRole("button", { name: "How it works" }));
  expect((await view.findByText(/A new day starts at 4/)).closest("[role=dialog]")).toBeTruthy();
});

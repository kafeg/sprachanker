import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { LanguageSwitch } from "../../src/app/language-switch.tsx";
import i18n from "../../src/i18n/index.ts";
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
  const group = view.getByRole("group", { name: "Interface language" });
  expect(group.querySelector('[lang="de"]')?.textContent).toBe("Deutsch");
  fireEvent.click(view.getByRole("button", { name: "Deutsch" }));
  expect(i18n.language).toBe("de");
  await waitFor(() => expect(saved).toEqual([{ key: "uiLanguage", value: "de" }]));
  view.unmount();

  const device = await renderApp(<LanguageSwitch />);
  fireEvent.click(device.getByRole("button", { name: "Русский" }));
  expect(i18n.language).toBe("ru");
  expect(saved).toHaveLength(1);
  device.unmount();
  await i18n.changeLanguage("en");
});

test("Settings → Review: limits, retention and card types, no Advanced; the rest said in lines", async () => {
  const view = await renderApp(<ReviewSettings />);
  for (const text of ["New cards per day", "Desired retention", "Card types of a new word"])
    expect(view.getByText(text)).toBeTruthy();
  expect(view.queryByText("Advanced")).toBeNull();
  expect(view.queryByText(/Anki/)).toBeNull();
  expect(view.getByText(/A new day starts at 4/)).toBeTruthy();
});

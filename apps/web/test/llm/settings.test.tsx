import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { ModelList } from "../../src/llm/model-list.tsx";
import { ProviderCards } from "../../src/llm/provider-cards.tsx";
import type { LlmState } from "../../src/llm/setup-api.ts";
import { renderApp } from "../render.tsx";

const providers = [
  {
    id: "lmstudio",
    baseUrl: "http://localhost:1234/v1",
    defaultUrl: "http://localhost:1234/v1",
    key: "optional",
    hasKey: false,
    editableUrl: true,
  },
  {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultUrl: "https://openrouter.ai/api/v1",
    key: "required",
    hasKey: false,
    editableUrl: false,
  },
  {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultUrl: "https://api.openai.com/v1",
    key: "required",
    hasKey: false,
    editableUrl: false,
  },
  {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultUrl: "https://api.groq.com/openai/v1",
    key: "required",
    hasKey: true,
    editableUrl: false,
  },
  {
    id: "custom",
    baseUrl: "http://192.168.1.5:8080/v1",
    defaultUrl: "",
    key: "optional",
    hasKey: false,
    editableUrl: true,
  },
  {
    id: "claude-code",
    baseUrl: "",
    defaultUrl: "",
    key: "none",
    hasKey: false,
    editableUrl: false,
    installed: true,
  },
  {
    id: "codex",
    baseUrl: "",
    defaultUrl: "",
    key: "none",
    hasKey: false,
    editableUrl: false,
    installed: false,
  },
] as LlmState["providers"];

test("providers as cards, each saying what it lacks or where it is; a card picks it", async () => {
  const picked: Array<string | null> = [];
  const view = await renderApp(
    <ProviderCards
      state={{ provider: "custom", model: null, providers } as LlmState}
      onPick={(p) => picked.push(p)}
    />,
  );
  const card = (name: RegExp) => view.getByRole("button", { name });
  expect(card(/LM Studio/).textContent).toContain("on this computer");
  expect(card(/OpenRouter/).textContent).toContain("needs a key");
  expect(card(/OpenAI/).textContent).toContain("needs a key");
  expect(card(/Server on the network/).textContent).toContain("at 192.168.1.5:8080");
  expect(card(/Server on the network/).getAttribute("aria-pressed")).toBe("true");
  expect(card(/Codex/).textContent).toContain("not installed");
  expect(card(/Groq/).textContent).toContain("key saved");
  fireEvent.click(card(/OpenRouter/));
  fireEvent.click(card(/Off/));
  expect(picked).toEqual(["openrouter", null]);
});

test("the model list: free and JSON on where told; filters toggle; a pick reports the model", async () => {
  const picked: string[] = [];
  const models = [
    { id: "a/big", name: "A: Big", publisher: "a", json: true, price: { input: 3, output: 15 } },
    { id: "a/tiny:free", name: "A: Tiny", publisher: "a", json: true, free: true },
    { id: "b/old", name: "B: Old", publisher: "b", json: false },
  ];
  const view = await renderApp(
    <ModelList models={models} value={null} onPick={(m) => picked.push(m)} />,
  );
  const names = () =>
    view
      .getAllByRole("button", { pressed: false })
      .map((b) => b.textContent ?? "")
      .filter((t) => t.startsWith("A:") || t.startsWith("B:"));
  // "Free" and "Answers JSON" are on: only the free model that answers JSON is listed.
  const free = view.getByRole("button", { name: /^Free/ });
  expect(free.getAttribute("aria-pressed")).toBe("true");
  expect(view.getByRole("button", { name: /Answers JSON/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(names().map((n) => n.slice(0, 7))).toEqual(["A: Tiny"]);
  // Free off: the paid one too, still not the one without JSON.
  fireEvent.click(free);
  expect(names().some((n) => n.startsWith("A: Big"))).toBe(true);
  expect(names().some((n) => n.startsWith("B: Old"))).toBe(false);
  fireEvent.click(free);
  fireEvent.click(view.getByRole("button", { name: /A: Tiny/ }));
  expect(picked).toEqual(["a/tiny:free"]);
  expect(view.getByText("1 of 3 models")).toBeTruthy();
});

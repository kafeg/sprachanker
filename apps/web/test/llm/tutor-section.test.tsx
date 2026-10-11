import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { MessageCircle } from "lucide-react";
import { AppShell } from "../../src/app/shell.tsx";
import { useAiIn } from "../../src/llm/setup-api.ts";
import { SectionChatPage, TutorSection } from "../../src/llm/tutor-section.tsx";
import { renderApp } from "../render.tsx";

const MODEL = { provider: "custom", model: "m", providers: [] };
const at = Date.UTC(2026, 9, 10, 12, 0);
const begun = [{ key: "s/c", started: true }];
const usage = (turns: number) => ({
  tokens: 900,
  window: null,
  reply: 1500,
  kept: turns,
  total: turns,
});

const CHATS = {
  chats: [
    {
      id: "C2",
      current: true,
      edition: "ru-de",
      startedAt: at,
      lastAt: at + 5000,
      title: "Wie sagt man „Tasse“?",
      turns: 2,
      exerciseKeys: [],
    },
    {
      id: "C1",
      current: true,
      edition: "en-fr",
      startedAt: at - 9000,
      lastAt: at - 1000,
      title: "Explain the past tense",
      turns: 4,
      exerciseKeys: [],
    },
  ],
};

test("the section's chats: the latest first with the language each practises; one opens, one is deleted after asking", async () => {
  const view = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [
      [["llm"], MODEL],
      [["tutor-chats", null], CHATS],
      [["courses"], begun],
    ],
  });
  expect(view.getByRole("link", { name: "New chat" }).getAttribute("href")).toBe("/tutor/new");
  const rows = view.getAllByRole("button", { name: /Wie sagt man|Explain the past tense/ });
  expect(rows.map((r) => r.textContent?.includes("Tasse"))).toEqual([true, false]);
  expect(rows[0]?.textContent).toContain("2 messages");
  expect(view.getByRole("img", { name: "German" })).toBeTruthy();
  expect(view.getByRole("img", { name: "French" })).toBeTruthy();

  fireEvent.click(view.getAllByRole("button", { name: "Delete chat" })[1] as HTMLElement);
  expect(view.getByRole("alertdialog").textContent).toContain("Delete this chat?");

  fireEvent.click(rows[1] as HTMLElement);
  await waitFor(() => expect(view.router?.state.location.pathname).toBe("/tutor/C1"));
});

test("no chats: how to begin one; no course begun: that one is needed first", async () => {
  const empty = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [
      [["llm"], MODEL],
      [["tutor-chats", null], { chats: [] }],
      [["courses"], begun],
    ],
  });
  expect(empty.getByText("No chats yet: begin one with “New chat”.")).toBeTruthy();
  empty.unmount();

  const none = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [
      [["llm"], MODEL],
      [["tutor-chats", null], { chats: [] }],
      [["courses"], [{ key: "s/c", started: false }]],
    ],
  });
  expect(none.getByText(/begin a course first/)).toBeTruthy();
  expect(none.getByRole("link", { name: "Choose a course" }).getAttribute("href")).toBe(
    "/downloaded",
  );
});

test("a new chat offers a few ways to start; without a course begun, that is said instead", async () => {
  const view = await renderApp(<SectionChatPage chat="new" />, {
    path: "/tutor/new",
    data: [
      [["llm"], MODEL],
      [["courses"], begun],
      [["tutor-context", null, undefined, "en", 0], usage(0)],
    ],
  });
  for (const start of [
    "I have a grammar question",
    "Go through a text with me",
    "Let's practise a conversation",
  ])
    expect(view.getByRole("button", { name: start })).toBeTruthy();
  expect(view.getByPlaceholderText("Ask a question…")).toBeTruthy();
  // Typed only: no microphone in the message box.
  expect(view.queryByRole("button", { name: /microphone|dictat/i })).toBeNull();
  expect(view.getByRole("button", { name: "All chats" })).toBeTruthy();
  view.unmount();

  const none = await renderApp(<SectionChatPage chat="new" />, {
    path: "/tutor/new",
    data: [
      [["llm"], MODEL],
      [["courses"], []],
    ],
  });
  expect(none.getByText(/begin a course first/)).toBeTruthy();
  expect(none.queryByPlaceholderText("Ask a question…")).toBeNull();
});

test("a chat continued: its turns, the reply as Markdown", async () => {
  const view = await renderApp(<SectionChatPage chat="C1" />, {
    path: "/tutor/C1",
    data: [
      [["llm"], MODEL],
      [["courses"], begun],
      [
        ["tutor-chat", "C1"],
        {
          turns: [
            { role: "user", text: "Explain the past tense", ts: at },
            { role: "assistant", text: "The **passé composé** …", ts: at },
          ],
        },
      ],
      [["tutor-context", "C1", undefined, "en", 2], usage(2)],
    ],
  });
  expect(view.getByText("Explain the past tense")).toBeTruthy();
  expect(view.getByText("passé composé").tagName).toBe("STRONG");
  expect(view.queryByRole("button", { name: "I have a grammar question" })).toBeNull();
});

test("the tutor's place off or no model: the section says how to turn it on, with no new chat", async () => {
  const off = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [
      [["llm"], MODEL],
      [["settings"], { "llm.offIn": ["tutor"] }],
    ],
  });
  expect(off.getByText(/The tutor is turned off/)).toBeTruthy();
  expect(off.getByRole("link", { name: "Set up the AI assistant" })).toBeTruthy();
  expect(off.queryByRole("link", { name: "New chat" })).toBeNull();
  off.unmount();

  const noModel = await renderApp(<SectionChatPage chat="C1" />, {
    path: "/tutor/C1",
    data: [
      [["llm"], { provider: null, model: null, providers: [] }],
      [["courses"], begun],
    ],
  });
  expect(noModel.getByText("The tutor needs an AI model.")).toBeTruthy();
});

test("the navigation: Tutor after Exams while the assistant works there, absent otherwise", async () => {
  const shell = (offIn: string[]) =>
    renderApp(
      <AppShell
        extra={{
          to: "/tutor",
          key: "nav.tutor",
          icon: MessageCircle,
          useShown: () => useAiIn("tutor"),
        }}
      />,
      {
        path: "/",
        data: [
          [["llm"], MODEL],
          [["settings"], { "llm.offIn": offIn }],
          [["decks"], { decks: [] }],
          [["downloads"], { jobs: [] }],
          [["session"], { profile: null }],
          [["health"], { version: "1" }],
        ],
      },
    );
  const on = await shell([]);
  const sidebar = on.container.querySelector("aside") as HTMLElement;
  const names = [...sidebar.querySelectorAll("a")].map((a) => a.textContent?.trim());
  expect(names.slice(1, -1)).toEqual([
    "Courses",
    "Review",
    "Exams",
    "Tutor",
    "Notebook",
    "Settings",
  ]);
  on.unmount();
  const off = await shell(["tutor"]);
  expect(off.queryAllByRole("link", { name: "Tutor" })).toEqual([]);
});

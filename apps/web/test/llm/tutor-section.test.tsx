import { afterEach, expect, test } from "bun:test";
import { CHAT_ID_HEADER } from "@sprachanker/schema";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { MessageCircle } from "lucide-react";
import { AppShell } from "../../src/app/shell.tsx";
import { switchLanguage } from "../../src/i18n/index.ts";
import { useAiIn } from "../../src/llm/setup-api.ts";
import { SectionChatPage, TutorSection } from "../../src/llm/tutor-section.tsx";
import { renderApp } from "../render.tsx";

const MODEL = { provider: "custom", model: "m", providers: [] };
const at = Date.UTC(2026, 9, 10, 12, 0);
const usage = (turns: number) => ({
  tokens: 900,
  window: null,
  reply: 1500,
  kept: turns,
  total: turns,
});

const chat = (id: string, edition: string, title: string, turns: number, lastAt: number) => ({
  id,
  current: true,
  edition,
  startedAt: lastAt - 1000,
  lastAt,
  title,
  turns,
  exerciseKeys: [],
});
const CHATS = [
  chat("C2", "ru-de", "Wie sagt man „Tasse“?", 2, at + 5000),
  chat("C1", "en-fr", "Explain the past tense", 4, at - 1000),
];

/** The section's chats as the cache holds them: pages of a list, the first saying whether a new chat
 *  can begin. */
const pages = (
  ...list: Array<{ chats: unknown[]; more?: boolean; cannotStart?: string | null }>
) => ({
  pages: list.map((p) => ({ more: false, cannotStart: null, ...p })),
  pageParams: list.map((_, i) => i * 20),
});
const SECTION_CHATS = (page: Parameters<typeof pages>[0]) =>
  [["tutor-chats", null], pages(page)] as [unknown[], unknown];

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

/** The server on paper: what it was asked (method, path and query, a POST's body) and its answers. */
function server(
  answer: (method: string, path: string, body: string) => Response | Promise<Response>,
) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.text() : "";
    asked.push(`${request.method} ${url.pathname}${url.search} ${body}`.trim());
    return answer(request.method, url.pathname, body);
  }) as typeof fetch;
  return asked;
}

/** A reply streamed under a chat's name: its first part at once, the rest only when `finish` is
 *  called (or, `fail`, the connection dropped); the request's signal stops it. */
function reply(signal: AbortSignal | undefined, id: string) {
  let finish!: (text?: string) => void;
  let fail!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Gern! "));
      finish = (text = "Fangen wir an.") => {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      };
      fail = () => controller.error(new TypeError("socket closed"));
      signal?.addEventListener("abort", () => controller.error(new DOMException("", "AbortError")));
    },
  });
  return {
    response: new Response(body, { headers: { [CHAT_ID_HEADER]: id } }),
    finish: () => finish(),
    fail: () => fail(),
  };
}

test("the section's chats: the latest first with the language each practises; one opens, one is deleted after asking", async () => {
  const view = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [[["llm"], MODEL], SECTION_CHATS({ chats: CHATS })],
  });
  expect(view.getByRole("link", { name: "New chat" }).getAttribute("href")).toBe("/tutor/new");
  const rows = view.getAllByRole("button", { name: /Wie sagt man|Explain the past tense/ });
  expect(rows.map((r) => r.textContent?.includes("Tasse"))).toEqual([true, false]);
  expect(rows[0]?.textContent).toContain("2 messages");
  expect(view.getByRole("img", { name: "German" })).toBeTruthy();
  expect(view.getByRole("img", { name: "French" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Show more" })).toBeNull();

  fireEvent.click(view.getAllByRole("button", { name: "Delete chat" })[1] as HTMLElement);
  expect(view.getByRole("alertdialog").textContent).toContain("Delete this chat?");

  fireEvent.click(rows[1] as HTMLElement);
  await waitFor(() => expect(view.router?.state.location.pathname).toBe("/tutor/C1"));
});

test("more chats than a page: “Show more” reads the next page after those shown", async () => {
  const first = Array.from({ length: 20 }, (_, i) =>
    chat(`P${i}`, "ru-de", `Frage ${i}`, 2, at - i),
  );
  const asked = server(() =>
    Response.json({
      chats: [chat("P19", "ru-de", "Frage 19", 2, at - 19), chat("Q", "ru-de", "Die letzte", 2, 0)],
      more: false,
      cannotStart: null,
    }),
  );
  const view = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [[["llm"], MODEL], SECTION_CHATS({ chats: first, more: true })],
  });
  expect(view.getAllByRole("button", { name: /Frage \d/ })).toHaveLength(20);
  fireEvent.click(view.getByRole("button", { name: "Show more" }));
  await waitFor(() => expect(view.getByRole("button", { name: /Die letzte/ })).toBeTruthy());
  expect(asked).toEqual(["GET /api/llm/tutor/section/chats?offset=20"]);
  // A chat that moved between the pages is listed once; nothing more to show.
  expect(view.getAllByRole("button", { name: /Frage 19/ })).toHaveLength(1);
  expect(view.queryByRole("button", { name: "Show more" })).toBeNull();
});

test("no chats: how to begin one; no course begun (as the server says): that one is needed first", async () => {
  const empty = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [[["llm"], MODEL], SECTION_CHATS({ chats: [] })],
  });
  expect(empty.getByText("No chats yet: begin one with “New chat”.")).toBeTruthy();
  empty.unmount();

  const none = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [
      [["llm"], MODEL],
      SECTION_CHATS({ chats: [], cannotStart: "no_course_studied" }),
      // Courses started on the device's reading do not count: the server's word does.
      [["courses"], [{ key: "s/c", started: true }]],
    ],
  });
  expect(none.getByText(/begin a course first/)).toBeTruthy();
  expect(none.getByRole("link", { name: "Choose a course" }).getAttribute("href")).toBe(
    "/downloaded",
  );
});

test("the chats not read: the error with a way to try again, never an endless wait", async () => {
  const view = await renderApp(<TutorSection />, {
    path: "/tutor",
    data: [[["llm"], MODEL]],
    failed: [[["tutor-chats", null], new Error("offline")]],
  });
  expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(view.queryByText("Loading…")).toBeNull();
  view.unmount();

  const page = await renderApp(<SectionChatPage chat="new" />, {
    path: "/tutor/new",
    data: [[["llm"], MODEL]],
    failed: [[["tutor-chats", null], new Error("offline")]],
  });
  expect(page.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("a new chat offers a few ways to start; without a course begun, that is said instead", async () => {
  const view = await renderApp(<SectionChatPage chat="new" />, {
    path: "/tutor/new",
    data: [
      [["llm"], MODEL],
      SECTION_CHATS({ chats: [] }),
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
      SECTION_CHATS({ chats: [], cannotStart: "no_course_studied" }),
      [["courses"], []],
    ],
  });
  expect(none.getByText(/begin a course first/)).toBeTruthy();
  expect(none.getByRole("link", { name: "Choose a course" }).getAttribute("href")).toBe("/catalog");
  expect(none.queryByPlaceholderText("Ask a question…")).toBeNull();
});

/** A new chat's page with the server on paper; `answer` the section's message. */
async function newChat(answer: (signal: AbortSignal | undefined) => Response) {
  const kept: { turns?: unknown[] } = {};
  let signal: AbortSignal | undefined;
  const asked = server((method, path) => {
    if (method === "POST" && path === "/api/llm/tutor/section") return answer(signal);
    if (path === "/api/llm/tutor/chats/N1")
      return kept.turns
        ? Response.json({ turns: kept.turns })
        : Response.json({ error: "no_such_chat" }, { status: 404 });
    if (path === "/api/llm/tutor/section/context") return Response.json(usage(2));
    if (path === "/api/llm/tutor/section/chats")
      return Response.json({ chats: [], more: false, cannotStart: null });
    throw new Error(`not on paper: ${method} ${path}`);
  });
  // The request's signal, as the client passes it.
  const fetching = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetching(input, init);
  }) as typeof fetch;
  const view = await renderApp(<SectionChatPage chat="new" />, {
    path: "/tutor/new",
    data: [
      [["llm"], MODEL],
      SECTION_CHATS({ chats: [] }),
      [["tutor-context", null, undefined, "en", 0], usage(0)],
    ],
  });
  return { view, asked, kept };
}

test("a way in is sent for the learner, marked so; the reply in, the chat keeps its turns on screen and takes its address", async () => {
  let stream: ReturnType<typeof reply> | undefined;
  const { view, asked, kept } = await newChat((signal) => {
    stream = reply(signal, "N1");
    return stream.response;
  });
  fireEvent.click(view.getByRole("button", { name: "Let's practise a conversation" }));
  await waitFor(() => expect(view.getByText("Gern!")).toBeTruthy());
  expect(asked[0]).toStartWith("POST /api/llm/tutor/section ");
  expect(JSON.parse(asked[0]?.slice("POST /api/llm/tutor/section ".length) ?? "")).toMatchObject({
    start: true,
    language: "en",
  });
  expect(asked[0]).not.toContain("chatId");
  kept.turns = [
    { role: "user", text: "Let's practise a conversation.", start: true, ts: at },
    { role: "assistant", text: "Gern! Fangen wir an.", ts: at },
  ];
  stream?.finish();
  await waitFor(() => expect(view.router?.state.location.pathname).toBe("/tutor/N1"));
  // The ways in never came back between the reply and the chat's own address.
  expect(view.queryByRole("button", { name: "I have a grammar question" })).toBeNull();
  expect(view.getByText("Gern! Fangen wir an.")).toBeTruthy();
});

test("a new chat's first reply stopped: the part kept is shown under the chat's address, the next message goes to it", async () => {
  const { view, asked, kept } = await newChat((signal) => reply(signal, "N1").response);
  fireEvent.change(view.getByPlaceholderText("Ask a question…"), { target: { value: "Hallo?" } });
  fireEvent.click(view.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(view.getByText("Gern!")).toBeTruthy());
  // The server keeps the question with the part of the reply that came.
  kept.turns = [
    { role: "user", text: "Hallo?", ts: at },
    { role: "assistant", text: "Gern!", ts: at },
  ];
  fireEvent.click(view.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(view.router?.state.location.pathname).toBe("/tutor/N1"));
  expect(asked).toContain("GET /api/llm/tutor/chats/N1");
  expect(view.queryByText(/could not|failed/i)).toBeNull();
});

test("a new chat's first reply broken off: nothing kept, the page stays a new chat with the question back in the box", async () => {
  let stream: ReturnType<typeof reply> | undefined;
  const { view, asked } = await newChat((signal) => {
    stream = reply(signal, "N1");
    return stream.response;
  });
  fireEvent.change(view.getByPlaceholderText("Ask a question…"), { target: { value: "Hallo?" } });
  fireEvent.click(view.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(view.getByText("Gern!")).toBeTruthy());
  stream?.fail();
  await waitFor(() =>
    expect((view.getByPlaceholderText("Ask a question…") as HTMLTextAreaElement).value).toBe(
      "Hallo?",
    ),
  );
  // Looked for twice (the server may keep a reply a moment later), found neither time.
  await waitFor(() =>
    expect(asked.filter((a) => a === "GET /api/llm/tutor/chats/N1")).toHaveLength(2),
  );
  expect(view.router?.state.location.pathname).toBe("/tutor/new");
  expect(view.getByRole("button", { name: "I have a grammar question" })).toBeTruthy();
});

test("a chat continued: its turns, the reply as Markdown", async () => {
  const view = await renderApp(<SectionChatPage chat="C1" />, {
    path: "/tutor/C1",
    data: [
      [["llm"], MODEL],
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
    data: [[["llm"], { provider: null, model: null, providers: [] }]],
  });
  expect(noModel.getByText("The tutor needs an AI model.")).toBeTruthy();
});

/** The app's frame with the Tutor section's entry, the tutor's place off in `offIn`. */
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

test("the navigation: Tutor after Exams while the assistant works there, absent otherwise", async () => {
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

test("the phone's tab bar of six: a short label where the language's own does not fit, the full one its name", async () => {
  expect(await switchLanguage("de")).toBe(true);
  try {
    const view = await shell([]);
    const bar = within(view.container.querySelector("nav") as HTMLElement);
    const review = bar.getByRole("link", { name: "Wiederholen" });
    expect([...review.querySelectorAll("span:not(.relative)")].map((s) => s.textContent)).toEqual([
      "Karten",
      "Wiederholen",
    ]);
    expect(bar.getByRole("link", { name: "Einstellungen" }).textContent).toContain("Optionen");
    // A label that fits is shown as it is.
    const tutor = bar.getByRole("link", { name: "Tutor" });
    expect([tutor.getAttribute("aria-label"), tutor.textContent]).toEqual([null, "Tutor"]);
  } finally {
    await switchLanguage("en");
  }
});

// The Tutor section (07): chats about no lesson — started, kept, listed, continued, deleted — with
// what the learner has met in their courses as context; refused before a course is begun and while
// the tutor's place is off.
import { describe, expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CHAT_ID_HEADER, CLIENT_HEADERS } from "@sprachanker/schema";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const REPLY = "Der Akkusativ: **den** Kaffee.";

/** A fake provider streaming one reply; it records each request's messages (or is down; `slow`: the
 *  reply's second half a while after its first). */
function provider(state: { down?: boolean; slow?: boolean } = {}) {
  const calls: Array<Array<{ role: string; content: string }>> = [];
  const event = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const fetch = (async (_url: string, init: RequestInit) => {
    if (state.down) throw new TypeError("connection refused");
    calls.push((JSON.parse(init.body as string) as { messages: never[] }).messages);
    if (!state.slow) return new Response(`${event(REPLY)}data: [DONE]\n\n`);
    const [head, tail] = [REPLY.slice(0, 15), REPLY.slice(15)];
    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(event(head)));
          await Bun.sleep(300);
          controller.enqueue(new TextEncoder().encode(`${event(tail)}data: [DONE]\n\n`));
          controller.close();
        },
      }),
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

/** An app with a model set up; `studied`: a lesson of the fixture course worked on, one item wrong. */
async function app(options: { studied?: boolean; down?: boolean } = {}) {
  const state: { down?: boolean; slow?: boolean } = { down: options.down };
  const fake = provider(state);
  const t = await setup({ fetch: fake.fetch });
  await t.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://llm.test/v1" });
  await t.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  if (options.studied ?? true) {
    const { run } = await t.sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    await t.sendJson("POST", `/api/runs/${run.id}/events`, {
      events: [
        {
          id: ulid(),
          type: "answered",
          itemKey: `${LESSON}/ex-06#1`,
          payload: { answer: { g1: "a" }, attempt: 1, ms: 1 },
        },
      ],
    });
  }
  /** A message in the section: the reply's text and the chat it names (`start`: sent for the
   *  learner, a way into a new chat; `target`: the language a new chat practises). */
  const say = async (message: string, chatId?: string, start?: boolean, target?: string) => {
    const body = { message, language: "ru", chatId, start, target };
    const res = await t.send("POST", "/api/llm/tutor/section", body);
    return { status: res.status, id: res.headers.get(CHAT_ID_HEADER), text: await res.text() };
  };
  return { ...t, fake, state, say };
}

describe("the Tutor section", () => {
  test("a chat started, kept with its turns, listed, continued later", async () => {
    const { say, getJson, fake } = await app();
    const first = await say("Как сказать «кофе»?");
    expect(first).toMatchObject({ status: 200, text: REPLY });
    const id = first.id as string;
    expect(id).toMatch(/^[0-9A-Z]{26}$/);

    const { chats } = await getJson("/api/llm/tutor/section/chats");
    expect(chats).toMatchObject([{ id, title: "Как сказать «кофе»?", turns: 2, edition: "ru-de" }]);
    // A lesson's chats are not the section's, nor the other way round.
    expect((await getJson(`/api/llm/tutor/chats?lessonKey=${LESSON}`)).chats).toEqual([]);

    // Continued later: the earlier turns go with the next message, both stored in the same chat.
    const next = await say("А «чашка»?", id);
    expect(next.id).toBe(id);
    expect(fake.calls[1]?.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    const { turns } = await getJson(`/api/llm/tutor/chats/${id}`);
    expect(turns.map((t: { role: string; text: string }) => [t.role, t.text])).toEqual([
      ["user", "Как сказать «кофе»?"],
      ["assistant", REPLY],
      ["user", "А «чашка»?"],
      ["assistant", REPLY],
    ]);
    expect(turns[1].model).toBe("m");

    // A new chat leaves the first one open: both are listed, the one written in last first, and
    // either can be continued.
    const other = await say("Новый вопрос");
    expect(other.id).not.toBe(id);
    expect(
      (await getJson("/api/llm/tutor/section/chats")).chats.map((c: { id: string }) => c.id),
    ).toEqual([other.id, id]);
    await say("Ещё", id);
    expect((await getJson("/api/llm/tutor/section/chats")).chats[0]).toMatchObject({
      id,
      turns: 6,
    });
  });

  test("the context: what the learner has met in their courses, without a lesson", async () => {
    const { sendJson, fake, say } = await app();
    const { body } = await sendJson("POST", "/api/llm/tutor/section/prompt", {
      message: "?",
      language: "en",
    });
    const system = body.messages[0].content as string;
    expect(system).toContain("friendly German tutor");
    expect(system).toContain("Explain in English");
    for (const part of [
      "<courses>",
      "- Демо-курс: 0 of 2 lessons done; worked on (latest first): Im Café",
      "Words met (latest lessons first): der Kaffee, die Kaffees (кофе)",
      "Grammar met (latest lessons first): Артикли",
      "Learner's mistakes (newest first):\n- [Im Café · Herr или Frau? · item 1]",
    ])
      expect(system).toContain(part);
    expect(system).not.toContain("Exercise on screen");
    // Nothing was sent to the model, and no tools are offered.
    expect(fake.calls).toHaveLength(0);
    await say("?");
    expect(fake.calls[0]?.[0]?.content).toContain("<courses>");

    const usage = await sendJson("POST", "/api/llm/tutor/section/context", {
      message: "",
      language: "en",
    });
    expect(usage).toMatchObject({ reply: 1500, kept: 0, total: 0 });
    expect(usage.tokens).toBeGreaterThan(100);
  });

  test("a chat keeps its language: its edition, whatever is studied later", async () => {
    const { say, sendJson, getJson } = await app();
    const { id } = await say("Привет");
    // The course is studied in the other edition now: a new chat takes that one, the old one keeps its.
    await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: "sprachanker.fixture/demo/00-02",
      edition: "en-de",
    }).then(({ run }) =>
      sendJson("POST", `/api/runs/${run.id}/events`, {
        events: [{ id: ulid(), type: "step_done", payload: { step: "words" } }],
      }),
    );
    await say("Hello");
    const { chats } = await getJson("/api/llm/tutor/section/chats");
    expect(chats.map((c: { edition: string }) => c.edition)).toEqual(["en-de", "ru-de"]);
    expect(chats[1].id).toBe(id);

    // Each chat reads the course in its own edition where the course has it: the translations,
    // titles and mistakes in the chat's language.
    const system = async (chatId?: string) =>
      (
        await sendJson("POST", "/api/llm/tutor/section/prompt", {
          chatId,
          message: "?",
          language: "en",
        })
      ).body.messages[0].content as string;
    const old = await system(id as string);
    expect(old).toContain("- Демо-курс: 0 of 2 lessons done");
    expect(old).toContain("der Kaffee, die Kaffees (кофе)");
    const fresh = await system();
    expect(fresh).toContain("- Demo course: 0 of 2 lessons done");
    expect(fresh).toContain("der Kaffee, die Kaffees (coffee)");
  });

  test("a new chat practises the language chosen, one the courses begun teach; another refused", async () => {
    const { say, send, getJson, fake } = await app();
    expect((await getJson("/api/llm/tutor/section/chats")).targets).toEqual(["de"]);
    const { status, id } = await say("Hallo", undefined, false, "de");
    expect(status).toBe(200);
    expect(await getJson(`/api/llm/tutor/chats/${id}`)).toMatchObject({ edition: "ru-de" });

    // A language no course begun teaches: refused before the model is asked, nothing kept — the
    // gauge and the {} preview alike.
    const refused = await say("Bonjour", undefined, false, "fr");
    expect([refused.status, JSON.parse(refused.text).error]).toEqual([400, "language_not_studied"]);
    for (const path of ["context", "prompt"]) {
      const res = await send("POST", `/api/llm/tutor/section/${path}`, {
        message: "",
        language: "en",
        target: "fr",
      });
      expect(res.status).toBe(400);
    }
    expect(fake.calls).toHaveLength(1);
    expect((await getJson("/api/llm/tutor/section/chats")).chats).toHaveLength(1);

    // A continued chat keeps its language: a language sent with it is not read.
    expect((await say("Noch was", id as string, false, "fr")).status).toBe(200);
    expect(await getJson(`/api/llm/tutor/chats/${id}`)).toMatchObject({
      edition: "ru-de",
      turns: [{}, {}, {}, {}],
    });
  });

  test("the courses of a chat's language gone: the chat goes on, its prompt saying nothing is known", async () => {
    const { say, sendJson } = await app();
    const { id } = await say("Привет");
    await sendJson("POST", "/api/progress/reset", { series: FIXTURE_SERIES, course: "demo" });
    const { body } = await sendJson("POST", "/api/llm/tutor/section/prompt", {
      chatId: id,
      message: "?",
      language: "en",
    });
    const system = body.messages[0].content as string;
    expect(system).toContain("No course of this language is begun now");
    expect(system).not.toContain("Courses studied");
    expect((await say("Ещё", id as string)).status).toBe(200);
  });

  test("a lesson's chat is no chat of the section: a message to it is refused", async () => {
    const { send, getJson, say } = await app();
    const lesson = await send("POST", "/api/llm/tutor", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
      message: "?",
      language: "ru",
    });
    await lesson.text();
    const [chat] = (await getJson(`/api/llm/tutor/chats?lessonKey=${LESSON}`)).chats;
    const res = await say("Ещё", chat.id);
    expect([res.status, JSON.parse(res.text).error]).toEqual([404, "no_such_chat"]);
    expect(
      (await getJson(`/api/llm/tutor/chats/${chat.id}?lessonKey=${LESSON}`)).turns,
    ).toHaveLength(2);
  });

  test("deleted after asking: gone with its turns; another's id is no chat", async () => {
    const { say, send, get, getJson } = await app();
    const { id } = await say("Удали меня");
    // A lesson's chat is not reached as the section's.
    expect(
      (await send("DELETE", `/api/llm/tutor/chats/${id}?lessonKey=${LESSON}`, {})).status,
    ).toBe(404);
    expect((await send("DELETE", `/api/llm/tutor/chats/${id}`, {})).status).toBe(200);
    expect((await getJson("/api/llm/tutor/section/chats")).chats).toEqual([]);
    expect((await get(`/api/llm/tutor/chats/${id}`)).status).toBe(404);
    // A message to it now is refused rather than starting it again.
    const again = await say("Ещё", id as string);
    expect([again.status, JSON.parse(again.text).error]).toEqual([404, "no_such_chat"]);
  });

  test("resetting the course's progress leaves the section's chats", async () => {
    const { say, sendJson, getJson } = await app();
    await say("Привет");
    await sendJson("POST", "/api/progress/reset", { series: FIXTURE_SERIES, course: "demo" });
    expect((await getJson("/api/llm/tutor/section/chats")).chats).toHaveLength(1);
  });

  test("a failed call leaves nothing; a reply that comes keeps the chat", async () => {
    const { say, getJson, state } = await app({ down: true });
    const failed = await say("Вопрос");
    expect(failed.status).toBe(502);
    expect((await getJson("/api/llm/tutor/section/chats")).chats).toEqual([]);
    state.down = false;
    expect((await say("Вопрос")).status).toBe(200);
    expect((await getJson("/api/llm/tutor/section/chats")).chats).toHaveLength(1);
  });

  test("no course begun: refused, nothing kept; the list says a chat cannot begin, and why", async () => {
    const { say, getJson } = await app({ studied: false });
    const res = await say("Привет");
    expect([res.status, JSON.parse(res.text).error]).toEqual([409, "no_course_studied"]);
    expect(await getJson("/api/llm/tutor/section/chats")).toEqual({
      chats: [],
      more: false,
      targets: [],
      cannotStart: "no_course_studied",
    });
    // Nothing begun: no language to choose either.
    const chosen = await say("Hallo", undefined, false, "de");
    expect([chosen.status, JSON.parse(chosen.text).error]).toEqual([409, "no_course_studied"]);
    expect((await (await app()).getJson("/api/llm/tutor/section/chats")).cannotStart).toBeNull();
  });

  test("more than a page of chats: the latest written in first, the rest a page later", async () => {
    const { say, getJson, get } = await app();
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) ids.push((await say(`Вопрос ${i}`)).id as string);
    // An early chat written in again comes first.
    await say("Ещё", ids[0]);
    const first = await getJson("/api/llm/tutor/section/chats");
    expect(first.chats).toHaveLength(20);
    expect(first.more).toBe(true);
    expect(first.chats[0]).toMatchObject({ id: ids[0], title: "Вопрос 0", turns: 4 });
    expect(first.chats[1].id).toBe(ids[22]);
    const second = await getJson("/api/llm/tutor/section/chats?offset=20");
    expect(second.more).toBe(false);
    expect(second.chats.map((c: { id: string }) => c.id)).toEqual([ids[3], ids[2], ids[1]]);
    expect((await get("/api/llm/tutor/section/chats?offset=-1")).status).toBe(400);
  });

  test("a chat begun from a way in is titled by the first message typed, the way in until then", async () => {
    const { say, getJson } = await app();
    const { id } = await say("Let's practise a conversation.", undefined, true);
    const title = async () => (await getJson("/api/llm/tutor/section/chats")).chats[0].title;
    expect(await title()).toBe("Let's practise a conversation.");
    await say("Im Café, bitte", id as string);
    expect(await title()).toBe("Im Café, bitte");
    const { turns } = await getJson(`/api/llm/tutor/chats/${id}`);
    expect(turns.map((t: { start?: boolean }) => t.start ?? false)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  test("a reply the learner stops is kept as far as it came: the chat begun, its name already sent", async () => {
    const { get, getJson, state } = await app();
    state.slow = true;
    const stop = new AbortController();
    const res = await get("/api/llm/tutor/section", {
      method: "POST",
      headers: { "content-type": "application/json", ...CLIENT_HEADERS },
      body: JSON.stringify({ message: "Стоп", language: "ru" }),
      signal: stop.signal,
    });
    const id = res.headers.get(CHAT_ID_HEADER) as string;
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(REPLY.slice(0, 15));
    // The learner stops it (the connection closed) while the model is still writing.
    stop.abort();
    await reader.cancel().catch(() => {});
    await Bun.sleep(100);
    const { turns } = await getJson(`/api/llm/tutor/chats/${id}`);
    expect(turns.map((t: { text: string }) => t.text)).toEqual(["Стоп", REPLY.slice(0, 15).trim()]);
  });

  test("the tutor's place off: its messages refused, the lesson's too; its chats still read", async () => {
    const { say, send, getJson } = await app();
    const { id } = await say("Привет");
    await send("PUT", "/api/settings", { key: "llm.offIn", value: ["tutor"] });
    const res = await say("Ещё", id as string);
    expect([res.status, JSON.parse(res.text).error]).toEqual([409, "ai_place_off"]);
    const lesson = await send("POST", "/api/llm/tutor", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
      message: "?",
      language: "ru",
    });
    expect(lesson.status).toBe(409);
    expect((await getJson(`/api/llm/tutor/chats/${id}`)).turns).toHaveLength(2);
  });
});

import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { TutorHistory } from "../../src/llm/tutor-history.tsx";
import { lesson, locale } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const at = Date.UTC(2026, 9, 7, 12, 0);

test("the tutor's history: the lesson's chats, each opening to its turns with time and exercise", async () => {
  const view = await renderApp(<TutorHistory {...ids} />, {
    data: [
      [["lesson", ids.series, ids.lessonKey, ids.edition], { lesson, locale }],
      [
        ["tutor-chats", ids.lessonKey],
        {
          chats: [
            {
              id: "C2",
              current: true,
              startedAt: at,
              lastAt: at,
              title: "Wie geht's?",
              turns: 2,
              exerciseKeys: [],
            },
            {
              id: "C1",
              current: false,
              startedAt: at - 1000,
              lastAt: at - 500,
              title: "Warum Nein?",
              turns: 2,
              exerciseKeys: [`${lesson.key}/ex-02`],
            },
          ],
        },
      ],
      [
        ["tutor-chat", "C1"],
        {
          turns: [
            {
              role: "user",
              text: "Warum Nein?",
              exerciseKey: `${lesson.key}/ex-02`,
              ts: at - 1000,
            },
            { role: "assistant", text: "Weil **ja** richtig ist.", ts: at - 500 },
          ],
        },
      ],
    ],
  });
  const current = view.getByRole("button", { name: /Wie geht's\?/ });
  expect(current.textContent).toContain("current");
  expect(current.textContent).toContain("2 messages");
  const earlier = view.getByRole("button", { name: /Warum Nein\?/ });
  fireEvent.click(earlier);
  // The learner's turn says when and on which exercise; the reply is rendered Markdown.
  expect(view.getByText(/· Second$/)).toBeTruthy();
  expect(view.getByText("ja").tagName).toBe("STRONG");
  expect(view.getByRole("button", { name: "Delete chat" })).toBeTruthy();
});

test("no chats yet: said so", async () => {
  const view = await renderApp(<TutorHistory {...ids} />, {
    data: [[["tutor-chats", ids.lessonKey], { chats: [] }]],
  });
  expect(view.getByText("No earlier chats in this lesson yet.")).toBeTruthy();
});

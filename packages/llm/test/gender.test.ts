// The learner's gender in a reply (07): the words that mark it found by the learner's language — the
// third walkthrough's own phrasings, and those that only look alike.
import { expect, test } from "bun:test";
import { genderMarked, genderProblem } from "../src/tasks/gender.ts";
import { writingTaskTask } from "../src/tasks/writing-task.ts";

test("a task's reply marking the learner's gender is its quality: asked again once", () => {
  const lesson = { title: "Essen", goals: [], grammarHtml: [], vocab: [] };
  const task = writingTaskTask({ language: "ru", target: "de", lesson });
  const reply = (point: string) => ({
    situation: "Вечеринка.",
    points: [point, "Напиши, когда она начнётся.", "Пригласи друга."],
  });
  expect(task.quality?.(reply("Напиши, какое блюдо ты решил приготовить."))).toContain("ты решил");
  expect(task.quality?.(reply("Напиши, какое блюдо будет на столе."))).toBeUndefined();
});

test("Russian: the learner's past, short adjectives, both forms side by side, a sentence they would say", () => {
  for (const text of [
    "Напиши, какое блюдо ты решил приготовить.",
    "Если бы ты поехал по обмену…",
    "Ты уже встречал такую тему.",
    "Значит, ты у нас новенький.",
    "Расскажи, есть ли у тебя брат или ты единственный ребёнок.",
    "Приведи пример, согласен ты с этим или нет.",
    "Решил ли ты?",
    "Напиши, кого ты встречал(а) на съёмочной площадке.",
    "Твой брат должен/должна помогать.",
    "Ты уже рад(а)?",
    "Можно сказать: «Я хотел бы другой номер».",
  ])
    expect(genderMarked([text], "ru")).toBeString();
});

test("Russian: no mark in other people's words, a rule's, a German pair, a partner of its own", () => {
  for (const text of [
    "Глагол должен стоять в конце предложения.",
    "Ах, мой кофе готов.",
    "Представь человека, который пришёл с тобой.",
    "Какие правила ты знаешь?",
    "У тебя получилось! Что выбрано?",
    "Kellner/Kellnerin — официант, официантка.",
    "Хотелось бы другой номер.",
  ])
    expect(genderMarked([text], "ru")).toBeUndefined();
  // A partner speaking of itself: its own first person is no mark where only the learner's is asked.
  expect(genderMarked(["Я хотел бы помочь."], "ru", false)).toBeUndefined();
});

test("Ukrainian and Polish too; a language without data is never judged", () => {
  expect(genderMarked(["Ти вже знайшов відповідь."], "uk")).toBeString();
  expect(genderMarked(["Ти готовий?"], "uk")).toBeString();
  expect(genderMarked(["У тебе вийшло."], "uk")).toBeUndefined();
  expect(genderMarked(["Znalazłeś odpowiedź."], "pl")).toBeString();
  expect(genderMarked(["Czy jesteś gotowy?"], "pl")).toBeString();
  expect(genderMarked(["Chciałbym kawę."], "pl")).toBeString();
  expect(genderMarked(["Udało ci się."], "pl")).toBeUndefined();
  expect(genderMarked(["Tu es prêt ?"], "en")).toBeUndefined();
  expect(genderProblem(["Ты решил."], "ru")).toBe(
    '"Ты решил" marks the learner\'s gender, which is unknown: rebuild the sentence without it',
  );
});

// The learner's gender in a reply (07): the words that mark it found by the learner's language — the
// phrasings models write, and those that only look alike.
import { expect, test } from "bun:test";
import { genderFree, genderMarked, genderProblem } from "../src/tasks/gender.ts";
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
  expect(genderProblem(["Il est prêt."], "fr")).toBeUndefined();
});

test("asked again, the model is told how to rewrite keeping who is meant and the cases (a real reply lost «тебе»)", () => {
  const problem = genderProblem(["Есть что-то ещё, что ты хотел бы мне рассказать?"], "ru");
  expect(problem).toStartWith('"ты хотел" marks the learner\'s gender, which is unknown: ');
  for (const part of [
    '"ты хотел бы X" → "тебе хотелось бы X"',
    '"тебе", "мне" and "ты" stay',
    "reread the whole sentence",
  ])
    expect(problem).toContain(part);
  expect(genderProblem(["Ти вже знайшов відповідь."], "uk")).toContain("тобі хотілося б");
  expect(genderProblem(["Znalazłeś odpowiedź."], "pl")).toContain("udało ci się znaleźć");
});

test("«would like to» with an infinitive is made gender-free in code, the person and every other word kept", () => {
  for (const [said, made] of [
    // The real reply's line, before the model rewrote it without «тебе».
    [
      "Хорошо! Есть что-то ещё, что ты хотел бы мне рассказать?",
      "Хорошо! Есть что-то ещё, что тебе хотелось бы мне рассказать?",
    ],
    ["Что бы ты хотел узнать о практике?", "Что бы тебе хотелось узнать о практике?"],
    ["Хотела бы ты пойти в кино?", "Хотелось бы тебе пойти в кино?"],
    ["Ты бы хотел поехать?", "Тебе бы хотелось поехать?"],
    [
      "Можно сказать: «Я хотел бы заказать кофе».",
      "Можно сказать: «Мне хотелось бы заказать кофе».",
    ],
    ["Ти хотів би знайти житло?", "Тобі хотілося би знайти житло?"],
  ])
    expect(genderFree(said as string, said?.startsWith("Ти") ? "uk" : "ru")).toBe(made as string);
  // No infinitive after it, another person, another language: left as written (to the model).
  for (const text of [
    "Ты хотел бы кофе?",
    "Ты хотел бы, чтобы он пришёл?",
    "Он хотел бы пойти.",
    "Она хотела бы пойти.",
  ])
    expect(genderFree(text, "ru")).toBe(text);
  expect(genderFree("Ты хотел бы пойти?", "de")).toBe("Ты хотел бы пойти?");
  // A reply's every string, before its quality is judged: nothing left to ask again for.
  const task = writingTaskTask({
    language: "ru",
    target: "de",
    lesson: { title: "Schule", goals: [], grammarHtml: [], vocab: [] },
  });
  const reply = task.fix?.({
    situation: "Друг спрашивает, что ты хотел бы изменить в школе.",
    points: ["Напиши, что ты хотела бы изменить.", "Объясни почему.", "Предложи встречу."],
  });
  expect(reply?.situation).toBe("Друг спрашивает, что тебе хотелось бы изменить в школе.");
  expect(reply && task.quality?.(reply)).toBeUndefined();
});

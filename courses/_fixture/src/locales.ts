// Learner-language texts of the fixture course in two editions: ru-de and en-de.
import {
  type EditionId,
  type ExerciseKey,
  examSectionKey,
  exerciseKey,
  type LessonKey,
  type LocaleCourse,
  type LocaleExam,
  type LocaleLesson,
  lessonGoalKey,
  vocabKey,
} from "@sprachanker/schema";
import { CAFE, COURSE, EXAM, examItems, SPEAKING, UNIT } from "./course.ts";

type Text = { ru: string; en: string };
type Lang = keyof Text;
export const EDITIONS: Record<Lang, EditionId> = { ru: "ru-de", en: "en-de" };

/** Locale exercise entries: title, instruction and per-item texts in both languages. */
type ExerciseText = {
  title: Text;
  instruction: Text;
  items?: Record<string, { prompt?: Text; hint?: Text; alt?: Record<string, Text> }>;
};

function localeExercises(lesson: LessonKey, texts: ExerciseText[], lang: Lang, sourceBase: number) {
  const entries = texts.map((text, i): [ExerciseKey, LocaleLesson["exercises"][ExerciseKey]] => [
    exerciseKey(lesson, i + 1),
    {
      sourceId: String(sourceBase + i + 1),
      title: text.title[lang],
      instructionHtml: `<p>${text.instruction[lang]}</p>`,
      items: Object.fromEntries(
        Object.entries(text.items ?? {}).map(([ref, item]) => [
          ref,
          {
            ...(item.prompt ? { prompt: item.prompt[lang] } : {}),
            ...(item.hint ? { hintHtml: `<p>${item.hint[lang]}</p>` } : {}),
            ...(item.alt
              ? {
                  alt: Object.fromEntries(
                    Object.entries(item.alt).map(([id, alt]) => [id, alt[lang]]),
                  ),
                }
              : {}),
          },
        ]),
      ),
    },
  ]);
  return Object.fromEntries(entries);
}

const CAFE_EXERCISES: ExerciseText[] = [
  {
    title: { ru: "Лена в кафе", en: "Lena at the café" },
    instruction: { ru: "Посмотри видео и выбери ответ.", en: "Watch the video and choose." },
    items: {
      "#2": {
        prompt: { ru: "Кто заказывает?", en: "Who is ordering?" },
        alt: {
          a: { ru: "Женщина с книгой", en: "A woman with a book" },
          b: { ru: "Мужчина в кепке", en: "A man in a cap" },
        },
      },
    },
  },
  {
    title: { ru: "Заказ Тома", en: "Tom's order" },
    instruction: {
      ru: "Послушай и выбери всё, что верно.",
      en: "Listen and choose all that apply.",
    },
  },
  {
    title: { ru: "Что это?", en: "What is it?" },
    instruction: { ru: "Соедини слова и картинки.", en: "Match the words and pictures." },
    items: {
      "#1": { hint: { ru: "Учи слова с артиклем.", en: "Learn nouns with their article." } },
    },
  },
  {
    title: { ru: "Порядок слов", en: "Word order" },
    instruction: { ru: "Расставь слова по порядку.", en: "Put the words in order." },
  },
  {
    title: { ru: "Буквы", en: "Letters" },
    instruction: { ru: "Составь слово из букв.", en: "Make a word from the letters." },
  },
  {
    title: { ru: "Herr или Frau?", en: "Herr or Frau?" },
    instruction: { ru: "Выбери правильное обращение.", en: "Choose the right form of address." },
  },
  {
    title: { ru: "Представься", en: "Introduce yourself" },
    instruction: { ru: "Вставь слова из списка.", en: "Fill in the words from the list." },
  },
  {
    title: { ru: "Заказ", en: "Ordering" },
    instruction: { ru: "Послушай и впиши слово.", en: "Listen and write the word." },
  },
];

const SPEAKING_EXERCISES: ExerciseText[] = [
  {
    title: { ru: "Диктант", en: "Dictation" },
    instruction: { ru: "Напиши, что ты слышишь.", en: "Write what you hear." },
    items: { "#1": { prompt: { ru: "Прослушать аудио", en: "Play the audio" } } },
  },
  {
    title: { ru: "Повтори", en: "Repeat" },
    instruction: { ru: "Послушай и повтори. Оцени себя.", en: "Listen and repeat. Rate yourself." },
    items: { "#2": { prompt: { ru: "Поздоровайся с соседом.", en: "Greet your neighbour." } } },
  },
  {
    title: { ru: "Вежливый вопрос", en: "A polite question" },
    instruction: { ru: "Послушай и повтори.", en: "Listen and repeat." },
  },
  {
    title: { ru: "Твой заказ", en: "Your order" },
    instruction: { ru: "Напиши по-немецки.", en: "Write it in German." },
    items: {
      "#1": {
        prompt: { ru: "Закажи напиток в кафе.", en: "Order a drink in a café." },
        hint: { ru: "Будь вежлив.", en: "Be polite." },
      },
    },
  },
  {
    title: { ru: "В кафе", en: "At the café" },
    instruction: { ru: "Поговори с официантом.", en: "Talk to the waiter." },
  },
  {
    title: { ru: "Неизвестное упражнение", en: "Unknown exercise" },
    instruction: { ru: "Этот тип пока не поддерживается.", en: "This type is not supported yet." },
  },
];

const VOCAB: Array<[LessonKey, string, Text]> = [
  [CAFE, "Kaffee", { ru: "кофе", en: "coffee" }],
  [CAFE, "Tasse", { ru: "чашка", en: "cup" }],
  [CAFE, "bestellen", { ru: "заказывать", en: "to order" }],
  [CAFE, "gern", { ru: "охотно, с удовольствием", en: "gladly, like to" }],
  [SPEAKING, "Guten Tag", { ru: "Добрый день.", en: "Good day. / Hello." }],
  [SPEAKING, "Leute", { ru: "люди", en: "people" }],
];

const vocabOf = (lesson: LessonKey, lang: Lang) =>
  Object.fromEntries(
    VOCAB.filter(([l]) => l === lesson).map(([l, lemma, text]) => [
      vocabKey(l, lemma),
      { translation: text[lang] },
    ]),
  );

export function localeCourse(lang: Lang): LocaleCourse {
  return {
    format: 1,
    edition: EDITIONS[lang],
    course: COURSE,
    sourceId: lang === "ru" ? "9001" : "8001",
    title: { ru: "Демо-курс", en: "Demo course" }[lang],
    descriptionHtml: `<p>${{ ru: "Выдуманный курс для тестов.", en: "An invented course for tests." }[lang]}</p>`,
    units: { [UNIT]: { title: { ru: "В кафе", en: "At the café" }[lang] } },
    goals: {
      [lessonGoalKey(CAFE, 1)]: { text: { ru: "заказать напиток", en: "order a drink" }[lang] },
      [lessonGoalKey(SPEAKING, 1)]: {
        text: { ru: "вежливо поздороваться", en: "greet someone politely" }[lang],
      },
    },
  };
}

export function localeLessons(lang: Lang): LocaleLesson[] {
  const base = lang === "ru" ? 9100 : 8100;
  return [
    {
      format: 1,
      edition: EDITIONS[lang],
      lesson: CAFE,
      sourceId: String(base),
      title: "Im Café",
      synopsisHtml: `<p>${{ ru: "Лена и Том заказывают кофе.", en: "Lena and Tom order coffee." }[lang]}</p>`,
      exercises: localeExercises(CAFE, CAFE_EXERCISES, lang, base),
      vocab: vocabOf(CAFE, lang),
      tabs: {
        grammar: [
          {
            sourceId: String(base + 50),
            title: { ru: "Артикли", en: "Articles" }[lang],
            bodyHtml: "<p><em>der</em> Kaffee, <em>die</em> Tasse</p>",
          },
        ],
        culture: [
          {
            sourceId: String(base + 60),
            title: { ru: "Кафе в Германии", en: "Cafés in Germany" }[lang],
            bodyHtml: `<p>${{ ru: "Кофе с пирожным — традиция.", en: "Coffee and cake is a tradition." }[lang]}</p>`,
          },
        ],
        script: { title: "Skript", bodyHtml: "<p>Lena: Einen Kaffee, bitte.</p>" },
      },
    },
    {
      format: 1,
      edition: EDITIONS[lang],
      lesson: SPEAKING,
      sourceId: String(base + 1),
      title: "Sprechen",
      exercises: localeExercises(SPEAKING, SPEAKING_EXERCISES, lang, base + 200),
      vocab: vocabOf(SPEAKING, lang),
      tabs: { grammar: [], culture: [] },
    },
  ];
}

export function localeExam(lang: Lang): LocaleExam {
  return {
    format: 1,
    edition: EDITIONS[lang],
    exam: EXAM,
    title: { ru: "Мини-тест", en: "Mini test" }[lang],
    sections: {
      [examSectionKey(EXAM, "general")]: { title: { ru: "Общие вопросы", en: "General" }[lang] },
      [examSectionKey(EXAM, "state")]: { title: { ru: "Твоя земля", en: "Your state" }[lang] },
    },
    thresholds: {
      pass: { title: { ru: "Сдано", en: "Passed" }[lang] },
      excellent: { title: { ru: "Отлично", en: "Excellent" }[lang] },
    },
    items: Object.fromEntries(examItems.map((item) => [item.key, {}])),
  };
}

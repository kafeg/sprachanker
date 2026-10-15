// Synthetic pages shaped like the site's (invented names and sentences); no real content.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKeyMap } from "@sprachanker/course-kit";
import { nodeFs } from "@sprachanker/course-kit/node";
import {
  type CourseIndex,
  type Lesson,
  LessonKey,
  LexemeKey,
  type LocaleCourse,
  type LocaleLesson,
  type MediaIndex,
  VocabKey,
} from "@sprachanker/schema";
import { normaliseCourse } from "../src/normalise/course.ts";
import { audioUrl, hdUrl, sdUrl } from "../src/normalise/media.ts";
import { type FetchedCourse, type FetchedLesson, mediaRefs } from "../src/normalise/plan.ts";
import { groupUnits } from "../src/normalise/units.ts";
import { boldWords, headword } from "../src/normalise/vocab.ts";
import {
  mediaUrl,
  parseDocPage,
  parseLanding,
  parseLesson,
  parseQuizPage,
  type QuizQuestion,
} from "../src/parse.ts";

const CDN = "https://video.example/v";
const AUDIO = "https://audio.example/a";

const sources = (base: string, labels: [string, string][]) =>
  JSON.stringify(
    labels.map(([info, suffix]) => ({ Src: `${base}${suffix}.mp4?cb=1`, DataInfo: info })),
  ).replace(/"/g, "&quot;");

const videoPlayer = (id: string, title: string, base: string) => `
<div class="media-pholder media-pholder--video ">
  <div class="c-mmp" data-title="${title}" data-media-id="${id}">
    <div class="c-mmp__player">
      <video src="${base}_hq.mp4?cb=1" data-info="Auto" data-sources="${sources(base, [
        ["270p", "_mobile"],
        ["360p", ""],
        ["720p", "_hq"],
        ["1080p", "_fullhd"],
      ])}"></video>
    </div>
  </div>
  <div class="media-download"><ul class="subitems">
    <li class="subitem"><a href="${base}_mobile.mp4?cb=1&amp;download=1" title="270p | 1.0MB">270p | 1.0MB</a></li>
  </ul></div>
</div>`;

const audioPlayer = (title: string, base: string) => `
<div class="media-pholder media-pholder--audio ">
  <div class="c-mmp" data-title="${title}">
    <audio src="${base}.mp3" data-info="64 kbps" data-sources=""></audio>
  </div>
  <div class="media-download"><ul class="subitems">
    <li class="subitem"><a href="${base}_hq.mp3?download=1" title="128 kbps | MP3">128 kbps | MP3</a></li>
    <li class="subitem"><a href="${base}.mp3?download=1" title="64 kbps | MP3">64 kbps | MP3</a></li>
  </ul></div>
</div>`;

const LESSON = `<html><head>
<meta name="description" content="This week, Kim visits a &quot;new&quot; market." />
</head><body>
<h1 class="title pg-title">Lesson 3: At the Market</h1>
${videoPlayer("900", "Lesson 3 main", `${CDN}/main`)}
<div id="article-content"><div class="wsw">
<h2 class="wsw__h2">Download Lesson 3</h2>
<div class="wsw__embed"><div class="media-block">
  <a href="/a/lesson-3-plan/700.html"><div class="img-wrap"><span class="ico ico-document"></span></div></a>
  <span class="caption">Lesson 3 plan</span>
</div></div>
<h2 class="wsw__h2">Speaking Practice</h2>
<div class="wsw__embed">${videoPlayer("901", "Lesson 3 Speaking Practice", `${CDN}/speak`)}</div>
<h2 class="wsw__h2">Conversation</h2>
<div class="wsw__embed">${audioPlayer("Lesson 3 conversation", `${AUDIO}/talk`)}</div>
<div>Kim: I want some <strong>apples</strong>, please.</div>
<div>Lou: Here you are. They are <strong>fresh</strong>.</div>
<div>Kim: Thank you, <strong>Lou</strong><strong>ie</strong>! I <strong>pay in cash</strong>.</div>
<div><strong>The Market Map</strong></div>
<h2 class="wsw__h2"> </h2>
<h2 class="wsw__h2">Listening Quiz</h2>
<p>Play each video, then choose the best answer.</p>
<div class="wsw__embed"><div class="quiz quiz--embedded">
  <h2>Quiz - Lesson 3</h2>
  <a class="btn" data-ajax-url="/Quiz/Start?id=555&amp;page=1&amp;isEmbedded=True">Start Quiz</a>
</div></div>
<h2 class="wsw__h2">Free Materials</h2>
<div class="wsw__embed wsw__embed--small"><a href="http://docs.example/word.pdf"><img src="x.png"></a>
<span class="caption">Word Book</span></div>
<h2 class="wsw__h2">For Teachers</h2>
<p><a href="mailto:x@example.org">Send us an email</a> if you have comments.
Be sure to <a href="https://docs.example/plan-3.pdf">download the lesson plan.</a></p>
<h2 class="wsw__h2">Comments</h2>
</div></div>
<div class="footer-toolbar"></div>
</body></html>`;

const REVIEW = `<html><body><h1 class="title">Review of Lessons 1 - 3</h1>
<div class="wsw">
<h2 class="wsw__h2">Review of Lessons 1 -- 3</h2>
<p><a href="/a/1.html">Lesson 1: Hi</a></p>
<p><strong>Grammar focus: </strong>Simple present</p>
<h4 class="sub">Questions</h4>
<p>Do you like apples?</p>
<h2 class="wsw__h2">Fun Video</h2>
<div class="wsw__embed">${videoPlayer("902", "Extra", `${CDN}/extra`)}</div>
</div></body></html>`;

const quizPage = (k: number, total: number, correct: number) => `
<div class="quiz__body"><span class="caption">Question ${k} / ${total}</span>
<h2 class="ta-l quiz__question-title">What does Kim buy (${k})?</h2>
<div class="quiz__answers-img">${videoPlayer(`95${k}`, `Q${k}`, `${CDN}/q${k}`)}</div>
<form method="POST" action="/Quiz/Answer"><ul class="quiz__answers fl-r">
${["Apples", "Pears", "Bread"]
  .map(
    (
      text,
      i,
    ) => `<li class="quiz__answers-item ta-l quiz__answers-item--result quiz__answers-item--${
      i === correct ? "correct" : "false"
    }">
  <label><input type="radio" name="SelectedAnswerId" value="${40 + i}" id="answer_${40 + i}" disabled="disabled" />
  <span class="quiz__answers-item-text">${text}</span></label></li>`,
  )
  .join("\n")}
</ul></form></div>`;

const LANDING_1 = `
<a href="/a/lesson-1/1.html"><img></a><a href="/a/lesson-1/1.html">Lesson 1: Hi</a>
<a href="/a/lesson-2/2.html">Lesson 2: Hello</a>
<a href="/a/lesson-3/3.html">Lesson 3: At the Market</a>
<a href="/a/guide/10.html">How-to Guide</a>
<a href="/a/10.html">Lessons 1 - 2</a><a href="/a/11.html">Lessons 3 - 3</a>`;

const LANDING_2 = `
<a href="https://learningenglish.voanews.com/a/l1/1.html">Lesson 1: Hi</a>
<a href="/a/l2/2.html">Lesson 2: Hello</a>
<a href="/a/r/3.html">Review of Level 2 Lessons 1 - 2</a>
<a href="/a/l3/4.html">Lesson 3: At the Market</a>`;

test("landing: lessons in order, groups, other links skipped", () => {
  const l = parseLanding(LANDING_1);
  expect(l.lessons.map((x) => [x.id, x.title])).toEqual([
    ["1", "Lesson 1: Hi"],
    ["2", "Lesson 2: Hello"],
    ["3", "Lesson 3: At the Market"],
  ]);
  expect(l.lessons[0]?.url).toBe("https://learningenglish.voanews.com/a/lesson-1/1.html");
  expect(l.ranges).toEqual([
    [1, 2],
    [3, 3],
  ]);
});

test("units: by the landing's ranges, else closed by reviews", () => {
  const byRange = parseLanding(LANDING_1);
  expect(
    groupUnits(
      byRange.lessons.map((source) => ({ source })),
      byRange.ranges,
    ).map((g) => [g.title, g.lessons.length]),
  ).toEqual([
    ["Lessons 1–2", 2],
    ["Lessons 3–3", 1],
  ]);
  const byReview = parseLanding(LANDING_2);
  expect(
    groupUnits(
      byReview.lessons.map((source) => ({ source })),
      byReview.ranges,
    ).map((g) => [g.title, g.lessons.length]),
  ).toEqual([
    ["Lessons 1–2", 3],
    ["Lessons 3–3", 1],
  ]);
});

test("lesson page: main video, sections, players, quiz and documents", () => {
  const page = parseLesson(LESSON);
  expect(page.title).toBe("Lesson 3: At the Market");
  expect(page.summary).toBe('This week, Kim visits a "new" market.');
  expect(page.video?.id).toBe("900");
  expect(sdUrl(page.video)).toBe(`${CDN}/main.mp4?cb=1`);
  expect(hdUrl(page.video)).toBe(`${CDN}/main_hq.mp4?cb=1`);
  expect(page.sections.map((s) => s.heading)).toEqual([
    "Download Lesson 3",
    "Speaking Practice",
    "Conversation",
    "Listening Quiz",
    "Free Materials",
    "For Teachers",
    "Comments",
  ]);
  const [download, speaking, conversation, quiz, free, teachers] = page.sections;
  expect(download?.docs).toEqual([
    {
      id: "700",
      url: "https://learningenglish.voanews.com/a/lesson-3-plan/700.html",
      caption: "Lesson 3 plan",
    },
  ]);
  expect(speaking?.players[0]?.title).toBe("Lesson 3 Speaking Practice");
  expect(audioUrl(conversation?.players[0])).toBe(`${AUDIO}/talk.mp3`);
  expect(quiz?.quizzes).toEqual([{ id: "555", title: "Quiz - Lesson 3" }]);
  expect(free?.pdfs).toEqual([{ url: "http://docs.example/word.pdf", text: "Word Book" }]);
  expect(teachers?.pdfs.map((p) => p.text)).toEqual(["download the lesson plan."]);
});

test("media URLs lose the download flag only", () => {
  expect(mediaUrl("https://x.example/a.mp4?cb=1&amp;download=1")).toBe(
    "https://x.example/a.mp4?cb=1",
  );
  expect(mediaUrl("https://x.example/a.mp3?download=1")).toBe("https://x.example/a.mp3");
  expect(mediaUrl("https://x.example/a.mp4?download=1&cb=2")).toBe("https://x.example/a.mp4?cb=2");
});

test("document page: its PDF; quiz result page: question with the answer marked", () => {
  expect(
    parseDocPage(`<a href="https://docs.example/w.pdf">Word Book</a>
      <a href="https://docs.example/p.pdf" class="handler" download="download">1MB | PDF</a>`),
  ).toBe("https://docs.example/p.pdf");
  const q = parseQuizPage(quizPage(2, 3, 1));
  expect(q && { ...q, video: undefined }).toEqual({
    index: 2,
    total: 3,
    question: "What does Kim buy (2)?",
    multiple: false,
    video: undefined,
    options: [
      { id: "40", text: "Apples", correct: false },
      { id: "41", text: "Pears", correct: true },
      { id: "42", text: "Bread", correct: false },
    ],
  });
  expect(sdUrl(q?.video)).toBe(`${CDN}/q2.mp4?cb=1`);
  expect(parseQuizPage("<div>results</div>")).toBeUndefined();
});

test("new words: bold in the transcript, split tags joined, sub-headings skipped", () => {
  expect(boldWords(parseLesson(LESSON).sections[2]?.html ?? "")).toEqual([
    "apples",
    "fresh",
    "Louie",
    "pay in cash",
  ]);
  expect(
    boldWords("<p><strong>Kim:</strong> a <b>to go</b> and <b>go</b>, <b>Go!</b></p>"),
  ).toEqual(["to go", "go"]);
});

test("inflected duplicates go when the base form is a new word too", () => {
  expect(
    boldWords(
      "<p>A <b>watch</b>, <b>watching</b>, <b>dance</b>, <b>danced</b>, <b>stop</b>, <b>stopped</b>, <b>city</b>, <b>cities</b>, <b>news</b>, <b>pay in cash</b>, <b>pay in cashes</b>.</p>",
    ),
  ).toEqual(["watch", "dance", "stop", "city", "news", "pay in cash", "pay in cashes"]);
});

test.each([
  ["apples", { lemma: "apples", pos: "word" }],
  ["to buy", { lemma: "buy", pos: "verb" }],
  ["pay in cash", { lemma: "pay in cash", pos: "phrase" }],
])("headword %p", (text, expected) => {
  expect(headword(text)).toEqual(expected as ReturnType<typeof headword>);
});

/** A series' key map of its own (a folder nobody else writes). */
const keyMap = () => openKeyMap(nodeFs, mkdtempSync(join(tmpdir(), "voa-keys-")));

function course(): FetchedCourse {
  const landing = parseLanding(LANDING_2);
  const lesson = parseLesson(LESSON);
  const review = parseLesson(REVIEW);
  const page = (id: string) => (id === "3" ? review : lesson);
  return {
    def: { id: "level-2", title: "Level 2", landing: "/p/6765.html", approxBytes: 1 },
    sourceId: "6765",
    landing,
    lessons: landing.lessons.map(
      (source): FetchedLesson => ({
        source,
        raw: `raw/en-en/level-2/a-${source.id}.html`,
        page: page(source.id),
        docPdfs: { "700": "https://docs.example/plan-3-doc.pdf" },
        // Lesson 2 has no quiz pages (e.g. the site removed them).
        quizzes:
          source.id === "2"
            ? {}
            : { "555": [1, 2].map((k) => parseQuizPage(quizPage(k, 2, k - 1)) as QuizQuestion) },
      }),
    ),
  };
}

const index: MediaIndex = Object.fromEntries(
  mediaRefs(course()).map((r) => [
    r.url,
    { kind: r.kind, path: `media/${r.kind}/${r.name}`, sha256: "0".repeat(64), size: 1, mime: "x" },
  ]),
);

test("media: one small and one 720p main video, 64 kbps audio, practice and quiz clips, PDFs", () => {
  const urls = mediaRefs(course()).map((r) => `${r.kind} ${r.url}`);
  expect(urls).toEqual([
    `video ${CDN}/main.mp4?cb=1`,
    `video ${CDN}/main_hq.mp4?cb=1`,
    `audio ${AUDIO}/talk.mp3`,
    `video ${CDN}/speak.mp4?cb=1`,
    `video ${CDN}/q1.mp4?cb=1`,
    `video ${CDN}/q2.mp4?cb=1`,
    "pdf https://docs.example/plan-3-doc.pdf",
    "pdf https://docs.example/plan-3.pdf",
  ]);
});

test("normalisation: valid files, keys, exercises with answers, vocabulary, tabs", async () => {
  const result = normaliseCourse(course(), index, await keyMap());
  for (const file of result.files) {
    const parsed = file.schema.safeParse(file.value);
    if (!parsed.success) throw new Error(`${file.path}: ${parsed.error.message}`);
  }
  expect(result.lessons).toBe(4);
  expect(result.unknown).toBe(1);
  const byPath = (p: string) => result.files.find((f) => f.path === p)?.value;
  const index_ = byPath("canonical/level-2/course.json") as CourseIndex;
  expect(index_.units.map((u) => [u.key as string, u.lessons as string[]])).toEqual([
    [
      "voa.lets-learn-english/level-2/u01",
      [
        "voa.lets-learn-english/level-2/01-01",
        "voa.lets-learn-english/level-2/01-02",
        "voa.lets-learn-english/level-2/01-03",
      ],
    ],
    ["voa.lets-learn-english/level-2/u02", ["voa.lets-learn-english/level-2/02-01"]],
  ]);
  const localeCourse = byPath("locale/en-en/level-2/course.json") as LocaleCourse;
  expect(localeCourse.descriptionHtml).toContain("public domain");
  expect(Object.values(localeCourse.units).map((u) => u.title)).toEqual([
    "Lessons 1–2",
    "Lessons 3–3",
  ]);

  const lesson = byPath("canonical/level-2/lessons/01-01.json") as Lesson;
  expect(LessonKey.safeParse(lesson.key).success).toBe(true);
  expect(lesson.media).toEqual({
    video: { sd: "media/video/main.mp4", hd: "media/video/main_hq.mp4" },
    audio: "media/audio/talk.mp3",
  });
  const [speech, quiz] = lesson.pages.map((p) => p.exercise);
  expect(speech?.type).toBe("speech_selfrate");
  expect(speech?.media).toBeUndefined();
  expect(speech?.items[0]?.media).toEqual({ video: "media/video/speak.mp4" });
  expect(quiz?.type).toBe("single_choice");
  expect(quiz?.key as string).toBe("voa.lets-learn-english/level-2/01-01/ex-02");
  if (quiz?.type !== "single_choice") throw new Error("quiz type");
  expect(quiz.items.map((i) => [i.key, i.prompt, i.answer.optionIds, i.media?.video])).toEqual([
    [
      "voa.lets-learn-english/level-2/01-01/ex-02#1",
      "What does Kim buy (1)?",
      ["a"],
      "media/video/q1.mp4",
    ],
    [
      "voa.lets-learn-english/level-2/01-01/ex-02#2",
      "What does Kim buy (2)?",
      ["b"],
      "media/video/q2.mp4",
    ],
  ]);
  expect(quiz.items[0]?.options.map((o) => o.text)).toEqual(["Apples", "Pears", "Bread"]);
  expect(lesson.vocab.map((v) => [v.key, v.lexeme, v.target])).toEqual([
    ["voa.lets-learn-english/level-2/01-01/v-apples", "lex:en:apples:word", "apples"],
    ["voa.lets-learn-english/level-2/01-01/v-fresh", "lex:en:fresh:word", "fresh"],
    ["voa.lets-learn-english/level-2/01-01/v-louie", "lex:en:louie:word", "Louie"],
    [
      "voa.lets-learn-english/level-2/01-01/v-pay-in-cash",
      "lex:en:pay-in-cash:phrase",
      "pay in cash",
    ],
  ]);
  for (const v of lesson.vocab) {
    expect(VocabKey.safeParse(v.key).success && LexemeKey.safeParse(v.lexeme).success).toBe(true);
  }

  const locale = byPath("locale/en-en/level-2/lessons/01-01.json") as LocaleLesson;
  expect(locale.title).toBe("Lesson 3: At the Market");
  expect(locale.synopsisHtml).toBe('<p>This week, Kim visits a "new" market.</p>');
  expect(locale.tabs.script?.bodyHtml).toContain(
    "<p>Kim: I want some <strong>apples</strong>, please.</p>",
  );
  expect(locale.exercises[quiz.key]).toEqual({
    sourceId: "555",
    title: "Quiz - Lesson 3",
    instructionHtml: "<p>Play each video, then choose the best answer.</p>",
    items: {},
  });
  // The Word Book (site-wide) is not a lesson download; the comments boilerplate is dropped.
  expect(locale.downloads).toEqual([
    { title: "Lesson 3 plan", path: "media/pdf/plan-3-doc.pdf" },
    { title: "Lesson plan", path: "media/pdf/plan-3.pdf" },
  ]);
  expect(locale.tabs.culture).toEqual([]);

  // Lesson 2: quiz pages missing → unknown with the raw page and a reason.
  const second = byPath("canonical/level-2/lessons/01-02.json") as Lesson;
  const unknown = second.pages[1]?.exercise;
  expect(unknown?.type).toBe("unknown");
  if (unknown?.type !== "unknown") throw new Error("unknown type");
  expect(unknown.items[0]).toMatchObject({
    raw: "raw/en-en/level-2/a-2.html",
    reason: "quiz pages not available",
  });

  // The review: summary as a grammar page, the extra video reported as unmapped.
  const review = byPath("canonical/level-2/lessons/01-03.json") as Lesson;
  expect(review.media).toEqual({});
  expect(review.unmapped).toEqual([
    {
      path: "raw/en-en/level-2/a-3.html",
      reason: 'section "Fun Video": video "Extra" not imported (lessons have one video)',
    },
  ]);
  const reviewLocale = byPath("locale/en-en/level-2/lessons/01-03.json") as LocaleLesson;
  expect(reviewLocale.tabs.grammar.map((t) => t.title)).toEqual(["Review of Lessons 1 -- 3"]);
  expect(reviewLocale.tabs.grammar[0]?.bodyHtml).toContain(
    "<strong>Grammar focus: </strong>Simple present",
  );
  // A sub-heading titles a section of the page, as in every course.
  expect(reviewLocale.tabs.grammar[0]?.bodyHtml).toContain("<h3>Questions</h3>");
});

test("normalisation is deterministic", async () => {
  const once = async () =>
    JSON.stringify(normaliseCourse(course(), index, await keyMap()).files.map((f) => f.value));
  expect(await once()).toBe(await once());
});

test("keys stay by source id: a lesson the source inserts moves no other key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voa-keys-"));
  const run = async (fetched: FetchedCourse) => {
    const keys = await openKeyMap(nodeFs, dir);
    const { files } = normaliseCourse(fetched, index, keys);
    await keys.save();
    // Each lesson's source id with its key and its exercises' keys.
    return Object.fromEntries(
      files
        .filter((f) => f.path.startsWith("locale/en-en/level-2/lessons/"))
        .map((f) => {
          const locale = f.value as LocaleLesson;
          return [locale.sourceId, Object.keys(locale.exercises).sort()];
        }),
    );
  };
  const before = await run(course());
  const inserted = course();
  const first = inserted.lessons[0] as FetchedLesson;
  inserted.lessons.unshift({ ...first, source: { ...first.source, id: "99" } });
  const after = await run(inserted);
  for (const [id, keys] of Object.entries(before)) expect(after[id]).toEqual(keys);
  expect(Object.keys(after)).toContain("99");
});

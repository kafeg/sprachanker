// What each section of a lesson article becomes (videos, audio, exercises, tabs, downloads, words),
// and the media files a course needs for it.
import { type MediaRef, plainText, sanitizeCourseHtml, urlFileName } from "@sprachanker/course-kit";
import type { CourseDef } from "../catalog.ts";
import type { Landing, LandingLesson, LessonPage, QuizEmbed, QuizQuestion } from "../parse.ts";
import { audioUrl, hdUrl, sdUrl } from "./media.ts";
import { boldWords } from "./vocab.ts";

/** A lesson as fetched: its landing entry, raw page path, parsed page, document PDFs and quiz pages. */
export interface FetchedLesson {
  source: LandingLesson;
  /** Raw page, relative to the series folder. */
  raw: string;
  page: LessonPage;
  /** PDF of each embedded document article, by its id (undefined: page without a PDF). */
  docPdfs: Record<string, string | undefined>;
  /** Questions of each quiz, by quiz id, in order (empty: quiz pages not available). */
  quizzes: Record<string, QuizQuestion[]>;
}

export interface FetchedCourse {
  def: CourseDef;
  /** Source id of the landing page. */
  sourceId: string;
  landing: Landing;
  lessons: FetchedLesson[];
}

export interface SpeechPlan {
  kind: "speech";
  sourceId: string;
  title: string;
  instructionHtml: string;
  video?: string;
}

export interface QuizPlan {
  kind: "quiz";
  embed: QuizEmbed;
  title: string;
  instructionHtml: string;
  questions: QuizQuestion[];
}

export interface LessonPlan {
  video: { sd?: string; hd?: string };
  audio?: string;
  exercises: (SpeechPlan | QuizPlan)[];
  script?: { title: string; bodyHtml: string };
  grammar: { title: string; bodyHtml: string }[];
  culture: { title: string; bodyHtml: string }[];
  downloads: { title: string; url: string }[];
  words: string[];
  unmapped: string[];
}

/** Course HTML of a section's text: "write to us" paragraphs dropped, lines kept, no links or images. */
function courseHtml(html: string): string {
  const cleaned = html
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?mailto:(?:(?!<\/p>)[\s\S])*<\/p>/gi, "")
    .replace(/<p\b[^>]*>[\s_ ]*<\/p>/gi, "")
    .replace(/<h[3-6]\b[^>]*>/gi, "<p><strong>")
    .replace(/<\/h[3-6]>/gi, "</strong></p>")
    .replace(/<div\b[^>]*>/gi, "<p>")
    .replace(/<\/div>/gi, "</p>");
  const out = sanitizeCourseHtml(cleaned, { image: () => undefined });
  return plainText(out) ? out.replace(/\n\s*\n+/g, "\n") : "";
}

const isWordBook = (text: string) => /word book/i.test(text);

/** What every section of the article becomes (source order); pure, so the import and tests share it. */
export function planLesson(lesson: FetchedLesson): LessonPlan {
  const { page } = lesson;
  const plan: LessonPlan = {
    video: { sd: sdUrl(page.video), hd: hdUrl(page.video) },
    exercises: [],
    grammar: [],
    culture: [],
    downloads: [],
    words: [],
    unmapped: [],
  };
  const download = (title: string, url: string | undefined) => {
    if (url && !plan.downloads.some((d) => d.url.toLowerCase() === url.toLowerCase())) {
      plan.downloads.push({ title, url });
    }
  };
  for (const section of page.sections) {
    const h = section.heading.toLowerCase();
    const text = courseHtml(section.html);
    for (const doc of section.docs) {
      const pdf = lesson.docPdfs[doc.id];
      if (pdf) download(doc.caption || section.heading || page.title, pdf);
      else plan.unmapped.push(`document ${doc.url}: no PDF on its page`);
    }
    for (const link of section.pdfs) {
      if (isWordBook(link.text)) continue; // the site-wide dictionary, not lesson material
      download(
        /lesson plan/i.test(link.text) ? "Lesson plan" : section.heading || link.text,
        link.url,
      );
    }
    if (section.external) {
      plan.unmapped.push(
        `section "${section.heading}": embedded media of another site not imported`,
      );
    }
    // Players: practice videos (under their heading, or titled so anywhere), the conversation audio.
    const practice = /^(speaking|pronunciation)/.test(h);
    const conversation = /^conversation/.test(h);
    for (const player of section.players) {
      if (player.kind === "video" && (practice || /speaking|pronunciation/i.test(player.title))) {
        plan.exercises.push({
          kind: "speech",
          sourceId: player.id || player.title || `${section.heading} video`,
          title: practice ? section.heading : player.title,
          instructionHtml: practice ? text : "",
          video: sdUrl(player),
        });
      } else if (player.kind === "audio" && conversation && !plan.audio && audioUrl(player)) {
        plan.audio = audioUrl(player);
      } else {
        plan.unmapped.push(
          `section "${section.heading}": ${player.kind} "${player.title}" not imported (lessons have one video)`,
        );
      }
    }
    // The quiz may share a section with the conversation (Level 1 has no heading of its own for it).
    for (const embed of section.quizzes) {
      plan.exercises.push({
        kind: "quiz",
        embed,
        title: embed.title || section.heading,
        instructionHtml: conversation ? "" : text,
        questions: lesson.quizzes[embed.id] ?? [],
      });
    }
    if (conversation) {
      if (text) plan.script = { title: section.heading, bodyHtml: text };
      plan.words = boldWords(section.html);
    } else if (/^review of lessons/.test(h)) {
      if (text) plan.grammar.push({ title: section.heading, bodyHtml: text });
    } else if (
      text &&
      !practice &&
      !section.quizzes.length &&
      // Boilerplate around the documents and PDFs taken above.
      !/^(comments|free materials|for teachers|download lesson|certificate)/.test(h)
    ) {
      plan.culture.push({ title: section.heading || page.title, bodyHtml: text });
    }
  }
  return plan;
}

/** Every media file a course needs: lesson videos and audio, practice videos, quiz clips, PDFs. */
export function mediaRefs(course: FetchedCourse): MediaRef[] {
  const refs: MediaRef[] = [];
  const add = (url: string | undefined, kind: MediaRef["kind"]) => {
    if (url && !refs.some((r) => r.url === url))
      refs.push({ url, kind, name: urlFileName(url, { decode: true }) });
  };
  for (const lesson of course.lessons) {
    const plan = planLesson(lesson);
    add(plan.video.sd, "video");
    add(plan.video.hd, "video");
    add(plan.audio, "audio");
    for (const ex of plan.exercises) {
      if (ex.kind === "speech") add(ex.video, "video");
      else for (const q of ex.questions) add(sdUrl(q.video), "video");
    }
    for (const d of plan.downloads) add(d.url, "pdf");
  }
  return refs;
}

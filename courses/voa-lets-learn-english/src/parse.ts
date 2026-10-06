// The site's server-rendered pages → data: landing pages (lesson lists), lesson articles (players, transcript,
// quiz and document embeds), document pages (the PDF) and quiz pages (questions, options, the answer).
import { decodeEntities, plainText } from "@sprachanker/course-kit";
import { SITE } from "./catalog.ts";

export interface Rendition {
  url: string;
  /** As the source labels it: "360p", "64 kbps". */
  label: string;
  height?: number;
  kbps?: number;
}

/** A video or audio player with every rendition it offers. */
export interface Player {
  kind: "video" | "audio";
  /** The source's media id. */
  id?: string;
  title: string;
  renditions: Rendition[];
}

export interface QuizEmbed {
  id: string;
  title: string;
}

/** An embedded document article (`/a/<id>.html`) whose page offers a PDF. */
export interface DocEmbed {
  id: string;
  url: string;
  caption: string;
}

export interface PdfLink {
  url: string;
  text: string;
}

/** Article content under one `<h2>` heading. */
export interface Section {
  heading: string;
  /** HTML left after the embeds are taken out (transcripts, notes). */
  html: string;
  players: Player[];
  quizzes: QuizEmbed[];
  docs: DocEmbed[];
  pdfs: PdfLink[];
  /** Embeds of other sites (not fetched). */
  external: number;
}

export interface LessonPage {
  title: string;
  summary: string;
  /** The lesson's main video above the article. */
  video?: Player;
  sections: Section[];
}

export interface LandingLesson {
  id: string;
  url: string;
  title: string;
}

export interface Landing {
  lessons: LandingLesson[];
  /** The source's lesson groups ("Lessons 1 - 10"), when the landing lists them. */
  ranges: [number, number][];
}

export interface QuizOption {
  id: string;
  text: string;
  correct: boolean;
}

/** One question as the quiz's result page (`page=2k`) shows it, the answer marked. */
export interface QuizQuestion {
  index: number;
  total: number;
  question: string;
  multiple: boolean;
  video?: Player;
  options: QuizOption[];
}

const absolute = (href: string) => new URL(decodeEntities(href), SITE).href;

/** Media URL without the download flag the "Direct link" menu adds. */
export function mediaUrl(href: string): string {
  return absolute(href)
    .replace(/([?&])download=1(&|$)/, (_, sep: string, next: string) => (next ? sep : ""))
    .replace(/[?&]$/, "");
}

/** Index just after the `</div>` closing the `<div` at `start`; -1 when unbalanced. */
export function blockEnd(html: string, start: number): number {
  const tags = /<div\b|<\/div>/gi;
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Cuts out every `<div>` block whose opening tag matches; returns the blocks and the rest. */
function cutBlocks(html: string, opening: RegExp): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = "";
  let from = 0;
  const re = new RegExp(opening.source, "gi");
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const end = blockEnd(html, m.index);
    if (end < 0) break;
    blocks.push(html.slice(m.index, end));
    rest += html.slice(from, m.index);
    from = end;
    re.lastIndex = end;
  }
  return { blocks, rest: rest + html.slice(from) };
}

function rendition(url: string, label: string): Rendition | undefined {
  const height = /^(\d+)p\b/.exec(label)?.[1];
  const kbps = /^(\d+)\s*kbps\b/i.exec(label)?.[1];
  if (!height && !kbps) return undefined;
  return {
    url: mediaUrl(url),
    label: label.split("|")[0]?.trim() ?? label,
    ...(height ? { height: Number(height) } : {}),
    ...(kbps ? { kbps: Number(kbps) } : {}),
  };
}

/** A player block: renditions from its `data-sources`, its "Direct link" menu and its `src`. */
export function parsePlayer(block: string): Player | undefined {
  const tag = /<(video|audio)\b[^>]*>/i.exec(block);
  if (!tag) return undefined;
  const kind = tag[1]?.toLowerCase() === "audio" ? "audio" : "video";
  const found: Rendition[] = [];
  const add = (r: Rendition | undefined) => {
    if (r && !found.some((f) => f.url === r.url)) found.push(r);
  };
  const sources = /data-sources="([^"]+)"/.exec(tag[0])?.[1];
  if (sources) {
    try {
      for (const s of JSON.parse(decodeEntities(sources)) as {
        Src?: string;
        DataInfo?: string;
      }[]) {
        if (s.Src && s.DataInfo) add(rendition(s.Src, s.DataInfo));
      }
    } catch {
      // A malformed list: the menu and `src` still give renditions.
    }
  }
  for (const m of block.matchAll(/<a href="([^"]+)"[^>]*>\s*([^<]*?)\s*<\/a>/g)) {
    add(rendition(m[1] ?? "", plainText(m[2])));
  }
  const src = /\ssrc="([^"]+)"/.exec(tag[0])?.[1];
  const info = /data-info="([^"]+)"/.exec(tag[0])?.[1];
  if (src && info) add(rendition(src, decodeEntities(info)));
  const title = /data-title="([^"]*)"/.exec(block)?.[1] ?? /\stitle="([^"]*)"/.exec(tag[0])?.[1];
  const id = /data-media-id="(\d+)"/.exec(block)?.[1];
  return { kind, ...(id ? { id } : {}), title: plainText(title), renditions: found };
}

function pdfLinks(html: string, fallbackText = ""): PdfLink[] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    url: absolute(m[1] ?? ""),
    text: plainText(m[2]) || fallbackText,
  }));
}

function parseSection(heading: string, html: string): Section {
  const { blocks, rest } = cutBlocks(html, /<div class="(?:wsw__embed|media-pholder)[^"]*"/);
  const section: Section = {
    heading,
    html: rest,
    players: [],
    quizzes: [],
    docs: [],
    pdfs: pdfLinks(rest),
    external: 0,
  };
  for (const block of blocks) {
    const quiz = /\/Quiz\/Start\?id=(\d+)/.exec(block)?.[1];
    const caption = plainText(/<span class="caption">([\s\S]*?)<\/span>/.exec(block)?.[1]);
    if (/<(video|audio)\b/i.test(block)) {
      const player = parsePlayer(block);
      if (player) section.players.push(player);
    } else if (quiz) {
      section.quizzes.push({
        id: quiz,
        title: plainText(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1]),
      });
    } else if (/externalMedia/.test(block)) {
      section.external++;
    } else if (/ico-document/.test(block) && /href="[^"]*\/a\/(?:[^"]*\/)?\d+\.html"/.test(block)) {
      const href = /href="([^"]*\/a\/(?:[^"]*\/)?(\d+)\.html)"/.exec(block);
      section.docs.push({ id: href?.[2] ?? "", url: absolute(href?.[1] ?? ""), caption });
    } else {
      section.pdfs.push(...pdfLinks(block, caption));
    }
  }
  return section;
}

/** A lesson article: title, summary, main video and the article's sections in order. */
export function parseLesson(html: string): LessonPage {
  const title = plainText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]);
  const summary = plainText(
    decodeEntities(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? ""),
  );
  const start = html.indexOf('<div class="wsw">');
  const before = start < 0 ? html : html.slice(0, start);
  const head = cutBlocks(before, /<div class="media-pholder[^"]*"/).blocks.find((b) =>
    /<video\b/i.test(b),
  );
  const video = head ? parsePlayer(head) : undefined;
  const sections: Section[] = [];
  if (start >= 0) {
    const end = blockEnd(html, start);
    const body = html.slice(start + '<div class="wsw">'.length, end < 0 ? undefined : end - 6);
    const parts = body.split(/<h2 class="wsw__h2"[^>]*>([\s\S]*?)<\/h2>/);
    // split() with a capture group: [before, heading1, body1, heading2, body2, …]
    if (plainText(parts[0]) || /wsw__embed/.test(parts[0] ?? "")) {
      sections.push(parseSection("", parts[0] ?? ""));
    }
    for (let i = 1; i < parts.length; i += 2) {
      const heading = plainText(parts[i]).replace(/[​﻿]/g, "").trim();
      const section = parseSection(heading, parts[i + 1] ?? "");
      // Empty headings (`<h2> </h2>`) only space the article.
      if (heading || plainText(section.html) || section.players.length || section.quizzes.length) {
        sections.push(section);
      }
    }
  }
  return { title, summary, ...(video ? { video } : {}), sections };
}

/** The landing page: lesson links in order ("Lesson 12: …", "Review of …") and lesson groups. */
export function parseLanding(html: string): Landing {
  const lessons: LandingLesson[] = [];
  const ranges: [number, number][] = [];
  for (const m of html.matchAll(
    /<a\b[^>]*href="([^"]*\/a\/(?:[^"]*\/)?(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const text = plainText(m[3]);
    const range = /^Lessons (\d+)\s*-+\s*(\d+)$/.exec(text);
    if (range) ranges.push([Number(range[1]), Number(range[2])]);
    else if (/^(Lesson \d+\b|Review of\b)/.test(text) && !lessons.some((l) => l.id === m[2])) {
      lessons.push({ id: m[2] ?? "", url: absolute(m[1] ?? ""), title: text });
    }
  }
  return { lessons, ranges };
}

/** A document article: the PDF it offers for download. */
export function parseDocPage(html: string): string | undefined {
  const href = /<a href="([^"]+\.pdf)"[^>]*\sdownload=/i.exec(html)?.[1];
  return href ? absolute(href) : undefined;
}

/** A quiz result page (`/Quiz/Start?id=…&page=2k`): question k with the correct option marked. */
export function parseQuizPage(html: string): QuizQuestion | undefined {
  const progress = /Question (\d+)\s*\/\s*(\d+)/.exec(html);
  const question = plainText(/quiz__question-title[^>]*>([\s\S]*?)<\/h2>/.exec(html)?.[1]);
  if (!progress || !question) return undefined;
  const options = [
    ...html.matchAll(
      /<li class="quiz__answers-item([^"]*)"[\s\S]*?value="(\d+)"[\s\S]*?quiz__answers-item-text">([\s\S]*?)<\/span>/g,
    ),
  ].map((m) => ({
    id: m[2] ?? "",
    text: plainText(m[3]),
    correct: /quiz__answers-item--correct/.test(m[1] ?? ""),
  }));
  const block = cutBlocks(html, /<div class="media-pholder[^"]*"/).blocks[0];
  const video = block ? parsePlayer(block) : undefined;
  return {
    index: Number(progress[1]),
    total: Number(progress[2]),
    question,
    multiple: /type="checkbox"/.test(html),
    ...(video ? { video } : {}),
    options,
  };
}

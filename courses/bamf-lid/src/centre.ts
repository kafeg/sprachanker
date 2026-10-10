// BAMF's online test centre (research exams.md): an Oracle APEX application that shows the catalogue
// question by question, each option row marked "richtige Antwort" or "falsche Antwort" in the page.
// Reading a page (pure) and walking the application as its forms do (a session: a state chosen on the
// start page, then a question chosen from the list "Gehe zu Aufgabe Nr.").
import { type BrowsingSession, decodeEntities, plainText } from "@sprachanker/course-kit";
import { TEST_CENTRE, TEST_CENTRE_START } from "./catalog.ts";

/** One question as the test centre shows it: its number of all, its options in order, the right one. */
export interface CentreQuestion {
  number: number;
  total: number;
  options: Array<{ text: string; right: boolean }>;
}

/** A page's APEX form: where it posts and the fields a browser posts with it. */
interface ApexForm {
  action: string;
  fields: Record<string, string>;
  salt: string;
  protectedItems: string;
  rowVersion: string;
}

const attr = (tag: string, name: string) =>
  decodeEntities(new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? "");

/** The hidden input with this id on the page. */
function hidden(html: string, id: string): string {
  const tag = new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  if (!tag) throw new Error(`the test centre's page has no ${id}`);
  return attr(tag, "value");
}

function formOf(html: string): ApexForm {
  const action = /<form[^>]*\baction="([^"]+)"/.exec(html)?.[1];
  if (!action) throw new Error("the test centre's page has no form");
  return {
    action: new URL(decodeEntities(action), TEST_CENTRE).href,
    fields: {
      p_flow_id: hidden(html, "pFlowId"),
      p_flow_step_id: hidden(html, "pFlowStepId"),
      p_instance: hidden(html, "pInstance"),
      p_page_submission_id: hidden(html, "pPageSubmissionId"),
      p_reload_on_submit: hidden(html, "pReloadOnSubmit"),
    },
    salt: hidden(html, "pSalt"),
    protectedItems: hidden(html, "pPageItemsProtected"),
    rowVersion: (() => {
      try {
        return hidden(html, "pPageItemsRowVersion");
      } catch {
        return "";
      }
    })(),
  };
}

/** What a browser posts when the page is submitted with `request` and these item values (APEX's
 *  `p_json`: the items, the page's protection checksum and salt). */
export function submission(html: string, request: string, items: Record<string, string>) {
  const form = formOf(html);
  const pJson = {
    pageItems: {
      itemsToSubmit: Object.entries(items).map(([n, v]) => ({ n, v })),
      protected: form.protectedItems,
      rowVersion: form.rowVersion,
      formRegionChecksums: [],
    },
    salt: form.salt,
  };
  return {
    url: form.action,
    form: { ...form.fields, p_debug: "", p_request: request, p_json: JSON.stringify(pJson) },
  };
}

/** A question page read: its number, its options with the right one, and the list that jumps to any
 *  question (number → the application's id of it). */
export function readQuestionPage(html: string): CentreQuestion & { jump: Map<number, string> } {
  const heading = /Aufgabe (\d+) von (\d+)/.exec(html);
  if (!heading) throw new Error("the test centre's page shows no question");
  const options = [
    ...html.matchAll(/<tr>(?:(?!<\/tr>)[\s\S])*?headers="ANTWORT"[\s\S]*?<\/tr>/g),
  ].map(([row]) => {
    const marker = /headers="RICHTIGE_ANTWORT"[^>]*>([\s\S]*?)<\/td>/.exec(row)?.[1] ?? "";
    const radio = /<input[^>]*name="f20"[^>]*>/.exec(row)?.[0] ?? "";
    const right = /richtige Antwort/.test(plainText(marker));
    // The page marks the right option twice: its row's marker, and its radio (id "FARBE").
    if (right !== /\bid="FARBE"/.test(radio))
      throw new Error(`question ${heading[1]}: the page's two marks of the right option disagree`);
    const text = /headers="ANTWORT"[^>]*>([\s\S]*?)<\/td>/.exec(row)?.[1] ?? "";
    return { text: plainText(text), right };
  });
  const select = /<select[^>]*\bid="P30_ROWNUM"[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
  const jump = new Map<number, string>();
  for (const [, id, label] of select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)/g))
    if (/^\d+$/.test(label?.trim() ?? "") && id && /^\d+$/.test(decodeEntities(id)))
      jump.set(Number(label), decodeEntities(id));
  return { number: Number(heading[1]), total: Number(heading[2]), options, jump };
}

/**
 * Walks the test centre for the pages asked: `state` (its value in the start page's list) chosen
 * first, then each number jumped to from the page before. Calls `got` with each page's HTML as it
 * comes; a page that is not the question asked stops the walk.
 */
export async function walkCentre(
  session: BrowsingSession,
  state: string,
  numbers: number[],
  got: (number: number, html: string) => Promise<void>,
): Promise<void> {
  if (!numbers.length) return;
  const start = await session.page(TEST_CENTRE_START);
  const chosen = submission(start.text, "SUBMIT", { P1_BUL_ID: state });
  let page = (await session.page(chosen.url, chosen.form)).text;
  for (const number of numbers) {
    const shown = readQuestionPage(page);
    if (shown.number !== number) {
      const id = shown.jump.get(number);
      if (!id) throw new Error(`the test centre lists no question ${number}`);
      const jump = submission(page, "P30_ROWNUM", { P30_ROWNUM: id });
      page = (await session.page(jump.url, jump.form)).text;
    }
    const read = readQuestionPage(page);
    if (read.number !== number)
      throw new Error(`the test centre showed question ${read.number} for ${number}`);
    await got(number, page);
  }
}

// The test centre's pages read and walked, on invented pages shaped like its APEX pages.
import { expect, test } from "bun:test";
import type { BrowsingSession } from "@sprachanker/course-kit";
import { readQuestionPage, submission, walkCentre } from "../src/centre.ts";

const form = (step: number, instance = "77") => `
<form action="wwv_flow.accept?p_context=514:${step}:${instance}" method="post" name="wwv_flow">
<input type="hidden" name="p_flow_id" value="514" id="pFlowId" />
<input type="hidden" name="p_flow_step_id" value="${step}" id="pFlowStepId" />
<input type="hidden" name="p_instance" value="${instance}" id="pInstance" />
<input type="hidden" name="p_page_submission_id" value="S${step}" id="pPageSubmissionId" />
<input type="hidden" name="p_request" value="" id="pRequest" />
<input type="hidden" name="p_reload_on_submit" value="A" id="pReloadOnSubmit" />
<input type="hidden" value="SALT${step}" id="pSalt" />
<input type="hidden" id="pPageItemsRowVersion" value="" />
<input type="hidden" id="pPageItemsProtected" value="PROT&#x2F;${step}" />`;

const row = (text: string, right: boolean) => `
<tr>
<td headers="RICHTIGE_ANTWORT" class="t3data"><span style="visibility:hidden;">${right ? "richtige" : "falsche"} Antwort =></span></td><td headers="CHECKBOX" class="t3data"><input type="radio" name="f20" value="1"${right ? ' id="FARBE"' : ""} onclick="document.getElementById('FARBE').parentNode.style.backgroundColor = 'green';" /></td><td headers="ANTWORT" class="t3data">${text}</td></tr>`;

const questionPage = (n: number, right = 2) => `${form(30)}
<td class="RegionHeader">Aufgabe ${n} von 12</td>
<table>${["eins", "zwei &amp; drei", "vier", "fünf"].map((t, i) => row(`${t} ${n}`, i === right)).join("")}</table>
<select id="P30_ROWNUM" name="P30_ROWNUM"><option value="&#x25;null&#x25;" selected="selected">-- wählen --
<option value="9001">1
<option value="9002">2
<option value="9011">11
</select>`;

test("a question page: its number, its options in order, the right one, the list that jumps", () => {
  const page = readQuestionPage(questionPage(2));
  expect(page.number).toBe(2);
  expect(page.total).toBe(12);
  expect(page.options).toEqual([
    { text: "eins 2", right: false },
    { text: "zwei & drei 2", right: false },
    { text: "vier 2", right: true },
    { text: "fünf 2", right: false },
  ]);
  expect([...page.jump]).toEqual([
    [1, "9001"],
    [2, "9002"],
    [11, "9011"],
  ]);
});

test("a page whose two marks of the right option disagree is refused", () => {
  const broken = questionPage(2).replace('id="FARBE"', "");
  expect(() => readQuestionPage(broken)).toThrow(/disagree/);
});

test("a submission posts what a browser posts: the page's fields, the request, the items as p_json", () => {
  const { url, form: posted } = submission(form(1), "SUBMIT", { P1_BUL_ID: "4" });
  expect(url).toBe("https://oet.bamf.de/ords/oetut/wwv_flow.accept?p_context=514:1:77");
  expect(posted).toMatchObject({
    p_flow_id: "514",
    p_flow_step_id: "1",
    p_instance: "77",
    p_page_submission_id: "S1",
    p_request: "SUBMIT",
  });
  expect(JSON.parse(posted.p_json as string)).toEqual({
    pageItems: {
      itemsToSubmit: [{ n: "P1_BUL_ID", v: "4" }],
      protected: "PROT/1",
      rowVersion: "",
      formRegionChecksums: [],
    },
    salt: "SALT1",
  });
});

test("a walk chooses the state, then jumps to each question asked; a wrong page stops it", async () => {
  const posts: Array<Record<string, string> | undefined> = [];
  const session: BrowsingSession = {
    async page(url, sent) {
      posts.push(sent);
      if (!sent) return { text: form(1), url };
      if (sent.p_request === "SUBMIT") return { text: questionPage(1), url };
      const id = JSON.parse(sent.p_json as string).pageItems.itemsToSubmit[0].v;
      return { text: questionPage(id === "9011" ? 11 : 2), url };
    },
  };
  const got: number[] = [];
  await walkCentre(session, "4", [1, 11], async (n) => {
    got.push(n);
  });
  expect(got).toEqual([1, 11]);
  expect(posts.map((p) => p?.p_request ?? "GET")).toEqual(["GET", "SUBMIT", "P30_ROWNUM"]);
  // A number the list does not have, or a page that is not the question asked, stops the walk.
  await expect(walkCentre(session, "4", [12], async () => {})).rejects.toThrow(/no question 12/);
  const astray: BrowsingSession = {
    page: async (url, sent) => ({ text: sent ? questionPage(2) : form(1), url }),
  };
  await expect(walkCentre(astray, "4", [11], async () => {})).rejects.toThrow(
    /showed question 2 for 11/,
  );
});

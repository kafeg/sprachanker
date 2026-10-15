// A lesson's practice in the course as the query cache holds it: each step's variants made, and how
// many of them the learner has not had yet (`left`: "Another version" while there are some).
const STEPS = ["reading", "listening", "writing", "speaking"] as const;

export const practiceLesson = (
  ids: { series: string; lessonKey: string; edition: string },
  left = 0,
  made = 3,
): [unknown[], unknown] => [
  ["practice-lesson", ids.series, ids.lessonKey, ids.edition],
  Object.fromEntries(STEPS.map((step) => [step, { made, left }])),
];

/** The server on paper for one test (test/dom.ts puts the guard back after it): what it was asked
 *  (method, path, a POST's body), answering each path with `answer`'s. */
export function server(answer: (path: string) => unknown) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(
      `${request.method} ${url.pathname} ${request.method === "POST" ? await request.text() : ""}`.trim(),
    );
    return Response.json(answer(url.pathname));
  }) as typeof fetch;
  return asked;
}

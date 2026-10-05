// The Apollo cache DW embeds in every page (`window.__APOLLO_STATE__`).

export type ApolloState = Record<string, Record<string, unknown>>;

export function extractState(html: string): ApolloState {
  const match = /window\.__APOLLO_STATE__\s*=\s*/.exec(html);
  if (!match) throw new Error("page has no __APOLLO_STATE__");
  return parseFirstJsonValue(html.slice(match.index + match[0].length));
}

/** Parses the JSON object at the start of `text`, ignoring what follows it. */
function parseFirstJsonValue(text: string): ApolloState {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  throw new Error("unterminated __APOLLO_STATE__");
}

/** Entries whose key starts with `<typename>:`. */
export const entitiesOf = (state: ApolloState, typename: string) =>
  Object.entries(state)
    .filter(([key]) => key.startsWith(`${typename}:`))
    .map(([, value]) => value);

/** Lesson ids of a course page in course order. */
export function lessonIds(courseState: ApolloState): number[] {
  const course = entitiesOf(courseState, "Course")[0];
  if (!course) throw new Error("course page has no Course entity");
  const links = Object.entries(course).find(([key]) => key.startsWith("contentLinks"))?.[1];
  return (links as Array<{ __ref: string }>).map((link) => Number(courseState[link.__ref]?.id));
}

/** Exercise ids of a lesson page in lesson order. */
export function exerciseIds(lessonState: ApolloState, lessonId: number): number[] {
  const parts = (lessonState[`Lesson:${lessonId}`]?.overviewParts ?? []) as Array<{
    lessonPart: string;
    targetId: number;
  }>;
  return parts.filter((p) => p.lessonPart === "EXERCISE").map((p) => p.targetId);
}

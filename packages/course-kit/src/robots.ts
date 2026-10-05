// Minimal robots.txt support: the rules of the `*` group, with `*` and `$` wildcards.

export type RobotsRules = RegExp[];

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = [];
  let inStarGroup = false;
  let groupHasRules = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const [field = "", ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const name = field.trim().toLowerCase();
    if (name === "user-agent") {
      if (groupHasRules) inStarGroup = false;
      groupHasRules = false;
      if (value === "*") inStarGroup = true;
    } else if (name === "disallow" || name === "allow") {
      groupHasRules = true;
      if (inStarGroup && name === "disallow" && value) rules.push(toRegExp(value));
    }
  }
  return rules;
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Whether a URL path (decoded, with query) may be fetched. */
export const isAllowed = (rules: RobotsRules, path: string) => !rules.some((r) => r.test(path));

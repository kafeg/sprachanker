// A small HTML tree for the site's server-rendered pages: enough structure to walk sections, lists
// and players in order (the pages are hand-edited Joomla articles; regexes alone lose nesting).

export interface El {
  type: "el";
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
export interface Text {
  type: "text";
  /** Raw HTML text (entities not decoded). */
  text: string;
}
export type Node = El | Text;

const VOID = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
/** Opening one of these closes an open `<p>` (HTML's implied end tags). */
const CLOSES_P = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "section",
]);

const TOKEN =
  /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>|[^<]+|</g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR)) {
    const name = (m[1] ?? "").toLowerCase();
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Parses an HTML fragment into a root element (`#root`); scripts and styles are dropped. */
export function parseHtml(html: string): El {
  const root: El = { type: "el", tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const top = () => stack[stack.length - 1] as El;
  const close = (tag: string) => {
    const i = stack.findLastIndex((e) => e.tag === tag);
    if (i > 0) stack.length = i;
  };
  const source = html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, "");
  for (const m of source.matchAll(TOKEN)) {
    const [token, end, start, attrs] = m;
    if (end) {
      close(end.toLowerCase());
    } else if (start) {
      const tag = start.toLowerCase();
      if (CLOSES_P.has(tag) && top().tag === "p") stack.pop();
      if (tag === "li") {
        const list = stack.findLastIndex((e) => e.tag === "ul" || e.tag === "ol");
        const li = stack.findLastIndex((e) => e.tag === "li");
        if (li > list && list >= 0) stack.length = li;
      }
      const el: El = { type: "el", tag, attrs: attributes(attrs ?? ""), children: [] };
      top().children.push(el);
      if (!VOID.has(tag) && !token.endsWith("/>")) stack.push(el);
    } else if (!token.startsWith("<!")) {
      top().children.push({ type: "text", text: token });
    }
  }
  return root;
}

export const isEl = (node: Node | undefined): node is El => node?.type === "el";

export const hasClass = (node: Node | undefined, cls: string) =>
  isEl(node) && (node.attrs.class ?? "").split(/\s+/).includes(cls);

/** Elements below `node` (depth first, document order) that satisfy `test`. */
export function findAll(node: El, test: (el: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (el: El) => {
    for (const child of el.children) {
      if (!isEl(child)) continue;
      if (test(child)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

export const find = (node: El, test: (el: El) => boolean) => findAll(node, test)[0];

/** Raw inner HTML; attributes are written back with double quotes (or left out: `bare`). */
export function innerHtml(node: El, bare = false): string {
  return node.children.map((c) => outerHtml(c, bare)).join("");
}

export function outerHtml(node: Node, bare = false): string {
  if (node.type === "text") return node.text;
  const attrs = bare
    ? ""
    : Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`)
        .join("");
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${innerHtml(node, bare)}</${node.tag}>`;
}

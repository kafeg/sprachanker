// The phone app's page on this Mac, for trying it in a browser without a phone: dist/ (bun
// scripts/build.ts first) served with the native side played by this script over a folder — its
// files listed, served (byte ranges and all), written and removed; Whisper is not here.
//   bun scripts/dev.ts [data folder]   (default: a scratch folder; a copy of the phone's is best)
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative } from "node:path";

const PORT = Number(process.env.PORT ?? 4600);
const dist = join(import.meta.dir, "..", "dist");
const root = process.argv[2] ?? join(tmpdir(), "sprachanker-mobile-dev");
mkdirSync(root, { recursive: true });

const under = (path: string) => {
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(`${root}/`)) throw new Error(`outside: ${path}`);
  return file;
};
function walk(dir: string, out: Array<{ path: string; size: number; mtime: number }>) {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const file = join(dir, name);
    const s = statSync(file);
    if (s.isDirectory()) walk(file, out);
    else out.push({ path: relative(root, file), size: s.size, mtime: Math.round(s.mtimeMs) });
  }
  return out;
}

const commands: Record<string, (args: Record<string, string>) => unknown> = {
  fs_root: () => root,
  fs_list: ({ path }) => walk(under(path ?? ""), []),
  fs_write({ path, base64 }) {
    const file = under(path as string);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.part`, Buffer.from(base64 as string, "base64"));
    renameSync(`${file}.part`, file);
  },
  fs_remove: ({ path }) => rmSync(under(path as string), { recursive: true, force: true }),
};

// The native side as the page sees it in the app: `__TAURI__.core.invoke` and the files' address.
const harness = `<script>
  window.sprachankerFiles = location.origin + "/__files";
  window.__TAURI__ = { core: { invoke: async (cmd, args) => {
    const res = await fetch("/__invoke/" + cmd, { method: "POST", body: JSON.stringify(args ?? {}) });
    const body = await res.json();
    if (!res.ok) throw body.error;
    return body.value;
  } } };
</script>`;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/__invoke/")) {
      const cmd = commands[url.pathname.slice("/__invoke/".length)];
      if (!cmd) return Response.json({ error: "not in the harness" }, { status: 501 });
      try {
        return Response.json({ value: cmd((await req.json()) as Record<string, string>) ?? null });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    }
    if (url.pathname.startsWith("/__files/")) {
      const path = decodeURIComponent(url.pathname.slice("/__files/".length));
      const recording = path.match(/^recording\/(\w+)$/);
      let file = recording ? undefined : under(path);
      if (recording)
        for (const p of walk(under("profiles"), []))
          if (p.path.split("/").at(-1)?.startsWith(`${recording[1]}.`)) file = join(root, p.path);
      if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile())
        return new Response("not found", { status: 404 });
      return new Response(Bun.file(file));
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(dist, path);
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
      if (path === "/index.html")
        return new Response(readFileSync(file, "utf8").replace("<head>", `<head>${harness}`), {
          headers: { "content-type": "text/html" },
        });
      return new Response(Bun.file(file));
    }
    // The web app's routes: its page.
    return new Response(
      readFileSync(join(dist, "index.html"), "utf8").replace("<head>", `<head>${harness}`),
      {
        headers: { "content-type": "text/html" },
      },
    );
  },
});
console.log(`the phone app's page: http://localhost:${PORT} (files in ${root})`);

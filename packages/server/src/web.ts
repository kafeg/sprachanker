import type { Context } from "hono";

/** Looks up a built web file by URL path ("/index.html", "/assets/app-1a2b.js"). */
export type WebAssets = (path: string) => Promise<Blob | undefined>;

const HASHED = /^\/assets\//;
const HAS_EXTENSION = /\.[a-z0-9]+$/i;

/** Serves the built web app; client routes (paths without an extension) fall back to index.html. */
export function serveWeb(assets: WebAssets) {
  return async (c: Context) => {
    const path = c.req.path === "/" ? "/index.html" : c.req.path;
    let file = await assets(path);
    let served = path;
    if (!file && !HAS_EXTENSION.test(path)) {
      file = await assets("/index.html");
      served = "/index.html";
    }
    if (!file) return c.notFound();
    return new Response(file, {
      headers: {
        "content-type": file.type || "application/octet-stream",
        "cache-control": HASHED.test(served) ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  };
}

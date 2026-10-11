/// <reference types="vite/client" />
// The interface catalogs beside English, one per `<code>.json` file here: a file added is a language
// offered. Each loads when first needed, a chunk of its own (Vite; the tests read the folder instead).
export const catalogs = import.meta.glob<Record<string, unknown>>(["./*.json", "!./en.json"], {
  import: "default",
});

// A provider's models as the settings list them (07, "Providers"; 09): which filters its metadata allows,
// the models a search and the filters let through, grouped by publisher. Pure.

/** A model as the server lists it (`@sprachanker/llm` ModelInfo). */
export interface ListedModel {
  id: string;
  name?: string;
  free?: boolean;
  price?: { input: number; output: number };
  contextLength?: number;
  json?: boolean;
  tools?: boolean;
  publisher?: string;
}

export interface ModelFilters {
  search: string;
  free: boolean;
  /** Only models that answer in a JSON schema (writing checks and scenes need it). */
  json: boolean;
  /** At least this many tokens of context. */
  minContext?: number;
  /** Only these publishers (none: all). */
  publishers: string[];
}

export const NO_FILTERS: ModelFilters = { search: "", free: false, json: false, publishers: [] };

/** Context sizes offered as a filter. */
export const CONTEXT_STEPS = [32_000, 128_000];

/** What the list's metadata allows filtering by: a filter is offered only where some model tells it. */
export function modelFacets(models: ListedModel[]) {
  const publishers = new Map<string, number>();
  for (const m of models)
    if (m.publisher) publishers.set(m.publisher, (publishers.get(m.publisher) ?? 0) + 1);
  return {
    free: models.filter((m) => m.free).length,
    json: models.filter((m) => m.json).length,
    context: models.some((m) => m.contextLength !== undefined),
    /** Publishers by how many models they have, most first. */
    publishers: [...publishers].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/** The filters a list starts with, where the list tells them: free models (owner, 2026-10-08) that
 *  answer in JSON (the app needs it). */
export function initialFilters(models: ListedModel[]): ModelFilters {
  const facets = modelFacets(models);
  return { ...NO_FILTERS, free: facets.free > 0, json: facets.json > 0 };
}

/** The models the search (every word, in id or name) and the filters let through; `keep` always. */
export function filterModels(models: ListedModel[], f: ModelFilters, keep?: string) {
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    if (m.id === keep) return true;
    const text = `${m.id} ${m.name ?? ""}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) return false;
    if (f.free && !m.free) return false;
    if (f.json && !m.json) return false;
    if (f.minContext && (m.contextLength ?? 0) < f.minContext) return false;
    if (f.publishers.length && !f.publishers.includes(m.publisher ?? "")) return false;
    return true;
  });
}

/** Models grouped by publisher (free ones first in each), groups as the facets order them; a list
 *  without publishers is one group. */
export function groupModels(models: ListedModel[]) {
  const order = new Map(modelFacets(models).publishers.map(([p], i) => [p, i]));
  const groups = new Map<string, ListedModel[]>();
  for (const m of models) {
    const key = m.publisher ?? "";
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups]
    .sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9))
    .map(([publisher, list]) => ({
      publisher,
      models: [...list].sort(
        (a, b) =>
          Number(!!b.free) - Number(!!a.free) || (a.name ?? a.id).localeCompare(b.name ?? b.id),
      ),
    }));
}

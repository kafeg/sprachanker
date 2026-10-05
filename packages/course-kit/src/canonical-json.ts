// JSON Canonicalization Scheme (RFC 8785) for hashing (02, "Conventions").

/** Canonical JSON text: object keys sorted by UTF-16 code units, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`canonical JSON cannot encode ${value}`);
  }
  // JSON.stringify of strings, finite numbers, booleans and null matches RFC 8785.
  return JSON.stringify(value);
}

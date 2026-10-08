// Bytes as text for tokens and hashes: base64url without padding (Web APIs only,
// so it runs in Bun and Node alike).

export const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** SHA-256 of a text, as base64url. */
export const sha256 = async (text: string) =>
  base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

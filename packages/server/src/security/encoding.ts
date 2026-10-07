// Bytes as text for tokens, salts, hashes and passkey ids: base64url without padding (Web APIs only,
// so it runs in Bun and Node alike).

export const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** SHA-256 of a text, as base64url. */
export const sha256 = async (text: string) =>
  base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

// Bytes as text for tokens, hashes and requests: base64 and base64url without padding (Web APIs
// only, so it runs in Bun and Node alike).

/** Bytes as base64 (a large file too: taken a piece at a time). */
export function base64(bytes: ArrayBuffer | Uint8Array) {
  const all = new Uint8Array(bytes);
  let text = "";
  for (let at = 0; at < all.length; at += 0x8000)
    text += String.fromCharCode(...all.subarray(at, at + 0x8000));
  return btoa(text);
}

export const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** SHA-256 of a text, as base64url. */
export const sha256 = async (text: string) =>
  base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** The first `chars` hex digits (lowercase) of the SHA-256 of a text or bytes: a short name that
 *  never differs by case alone. */
export const sha256Hex = async (data: string | Uint8Array<ArrayBuffer>, chars: number) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      ),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, chars);

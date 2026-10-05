// Secrets at rest (06, "Secrets"): AES-256-GCM with a key kept outside the data root. Web Crypto only,
// so this stays runtime-agnostic; the key file itself is read in src/runtime/.
export interface SecretBox {
  seal(plain: string): Promise<string>;
  /** Undefined when the value was sealed with another key or is damaged. */
  open(sealed: string): Promise<string | undefined>;
}

const IV_BYTES = 12;

export function secretBox(keyBytes: Uint8Array): SecretBox {
  if (keyBytes.length !== 32) throw new Error("secret key must be 32 bytes");
  const key = crypto.subtle.importKey("raw", new Uint8Array(keyBytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return {
    async seal(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const data = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await key,
          new TextEncoder().encode(plain),
        ),
      );
      const out = new Uint8Array(IV_BYTES + data.length);
      out.set(iv);
      out.set(data, IV_BYTES);
      return btoa(String.fromCharCode(...out));
    },
    async open(sealed) {
      try {
        const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES) },
          await key,
          bytes.subarray(IV_BYTES),
        );
        return new TextDecoder().decode(plain);
      } catch {
        return undefined;
      }
    },
  };
}

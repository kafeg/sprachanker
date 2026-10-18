import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publicKeyId, UPDATE_FILE, wrongSignature } from "../scripts/sign.ts";

// A throwaway key's public half and its signature of a file for version 1.2.3 (`tauri signer`).
const PUB =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDYwNzlDMUIyODQ4QkZCMzAKUldRdys0dUVzc0Y1WUpIdkFSdDlkcVRUVlpmYnlkYjBqMng0TnpwNExOa05IS0Fab1ExZDNjOXIK";
const SIG =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRdys0dUVzc0Y1WVBaa1pLWElsV0lyejhQb0FKdFlOSHM0UEZpY1p0OGI1RjQ2L3NoTkZYZk5kWElYWDIwdm5pVzNzQkxhbHF3OTA0K0ZabWxGdnJIb0RzczlTTWJXcWdNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyMzEyOTY1CWZpbGU6U3ByYWNoQW5rZXItMS4yLjMtbGludXgteDY0LmRlYgl2ZXJzaW9uOjEuMi4zCllhNVRUVmF5Rys2OWJDU3p2YW0rTC9YeXAxeWxDNmNIcjZLdmtmSFpMMTMyajhnN3d6eTlzZUNFU3Iwb1owbTRXUFNGSmZpUGwrRHdTUUYzclJZQkJRPT0K";

test("a signature by the app's key for this version fits", () => {
  expect(publicKeyId(PUB)).toBe("30fb8b84b2c17960");
  expect(wrongSignature(SIG, PUB, "1.2.3")).toBeUndefined();
});

test("another version, or another key than the app's, is refused before release", () => {
  expect(wrongSignature(SIG, PUB, "1.2.4")).toBe("not signed for 1.2.4");
  const conf = JSON.parse(
    readFileSync(join(import.meta.dir, "../src-tauri/tauri.conf.json"), "utf8"),
  ) as { plugins: { updater: { pubkey: string } } };
  expect(wrongSignature(SIG, conf.plugins.updater.pubkey, "1.2.3")).toMatch(/^signed by key /);
});

test("the update files are those build.ts makes", () => {
  expect(UPDATE_FILE.test("SprachAnker-1.2.3-macos-arm64.app.tar.gz")).toBe(true);
  expect(UPDATE_FILE.test("SprachAnker-1.2.3-windows-x64-setup.exe")).toBe(true);
  expect(UPDATE_FILE.test("SprachAnker-1.2.3-linux-x64.deb")).toBe(true);
  expect(UPDATE_FILE.test("SprachAnker-1.2.3-macos-arm64.dmg")).toBe(false);
});

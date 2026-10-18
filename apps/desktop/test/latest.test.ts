import { expect, test } from "bun:test";
import { latest } from "../scripts/latest.ts";

const FILES = [
  "SprachAnker-0.2.700-macos-arm64.app.tar.gz",
  "SprachAnker-0.2.700-macos-arm64.dmg",
  "SprachAnker-0.2.700-windows-x64-setup.exe",
  "SprachAnker-0.2.700-linux-x64.deb",
  "sprachanker-linux-x64.tar.gz",
];

test("each system's updater target names its file in the release and that file's signature", () => {
  const json = latest("v0.2.700", FILES, (file) => `sig of ${file}`);
  expect(json.version).toBe("0.2.700");
  const base = "https://github.com/kafeg/sprachanker/releases/download/v0.2.700/";
  expect(json.platforms["darwin-aarch64"]).toEqual({
    url: `${base}SprachAnker-0.2.700-macos-arm64.app.tar.gz`,
    signature: "sig of SprachAnker-0.2.700-macos-arm64.app.tar.gz",
  });
  expect(json.platforms["windows-x86_64-nsis"]?.url).toBe(
    `${base}SprachAnker-0.2.700-windows-x64-setup.exe`,
  );
  expect(json.platforms["linux-x86_64"]?.url).toBe(`${base}SprachAnker-0.2.700-linux-x64.deb`);
  expect(json.platforms["linux-x86_64-deb"]?.url).toBe(`${base}SprachAnker-0.2.700-linux-x64.deb`);
  expect(Object.keys(json.platforms)).toHaveLength(6);
});

test("a release lacking a system's file, or another version's, is refused", () => {
  expect(() => latest("v0.2.700", FILES.slice(1), () => "")).toThrow(/darwin-aarch64/);
  expect(() => latest("v0.2.701", FILES, () => "")).toThrow();
  expect(() => latest("main", FILES, () => "")).toThrow(/not a version/);
});

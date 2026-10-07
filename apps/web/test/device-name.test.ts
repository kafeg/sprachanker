import { expect, test } from "bun:test";
import { deviceName } from "../src/app/device-name.ts";

test("a device as its browser and system", () => {
  expect(
    deviceName(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ),
  ).toBe("Safari · iPhone");
  expect(
    deviceName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    ),
  ).toBe("Chrome · Mac");
  expect(deviceName("curl/8.0")).toBe("curl/8.0");
});

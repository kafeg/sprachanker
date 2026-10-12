// How long a job has left, in a sentence: minutes, hours from 90 minutes on, the count told by the
// language's plural ("около 1 минуты", not Intl's nominative length "около 1 минута").
import { expect, test } from "bun:test";
import { IntlMessageFormat } from "intl-messageformat";
import ru from "../../src/i18n/ru.json";
import { durationParts, formatBytes } from "../../src/ui/format.ts";

test("sizes: kB under a megabyte (never 0 for a few bytes), MB, GB with a decimal", () => {
  expect(
    [0, 300, 404_000, 999_400, 13_400_000, 2_345_000_000].map((b) => formatBytes(b, "en")),
  ).toEqual(["0 kB", "1 kB", "404 kB", "999 kB", "13 MB", "2.3 GB"]);
  expect(formatBytes(404_000, "ru")).toBe("404 кБ");
});

test("a time left: its unit and count, then the message's plural", () => {
  expect([30_000, 60_000, 89 * 60_000, 90 * 60_000, 150 * 60_000].map(durationParts)).toEqual([
    { unit: "minute", count: 1 },
    { unit: "minute", count: 1 },
    { unit: "minute", count: 89 },
    { unit: "hour", count: 2 },
    { unit: "hour", count: 3 },
  ]);
  const left = (message: string, count: number) =>
    new IntlMessageFormat(message, "ru").format({ count });
  expect([1, 2, 5, 21].map((n) => left(ru.common.minutesLeft, n))).toEqual([
    "осталось около 1 минуты",
    "осталось около 2 минут",
    "осталось около 5 минут",
    "осталось около 21 минуты",
  ]);
  expect(left(ru.common.hoursLeft, 3)).toBe("осталось около 3 часов");
});

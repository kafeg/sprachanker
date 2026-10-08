// The API's errors in words (06, "Errors"): every code of schema's ERROR_CODES has `error.<code>` in
// the catalogs (test/catalogs.test.ts); anything else — a network failure, an older server's text —
// is "something went wrong" with what it said.
import { isErrorCode } from "@sprachanker/schema";
import type { TFunction } from "i18next";

export function errorText(t: TFunction, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return isErrorCode(message) ? t(`error.${message}`) : t("error.other", { message });
}

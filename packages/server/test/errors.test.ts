import { expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { errorResponse, ServiceError } from "../src/errors.ts";

test("a service's refusal answers with its code and status; 400 unless it says otherwise", () => {
  expect(errorResponse(new ServiceError("no_such_run", 404))).toEqual({
    status: 404,
    body: { error: "no_such_run" },
  });
  expect(errorResponse(new ServiceError("invalid_event"))).toEqual({
    status: 400,
    body: { error: "invalid_event" },
  });
});

test("a request that does not validate is invalid_request with what did not fit", () => {
  expect(errorResponse(new HTTPException(400, { message: "key: Required" }))).toEqual({
    status: 400,
    body: { error: "invalid_request", detail: "key: Required" },
  });
});

test("anything else is a server fault: no answer of its own", () => {
  expect(errorResponse(new Error("boom"))).toBeUndefined();
  expect(errorResponse("boom")).toBeUndefined();
});

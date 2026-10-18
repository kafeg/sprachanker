// The course preparation's runner: a step's jobs, one at a time where the step shares an engine.
import { expect, test } from "bun:test";
import { createCourseJobs } from "../src/services/course-jobs.ts";
import { until } from "./until.ts";

type Unit = { n: number };

test("one at a time: the rest queued in order; one stopped while queued ends at once, its turn passed on", async () => {
  const jobs = createCourseJobs<{ series: string; course: string }, Unit>({
    now: () => 1,
    oneAtATime: true,
  });
  const made: string[] = [];
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const make =
    (course: string) =>
    async ({ n }: Unit) => {
      made.push(`${course}${n}`);
      if (course === "a") await held;
    };
  const a = jobs.start({ series: "s", course: "a" }, [{ n: 1 }], make("a"));
  const b = jobs.start({ series: "s", course: "b" }, [{ n: 1 }], make("b"));
  const c = jobs.start({ series: "s", course: "c" }, [{ n: 1 }], make("c"));
  expect([a.job.state, b.job.state, c.job.state]).toEqual(["running", "queued", "queued"]);
  jobs.stop({ series: "s", course: "b" });
  await b.ended;
  expect(b.job.state).toBe("stopped");
  release();
  await a.ended;
  await c.ended;
  expect(made).toEqual(["a1", "c1"]);
  expect(c.job.state).toBe("done");
  // Nothing runs: the next starts at once.
  const d = jobs.start({ series: "s", course: "d" }, [{ n: 1 }], make("d"));
  expect(d.job.state).toBe("running");
  await until(() => d.job.state === "done");
});

test("a start refused while the course's job runs, with the step's own code", async () => {
  const jobs = createCourseJobs<{ series: string; course: string }, Unit>({
    now: () => 1,
    busy: "practice_busy",
  });
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const first = jobs.start({ series: "s", course: "a" }, [{ n: 1 }], () => held);
  expect(() => jobs.start({ series: "s", course: "a" }, [], async () => {})).toThrow(
    "practice_busy",
  );
  release();
  await first.ended;
});

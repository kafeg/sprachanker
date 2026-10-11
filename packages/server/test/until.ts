// Waiting in a test for what runs on its own (a job, an upload, a lock taken) without a count of tries
// that a loaded machine runs out of: the test's own timeout bounds the wait.

/** Waits until `ready` holds, however long the machine takes. */
export async function until(ready: () => boolean | Promise<boolean>) {
  while (!(await ready())) await Bun.sleep(1);
}

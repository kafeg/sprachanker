// LM Studio on this machine: its `lms` command (installed with the app into ~/.lmstudio/bin) starts
// the server headless, without the LM Studio window.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { join } from "node:path";
import type { LmStudioHost } from "../services/llm.ts";

const LMS = join(homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");

export function lmStudioHost(lms = LMS): LmStudioHost {
  return {
    installed: () => existsSync(lms),
    memoryGb: Math.round(totalmem() / 2 ** 30),
    startServer: () =>
      new Promise((resolve, reject) => {
        const child = spawn(lms, ["server", "start"], { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        child.stderr.setEncoding("utf8").on("data", (t: string) => {
          err = (err + t).slice(-1000);
        });
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`lms server start: ${err.trim()}`)),
        );
      }),
  };
}

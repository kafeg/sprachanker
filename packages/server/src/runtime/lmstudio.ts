// LM Studio on this machine: its `lms` command (installed with the app into ~/.lmstudio/bin) starts
// the server headless, without the LM Studio window.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { join } from "node:path";
import { ServiceError } from "../errors.ts";
import type { LmStudioHost } from "../services/llm.ts";

const LMS = join(homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");

export function lmStudioHost(lms = LMS): LmStudioHost {
  return {
    installed: () => existsSync(lms),
    memoryGb: Math.round(totalmem() / 2 ** 30),
    startServer: () =>
      new Promise((resolve, reject) => {
        const child = spawn(lms, ["server", "start"], { stdio: ["ignore", "ignore", "pipe"] });
        // It starts in seconds; one that hangs is given up (the setup says so).
        const timer = setTimeout(() => {
          child.kill();
          reject(new ServiceError("llm_lmstudio_failed", 502));
        }, 60_000);
        let err = "";
        child.stderr.setEncoding("utf8").on("data", (t: string) => {
          err = (err + t).slice(-1000);
        });
        child.once("error", () => {
          clearTimeout(timer);
          reject(new ServiceError("llm_lmstudio_failed", 502));
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else {
            console.error(`lms server start: ${err.trim()}`);
            reject(new ServiceError("llm_lmstudio_failed", 502));
          }
        });
      }),
  };
}

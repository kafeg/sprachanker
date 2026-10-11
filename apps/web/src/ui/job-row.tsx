// A job the server works through (a deck's words read aloud, given examples) as a row under what it
// works on: while it runs, what it says of its progress, Stop and a bar; otherwise what the caller
// shows (how many are left, the action), then why it failed and an error.
import { Square } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./components/button.tsx";
import { Progress } from "./components/progress.tsx";
import { cn } from "./utils.ts";

export function JobRow({
  running,
  idle,
  failed,
  error,
  className,
}: {
  running?: {
    /** Its progress in words ("Reading 120 of 773…"), and how long the rest takes, when known. */
    status: string;
    left?: string;
    done: number;
    total: number;
    stopping: boolean;
    stop: string;
    onStop(): void;
  };
  /** What is shown while it does not run. */
  idle?: ReactNode;
  /** Why the latest run failed (how many, the reason). */
  failed?: ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5 text-sm", className)}>
      {running ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span role="status" className="text-muted-foreground">
            {running.status}
            {running.left && ` · ${running.left}`}
          </span>
          <Button variant="outline" size="sm" loading={running.stopping} onClick={running.onStop}>
            <Square className="size-3.5" /> {running.stop}
          </Button>
          <Progress
            value={running.total ? (running.done / running.total) * 100 : 0}
            aria-label={running.status}
            className="h-1.5 basis-full"
          />
        </div>
      ) : (
        idle
      )}
      {failed && <div className="text-wrong">{failed}</div>}
      {error && <p className="text-wrong">{error}</p>}
    </div>
  );
}

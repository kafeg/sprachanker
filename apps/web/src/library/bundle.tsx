// A downloaded course or exam moved as a file (02, "Course bundle"; 09): a Downloaded card's "Export
// to a file" — the server makes the file ready, the browser downloads it — and the Downloaded tabs'
// "Import from a file": the file sent with its progress, the server's check, then the course installed
// (or found the same, or replaced with the learner's progress kept) and what its check found.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  courseExportReady,
  courseExportUrl,
  type ExportedCourse,
  type ImportedCourse,
  prepareCourseExport,
  uploadCourse,
} from "@/api/courses.ts";
import { startDownload } from "@/api/files.ts";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useBytes } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { quietButton } from "./upkeep.tsx";

/** "Export to a file" of a course in one edition (a Downloaded card's). */
export function CourseExport({
  series,
  course,
  edition,
  exam = false,
  prepare = prepareCourseExport,
  check = courseExportReady,
  download = startDownload,
}: {
  series: string;
  course: string;
  edition: string;
  /** An exam's card: its hint says so. */
  exam?: boolean;
  /** Tests give their own: the file made ready, still there, and downloaded. */
  prepare?: typeof prepareCourseExport;
  check?: (id: string) => Promise<void>;
  download?: (url: string, fileName: string) => void;
}) {
  const { t } = useTranslation();
  const bytes = useBytes();
  const exported = useMutation({
    mutationFn: async (): Promise<ExportedCourse> => {
      const ready = await prepare({ series, course, edition });
      // One gone meanwhile is an error here, never the server's answer saved as the file.
      await check(ready.id);
      return ready;
    },
    onSuccess: (ready) => download(courseExportUrl(ready.id), ready.fileName),
  });
  return (
    <>
      <Button
        variant="outline"
        className={quietButton}
        title={t(exam ? "bundle.export.hintExam" : "bundle.export.hint")}
        loading={exported.isPending}
        onClick={() => exported.mutate()}
      >
        <Download /> {t("bundle.export.button")}
      </Button>
      {exported.data && (
        <p className="basis-full text-sm" role="status">
          {t("bundle.export.started", {
            file: exported.data.fileName,
            size: bytes(exported.data.bytes),
          })}
        </p>
      )}
      {exported.isError && (
        <p className="basis-full text-sm text-wrong">{errorText(t, exported.error)}</p>
      )}
    </>
  );
}

type Phase =
  | { at: "sending"; sent: number }
  | { at: "checking" }
  | { at: "done"; result: ImportedCourse }
  | { at: "failed"; error: unknown };

/** "Import from a file" on the Downloaded tabs (Courses', Exams'). */
export function CourseImport({
  hidden,
  upload = uploadCourse,
}: {
  /** A series this tab does not list (an experiment not turned on): the result says how to see it. */
  hidden?(series: string): boolean;
  upload?: typeof uploadCourse;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>();
  const busy = phase?.at === "sending" || phase?.at === "checking";
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setPhase({ at: "sending", sent: 0 });
    try {
      // Once all is sent, the server checks the file and installs the course.
      const result = await upload(file, (sent) =>
        setPhase(sent >= 1 ? { at: "checking" } : { at: "sending", sent }),
      );
      setPhase({ at: "done", result });
      // The course's lists, page, lessons and check may all have changed.
      for (const key of ["courses", "exams", "catalog", "course", "lesson", "course-check", "exam"])
        void client.invalidateQueries({ queryKey: [key] });
    } catch (error) {
      setPhase({ at: "failed", error });
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="mx-auto mt-6 flex w-full max-w-md flex-col items-center gap-3">
      <input
        ref={input}
        type="file"
        // Its own extension alone would grey the file out on iOS (a type it does not know): a zip,
        // and any file — the server checks what it is.
        accept=".sprachanker-course,application/zip,application/octet-stream"
        className="hidden"
        aria-label={t("bundle.import.button")}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <Button
        variant="ghost"
        className="text-muted-foreground"
        loading={busy}
        onClick={() => input.current?.click()}
      >
        <Upload /> {t("bundle.import.button")}
      </Button>
      {!phase && (
        <p className="text-center text-sm text-muted-foreground">{t("bundle.import.hint")}</p>
      )}
      {phase?.at === "sending" && (
        <div className="w-full space-y-1" role="status">
          <Progress value={phase.sent * 100} aria-label={t("bundle.import.button")} />
          <p className="text-center text-sm text-muted-foreground">
            {t("bundle.import.sending", { share: phase.sent })}
          </p>
        </div>
      )}
      {phase?.at === "checking" && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          {t("bundle.import.checking")}
        </p>
      )}
      {phase?.at === "failed" && (
        <p className="text-center text-sm text-wrong">{errorText(t, phase.error)}</p>
      )}
      {phase?.at === "done" && <Imported result={phase.result} hidden={hidden} />}
    </div>
  );
}

/** The course installed: how, what its check found, and — an experiment not turned on — where to
 *  turn it on to see it. */
function Imported({
  result,
  hidden,
}: {
  result: ImportedCourse;
  hidden?(series: string): boolean;
}) {
  const { t } = useTranslation();
  const { course, status, check } = result;
  const title = course.editions.map((e) => course.titles[e]).find(Boolean) ?? course.key;
  const series = course.key.split("/")[0] ?? "";
  return (
    <Panel className="w-full space-y-1" as="div">
      <p className="font-semibold" role="status">
        {t(`bundle.import.${status}`, { title })}
      </p>
      <p className={`text-sm ${check.problems ? "text-wrong" : "text-muted-foreground"}`}>
        {check.problems
          ? t("bundle.import.problems", { count: check.problems })
          : t("bundle.import.verified")}
      </p>
      {hidden?.(series) && (
        <p className="text-sm">
          {t("bundle.import.experimental")}{" "}
          <Link to="/settings" hash="experimental" className="underline pointer-coarse:min-h-11">
            {t("bundle.import.turnOn")}
          </Link>
        </p>
      )}
    </Panel>
  );
}

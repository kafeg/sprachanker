// "Import a profile" on who is studying: a profile file chosen and sent with
// its progress, the server's check, then the new profile — to open — with what the file left out
// (API keys) and the content it used that is not on this computer.
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ImportedProfile, uploadProfile, useSignIn } from "@/api/session.ts";
import { languageName } from "@/i18n/index.ts";
import { Avatar } from "@/ui/avatar.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { errorText } from "@/ui/error-text.ts";
import { Panel } from "@/ui/panel.tsx";

type Phase =
  | { at: "sending"; sent: number }
  | { at: "checking" }
  | { at: "done"; result: ImportedProfile }
  | { at: "failed"; error: unknown };

export function ProfileImport({ upload = uploadProfile }: { upload?: typeof uploadProfile }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>();
  const busy = phase?.at === "sending" || phase?.at === "checking";
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setPhase({ at: "sending", sent: 0 });
    try {
      // Once all is sent, the server checks the file and makes the profile.
      const result = await upload(file, (sent) =>
        setPhase(sent >= 1 ? { at: "checking" } : { at: "sending", sent }),
      );
      setPhase({ at: "done", result });
      void client.invalidateQueries({ queryKey: ["profiles"] });
    } catch (error) {
      setPhase({ at: "failed", error });
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
      <input
        ref={input}
        type="file"
        // Its own extension alone would grey the file out on iOS (a type it does not know), and
        // Android's picker greys out a type it does not know: a zip, and any file — the server
        // checks what it is.
        accept=".sprachanker-profile,application/zip,application/octet-stream,*/*"
        className="hidden"
        aria-label={t("profiles.import.button")}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <Button
        variant="ghost"
        className="text-muted-foreground"
        loading={busy}
        onClick={() => input.current?.click()}
      >
        <Upload /> {t("profiles.import.button")}
      </Button>
      {phase?.at === "sending" && (
        <div className="w-full space-y-1" role="status">
          <Progress value={phase.sent * 100} aria-label={t("profiles.import.button")} />
          <p className="text-center text-sm text-muted-foreground">
            {t("profiles.import.sending", { share: phase.sent })}
          </p>
        </div>
      )}
      {phase?.at === "checking" && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          {t("profiles.import.checking")}
        </p>
      )}
      {phase?.at === "failed" && (
        <p className="text-center text-sm text-wrong">{errorText(t, phase.error)}</p>
      )}
      {phase?.at === "done" && <Imported result={phase.result} />}
    </div>
  );
}

/** The new profile, to open, and what the file did not bring. */
function Imported({ result }: { result: ImportedProfile }) {
  const { t, i18n } = useTranslation();
  const signIn = useSignIn();
  const { profile, leftOut, missing } = result;
  // An edition by the language its texts are in (`ru-de`: Russian).
  const languages = (editions: string[]) =>
    editions.map((e) => languageName(e.split("-")[0] ?? e, i18n.language)).join(", ");
  const absent = [
    ...[...missing.courses, ...missing.exams].map((c) => ({
      key: c.key,
      title: c.title ?? c.key,
      detail: languages(c.editions),
    })),
    ...missing.decks.map((d) => ({ key: d.id, title: d.title ?? d.id, detail: "" })),
  ];
  return (
    <Panel className="w-full space-y-3" as="div">
      <div className="flex items-center gap-3" role="status">
        <Avatar name={profile.name} colour={profile.colour} className="size-10 text-lg" />
        <p className="font-semibold">{t("profiles.import.done", { name: profile.name })}</p>
      </div>
      {leftOut.apiKeys.length > 0 && (
        <p className="text-sm text-muted-foreground">{t("profiles.import.noKeys")}</p>
      )}
      {leftOut.endpointLogins.length > 0 && (
        <p className="text-sm text-muted-foreground">{t("profiles.import.noEndpointLogins")}</p>
      )}
      {absent.length > 0 && (
        <div className="text-sm">
          <p className="text-muted-foreground">{t("profiles.import.missing")}</p>
          <ul className="mt-1 list-disc ps-5">
            {absent.map((a) => (
              <li key={a.key}>
                {a.title}
                {a.detail && <span className="text-muted-foreground"> · {a.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button
        className="w-full"
        loading={signIn.isPending}
        onClick={() => signIn.mutate({ profile: profile.id })}
      >
        {t("profiles.import.open", { name: profile.name })}
      </Button>
      {signIn.isError && <p className="text-sm text-wrong">{errorText(t, signIn.error)}</p>}
    </Panel>
  );
}

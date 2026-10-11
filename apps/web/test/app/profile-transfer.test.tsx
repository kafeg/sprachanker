import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "../../src/api/client.ts";
import type { ImportedProfile } from "../../src/api/session.ts";
import { ProfileExport } from "../../src/app/profile-export.tsx";
import { ProfileImport } from "../../src/app/profile-import.tsx";
import { WhoIsStudying } from "../../src/app/who-is-studying.tsx";
import { renderApp } from "../render.tsx";

test("Export profile: the file made ready on the server, then downloaded under its name", async () => {
  const downloads: string[][] = [];
  const view = await renderApp(
    <ProfileExport
      prepare={async () => ({
        id: "6f1c2a40-0000-4000-8000-000000000001",
        fileName: "Mila-2026-10-11.sprachanker-profile",
        bytes: 2_500_000,
        leftOut: { apiKeys: ["openrouter"], endpointLogins: [] },
      })}
      download={(url, name) => void downloads.push([url, name])}
    />,
  );
  expect(view.getByText(/API keys are not in it/)).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Export profile" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe(
      "Downloading “Mila-2026-10-11.sprachanker-profile” (3 MB).",
    ),
  );
  expect(downloads).toEqual([
    [
      "/api/profile/export/6f1c2a40-0000-4000-8000-000000000001",
      "Mila-2026-10-11.sprachanker-profile",
    ],
  ]);
});

test("Export profile: a full disk said in words, nothing downloaded", async () => {
  const downloads: string[] = [];
  const view = await renderApp(
    <ProfileExport
      prepare={() => Promise.reject(new ApiError("not_enough_space", 507))}
      download={(url) => void downloads.push(url)}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Export profile" }));
  await waitFor(() =>
    expect(view.getByText("There is not enough free space on the disk.")).toBeTruthy(),
  );
  expect(downloads).toEqual([]);
});

/** A file chosen in the hidden picker. */
function choose(view: Awaited<ReturnType<typeof renderApp>>) {
  const input = view.getByLabelText("Import a profile…", { selector: "input" }) as HTMLInputElement;
  const file = new File(["zip"], "Mila-2026-10-11.sprachanker-profile");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

const RESULT: ImportedProfile = {
  profile: { id: "01k7abc", name: "Mila (2)", colour: "teal", onboarded: true },
  leftOut: { apiKeys: ["openrouter"], endpointLogins: ["custom"] },
  missing: {
    courses: [{ key: "dw.nicos-weg/a1", title: "Nicos Weg A1", editions: ["ru-de"] }],
    exams: [],
    decks: [{ id: "my-deck", title: "Goethe A1 words" }],
  },
};

test("Import a profile: sent with its progress, checked, then the new profile with what it lacks here", async () => {
  let progress: (sent: number) => void = () => {};
  let finish: (result: ImportedProfile) => void = () => {};
  const view = await renderApp(
    <ProfileImport
      upload={(_, onProgress) => {
        progress = onProgress;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }}
    />,
  );
  choose(view);
  await waitFor(() => expect(view.getByText("Sending the file… 0%")).toBeTruthy());
  act(() => progress(0.5));
  expect(view.getByText("Sending the file… 50%")).toBeTruthy();
  act(() => progress(1));
  expect(view.getByText("Checking the file and making the profile…")).toBeTruthy();
  await act(async () => finish(RESULT));
  expect(view.getByText("“Mila (2)” is here.")).toBeTruthy();
  expect(view.getByText(/API keys are not in the file/)).toBeTruthy();
  expect(view.getByText(/passwords in AI server addresses are not in the file/)).toBeTruthy();
  const missing = view.getAllByRole("listitem").map((li) => li.textContent);
  expect(missing).toEqual(["Nicos Weg A1 · Russian", "Goethe A1 words"]);
  expect(view.getByRole("button", { name: "Open “Mila (2)”" })).toBeTruthy();
});

test("Import a profile: a refused file said in words", async () => {
  const view = await renderApp(
    <ProfileImport upload={() => Promise.reject(new ApiError("profile_from_newer_app", 422))} />,
  );
  choose(view);
  await waitFor(() =>
    expect(
      view.getByText(
        "This profile comes from a newer version of SprachAnker: update the app here first.",
      ),
    ).toBeTruthy(),
  );
});

test("who is studying offers an import while new profiles may be made", async () => {
  const profiles = (registration: boolean) =>
    [
      ["profiles"],
      {
        profiles: [{ id: "local", name: "Mila", colour: "teal", onboarded: true }],
        registration,
      },
    ] as [unknown[], unknown];
  const open = await renderApp(<WhoIsStudying onNew={() => {}} />, { data: [profiles(true)] });
  expect(open.getByRole("button", { name: "Import a profile…" })).toBeTruthy();
  open.unmount();
  const closed = await renderApp(<WhoIsStudying onNew={() => {}} />, { data: [profiles(false)] });
  expect(closed.queryByRole("button", { name: "Import a profile…" })).toBeNull();
});

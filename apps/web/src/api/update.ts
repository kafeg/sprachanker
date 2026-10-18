// Whether a newer version is out (the server asks GitHub's latest release at most every few hours)
// and the ways to install it: the phone app's server downloads and installs it itself; the desktop
// app's window asks its shell, which checks the release's signature, installs it and starts again.
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, json } from "./client.ts";

const UPDATE_REFRESH_MS = 3600_000;

export const useUpdate = () =>
  useQuery({
    queryKey: ["update"],
    staleTime: UPDATE_REFRESH_MS,
    refetchInterval: UPDATE_REFRESH_MS,
    queryFn: () => json(api.update.$get()),
  });

/** The newer release installed by the server itself (the phone app: the system's installer asks). */
export const useInstallUpdate = () =>
  useMutation({ mutationFn: () => json(api.update.install.$post()) });

type Shell = { invoke(command: string): Promise<unknown> };

/** The desktop app's shell, where this page is in its window (Tauri's IPC: apps/desktop lets the
 *  page of its own server call `install_update` and nothing else). */
export const desktopShell = () =>
  (globalThis as { __TAURI_INTERNALS__?: Shell }).__TAURI_INTERNALS__;

/** The desktop app updated by its shell: the release downloaded, its signature checked, installed,
 *  the app started again (the page goes with it). */
export const useDesktopUpdate = () =>
  useMutation({
    mutationFn: async () => {
      const shell = desktopShell();
      if (!shell) throw new Error("not in the desktop app");
      await shell.invoke("install_update");
    },
  });

// Profiles and signing in: who is studying, the session of this device, a
// new profile, signing in by choosing, signing out; the signed-in profile's name, colour, onboarding and
// devices; a profile as a file — the signed-in one exported, one imported.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, json } from "./client.ts";
import { downloadReady, uploadFile } from "./files.ts";

const fetchSession = () => json(api.session.$get());
export type SessionProfile = NonNullable<Awaited<ReturnType<typeof fetchSession>>["profile"]>;

/** The profile this device is signed in to, or null. */
export const useSession = () =>
  useQuery({ queryKey: ["session"], queryFn: fetchSession, staleTime: Number.POSITIVE_INFINITY });

/** Who is studying on this server, and whether new profiles may be made. */
export const useProfiles = () =>
  useQuery({ queryKey: ["profiles"], queryFn: () => json(api.profiles.$get()) });

/** After signing in or out, everything a profile reads is read again for the new one. */
function useSignedIn() {
  const client = useQueryClient();
  return (profile: SessionProfile | null) => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    client.setQueryData(["session"], { profile });
  };
}

export function useSignIn() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: (input: { profile: string }) => json(api.session.$post({ json: input })),
    onSuccess: ({ profile }) => signedIn(profile),
  });
}

export function useCreateProfile() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.profiles.$post>[0]["json"]) =>
      json(api.profiles.$post({ json: input })),
    onSuccess: ({ profile }) => signedIn(profile),
  });
}

export function useSignOut() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: () => json(api.session.$delete()),
    onSuccess: () => signedIn(null),
  });
}

/** Deletes the signed-in profile with everything it holds; this device is then signed out. */
export function useDeleteProfile() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: () => json(api.profile.$delete()),
    onSuccess: () => signedIn(null),
  });
}

/** Keeps a changed profile as the session's. */
function useProfileSaved() {
  const client = useQueryClient();
  return ({ profile }: { profile: SessionProfile }) => {
    client.setQueryData(["session"], { profile });
    void client.invalidateQueries({ queryKey: ["profiles"] });
  };
}

export function useUpdateProfile() {
  const saved = useProfileSaved();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.profile.$put>[0]["json"]) =>
      json(api.profile.$put({ json: input })),
    onSuccess: saved,
  });
}

export const useDevices = () =>
  useQuery({ queryKey: ["devices"], queryFn: () => json(api.profile.devices.$get()) });

export function useRevokeDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => json(api.profile.devices[":id"].$delete({ param: { id } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export type ExportedProfile = InferResponseType<typeof api.profile.export.$post, 200>;
export type ImportedProfile = InferResponseType<typeof api.profiles.import.$post, 200>;

/** The signed-in profile's file made ready on the server: its id, name, size, what it leaves out. */
export const prepareExport = () => json(api.profile.export.$post());

/** Where a prepared export is downloaded (once). */
export const exportUrl = (id: string) => `/api/profile/export/${id}`;

/** Whether a prepared export is still there to download (nothing taken). */
export const exportReady = (id: string) => downloadReady(exportUrl(id), "profile_export_gone");

/** A profile file sent to the server and imported as a new profile, its progress heard. */
export const uploadProfile = (file: File, onProgress: (sent: number) => void) =>
  uploadFile<ImportedProfile>("/api/profiles/import", file, onProgress);

// Profiles and signing in (06, "Profiles and access"): who is studying, the session of this device, a
// new profile, signing in by choosing, signing out; the signed-in profile's name, colour, onboarding and
// devices.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "./client.ts";

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

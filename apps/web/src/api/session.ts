// Profiles and signing in (06, "Profiles and access"): who is studying, the session of this device, a
// new profile, signing in by choosing, PIN or passkey, signing out; the signed-in profile's name,
// colour, onboarding, PIN, passkeys and devices.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
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

/** Passkeys work here: a browser that has them, on HTTPS or localhost. */
export const passkeysHere = () =>
  typeof window !== "undefined" && window.isSecureContext && "PublicKeyCredential" in window;

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
    mutationFn: (input: { profile: string; pin?: string }) =>
      json(api.session.$post({ json: input })),
    onSuccess: ({ profile }) => signedIn(profile),
  });
}

export function useSignInWithPasskey() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: async (profile: string) => {
      const optionsJSON = await json(api.session.passkey.options.$post({ json: { profile } }));
      const response = await startAuthentication({ optionsJSON: optionsJSON as never });
      return json(api.session.passkey.$post({ json: { profile, response: response as never } }));
    },
    onSuccess: ({ profile }) => signedIn(profile),
  });
}

export function useCreateProfile() {
  const signedIn = useSignedIn();
  return useMutation({
    mutationFn: (input: { name?: string } = {}) => json(api.profiles.$post({ json: input })),
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
    mutationFn: (input: {
      name?: string;
      colour?: SessionProfile["colour"];
      onboarded?: boolean;
    }) => json(api.profile.$put({ json: input as never })),
    onSuccess: saved,
  });
}

export function useSetPin() {
  const saved = useProfileSaved();
  return useMutation({
    mutationFn: (pin: string | null) => json(api.profile.pin.$put({ json: { pin } })),
    onSuccess: saved,
  });
}

export const usePasskeys = () =>
  useQuery({ queryKey: ["passkeys"], queryFn: () => json(api.profile.passkeys.$get()) });

export function useAddPasskey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const optionsJSON = await json(api.profile.passkeys.options.$post());
      const response = await startRegistration({ optionsJSON: optionsJSON as never });
      return json(api.profile.passkeys.$post({ json: { response: response as never } }));
    },
    onSuccess: (data) => {
      client.setQueryData(["passkeys"], data);
      void client.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export function useRemovePasskey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => json(api.profile.passkeys[":id"].$delete({ param: { id } })),
    onSuccess: (data) => {
      client.setQueryData(["passkeys"], data);
      void client.invalidateQueries({ queryKey: ["session"] });
    },
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

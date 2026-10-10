// Recordings kept (08): one sent, where it plays from, how many there are, all deleted.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json, sendBinary } from "./client.ts";

/** Keeps a recording (its bytes as the browser encoded them); its id. A binary body, so not through
 *  the RPC client. */
export async function uploadRecording(take: { blob: Blob; type: string }): Promise<string> {
  return (await sendBinary<{ id: string }>("/api/recordings", take.blob, take.type)).id;
}

/** Where a kept recording plays from. */
export const recordingUrl = (id: string) => `/api/recordings/${id}`;

/** How many recordings are kept and their size. */
export const useRecordingStats = () =>
  useQuery({ queryKey: ["recordings"], queryFn: () => json(api.recordings.$get()) });

export function useDeleteRecordings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => json(api.recordings.$delete()),
    onSuccess: () => client.invalidateQueries({ queryKey: ["recordings"] }),
  });
}

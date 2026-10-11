// Files moved between one's machines — a profile file (05), a course bundle (02): one sent with its
// progress, one made ready on the server asked after before its download, a download started under
// the file's own name.
import { CLIENT_HEADERS, type ErrorCode } from "@sprachanker/schema";
import { ApiError } from "./client.ts";

/**
 * A file sent as a request's body; `onProgress` hears how much of it was sent (0–1: an
 * XMLHttpRequest, as fetch tells nothing of an upload, and it sends the file's length). The server's
 * refusal is an ApiError with its code.
 */
export function uploadFile<T>(
  url: string,
  file: File,
  onProgress: (sent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [name, value] of Object.entries(CLIENT_HEADERS)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(body.error ?? `HTTP ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new Error("the server was not reached"));
    xhr.send(file);
  });
}

/** Whether a prepared download is still there (a HEAD: nothing taken); an ApiError `gone` when it
 *  is not — a download started then would save the server's answer as the file. */
export async function downloadReady(url: string, gone: ErrorCode) {
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) throw new ApiError(res.status === 404 ? gone : `HTTP ${res.status}`, res.status);
}

/** A file downloaded by the browser, under its own name. */
export function startDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

// Files moved between one's machines — a profile file, a course bundle: one sent with its
// progress, one made ready on the server asked after before its download, a download started under
// the file's own name.
import { CLIENT_HEADERS, type ErrorCode } from "@sprachanker/schema";
import { ApiError } from "./client.ts";

/** How the phone app moves files (apps/mobile's boot: `sprachankerTransfer`): its server is in the
 *  page, and what it exports goes to the phone's Downloads. */
interface PhoneTransfer {
  upload(
    url: string,
    file: File,
    headers: Record<string, string>,
    onProgress: (sent: number) => void,
  ): Promise<{ status: number; text: string }>;
  save(url: string, fileName: string): Promise<void>;
}
const phone = (globalThis as { sprachankerTransfer?: PhoneTransfer }).sprachankerTransfer;

/** A server's answer to a file sent: its body, or its refusal as an ApiError. */
function answered<T>(status: number, text: string): T {
  let body: { error?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (status >= 200 && status < 300) return body as T;
  throw new ApiError(body.error ?? `HTTP ${status}`, status);
}

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
  const headers = { ...CLIENT_HEADERS, "content-type": "application/octet-stream" };
  if (phone)
    return phone
      .upload(url, file, headers, onProgress)
      .then(({ status, text }) => answered<T>(status, text));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        resolve(answered<T>(xhr.status, xhr.responseText));
      } catch (error) {
        reject(error);
      }
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

/** A file downloaded by the browser, under its own name (the phone app: into its Downloads). */
export function startDownload(url: string, fileName: string) {
  if (phone) {
    phone.save(url, fileName).catch((error: unknown) => console.error(error));
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

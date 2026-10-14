// A film as its player gets it: its URL, or — in the phone app, whose WebView plays and seeks a film
// from the app's files only when it holds it whole — what the app makes of it (`sprachankerPlayable`,
// set by apps/mobile: the file read whole, as a blob URL). Nothing until it is made.
import { useEffect, useState } from "react";

type Playable = (url: string) => Promise<string>;
const maker = () => (globalThis as { sprachankerPlayable?: Playable }).sprachankerPlayable;

export function usePlayable(url: string | undefined): string | undefined {
  const make = maker();
  const [made, setMade] = useState<{ url: string; src: string }>();
  useEffect(() => {
    if (!make || !url) return;
    let live = true;
    void make(url).then((src) => {
      if (live) setMade({ url, src });
    });
    return () => {
      live = false;
    };
  }, [make, url]);
  if (!make) return url;
  return made && made.url === url ? made.src : undefined;
}

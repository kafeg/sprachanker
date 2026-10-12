// One promise per key: what is asked for again while it is being made gets the same promise (a model
// loaded, a recording heard, a lesson read), never a second one.

/** Promises by key. Without `keep` one is forgotten once it settles (asked again later, made again);
 *  with it a success is kept — while its `stamp` stays the same — and only a failure forgotten. */
export function createOnce<T>(options: { keep?: boolean } = {}) {
  const promises = new Map<string, { stamp?: string; value: Promise<T> }>();
  return (key: string, make: () => Promise<T>, stamp?: string): Promise<T> => {
    const known = promises.get(key);
    if (known && known.stamp === stamp) return known.value;
    const entry = { stamp, value: make() };
    promises.set(key, entry);
    const forget = () => {
      if (promises.get(key) === entry) promises.delete(key);
    };
    if (options.keep) entry.value.catch(forget);
    else entry.value.then(forget, forget);
    return entry.value;
  };
}

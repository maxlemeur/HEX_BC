/**
 * Starts a read now so that it runs alongside other work, and returns its promise to await later.
 * If the caller throws before awaiting it, its rejection is not reported as unhandled; once
 * awaited, it rejects as usual.
 */
export function startConcurrentRead<T>(read: PromiseLike<T>): Promise<T> {
  const promise = Promise.resolve(read);
  promise.catch(() => undefined);
  return promise;
}

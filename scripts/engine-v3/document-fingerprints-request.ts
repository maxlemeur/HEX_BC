/**
 * Stand-in for `next/headers`, loaded only by the document fingerprint worker
 * through its resolve hook. The real `@/lib/supabase/server` keeps building
 * its `@supabase/ssr` client from these cookies, and the real tenant context
 * keeps resolving the user and membership on the owned stack: only the HTTP
 * request that Next.js would provide is synthesized. It holds no secret of its
 * own; the session cookies come from a real password sign-in of the corpus
 * owner and live only in this process.
 */

type FingerprintRequestState = {
  cookies: Map<string, string>;
  headers: Headers;
};

const REQUEST_KEY = "__ENGINE_FINGERPRINT_REQUEST__";
type GlobalWithRequest = typeof globalThis & { [REQUEST_KEY]?: FingerprintRequestState };

function currentRequest(): FingerprintRequestState {
  const state = (globalThis as GlobalWithRequest)[REQUEST_KEY];
  if (!state) throw new Error("No fingerprint request is open: next/headers is unavailable outside the worker scope.");
  return state;
}

export function openFingerprintRequest(state: FingerprintRequestState) {
  (globalThis as GlobalWithRequest)[REQUEST_KEY] = state;
}

export function closeFingerprintRequest() {
  delete (globalThis as GlobalWithRequest)[REQUEST_KEY];
}

function readOnly(): never {
  throw new Error("Request cookies are read-only in server functions, as in Next.js.");
}

export async function cookies() {
  const state = currentRequest();
  return {
    getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = state.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    has: (name: string) => state.cookies.has(name),
    set: readOnly,
    delete: readOnly,
  };
}

export async function headers() {
  return new Headers(currentRequest().headers);
}

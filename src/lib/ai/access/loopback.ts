// Neither "use client" nor server-only: the page and the server boundary each
// check the loopback address with this one list.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Whether a URL hostname (as `URL.hostname` spells it) is this Mac's loopback address. */
export function isLoopbackHostname(hostname: string) {
  return LOOPBACK.has(hostname);
}

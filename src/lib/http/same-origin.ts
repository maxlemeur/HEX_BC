import "server-only";

import { isLoopbackHostname } from "@/lib/ai/access/loopback";

const hostAuthority = /^(?:[a-z0-9._-]+|\[[a-f0-9:.]+\])(?::\d+)?$/i;

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || !hostAuthority.test(host)) return false;

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost !== null && forwardedHost !== host) return false;

  // Browser-controlled corroboration when Fetch Metadata is available.
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;

  try {
    // Next normalizes loopback hostnames in request.url and can derive its
    // scheme from X-Forwarded-Proto. Our direct loopback listeners use HTTP.
    const directUrl = new URL(`http://${host}`);
    if (isLoopbackHostname(directUrl.hostname)) return origin === directUrl.origin;

    const { protocol } = new URL(request.url);
    if (protocol !== "http:" && protocol !== "https:") return false;
    // Keep the framework's scheme for the browser-origin comparison. It does
    // not attest to the original transport.
    const forwardedProto = request.headers.get("x-forwarded-proto");
    if (forwardedProto !== null && `${forwardedProto}:` !== protocol) return false;
    return origin === new URL(`${protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

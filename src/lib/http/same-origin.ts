import "server-only";

const hostAuthority = /^(?:[a-z0-9._-]+|\[[a-f0-9:.]+\])(?::\d+)?$/i;

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || !hostAuthority.test(host)) return false;

  // Browser-controlled corroboration when Fetch Metadata is available.
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;

  // The direct Next listeners in this app are HTTP. Next normalizes loopback
  // names in request.url and may read a client-supplied X-Forwarded-Proto into it.
  let scheme = "http";
  if (process.env.VERCEL === "1" && (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview")) {
    // Vercel supplies the same public authority in both headers and redirects HTTP at the edge.
    if (request.headers.get("x-forwarded-host") !== host || request.headers.get("x-forwarded-proto") !== "https") return false;
    scheme = "https";
  }

  try {
    return origin === new URL(`${scheme}://${host}`).origin;
  } catch {
    return false;
  }
}

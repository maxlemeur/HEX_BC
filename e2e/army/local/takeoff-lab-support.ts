import { request as httpRequest } from "node:http";
import { createServerClient } from "@supabase/ssr";

// Helpers of the takeoff lab journeys (TI-661 LAB0x, TI-662 VEC01): a local
// account's session cookies as the browser holds them, and requests with an
// explicit Host header (fetch cannot set one) to prove the 127.0.0.1 check.
// Nothing here logs a cookie, a password or a body.

/** Supabase SSR cookies of a local account, as the browser would hold them; nothing is logged. */
export async function labSessionCookies(email: string) {
  const jar = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => { for (const { name, value } of values) jar.set(name, value); } },
  });
  const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error) throw new Error("Lab fixture login failed.");
  return { jar, header: [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ") };
}

export type LabRawRequest = { method: string; path: string; host: string; cookie?: string; body?: unknown; origin?: string; contentType?: string };

/** A request to the local server on 127.0.0.1:`port` with an explicit Host header. */
export function rawLabRequest(port: number, input: LabRawRequest) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = input.body === undefined ? undefined : JSON.stringify(input.body);
    const request = httpRequest({ host: "127.0.0.1", port, method: input.method, path: input.path,
      headers: { host: input.host, ...(input.cookie ? { cookie: input.cookie } : {}), ...(input.origin ? { origin: input.origin } : {}),
        ...(payload ? { "content-type": input.contentType ?? "application/json" } : {}) } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => request.destroy(new Error("Lab request timed out.")));
    request.end(payload);
  });
}

import { NextResponse, type NextRequest } from "next/server";

import { assertLocalChatGptHost, CHATGPT_CALLBACK, CHATGPT_COOKIE, finishLocalChatGptSignIn } from "@/lib/ai/chatgpt-local-auth";
import { chatGptSignInFailure, type ChatGptSignInFailure } from "@/lib/ai/chatgpt-sign-in-errors";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = assertLocalChatGptHost(request.headers.get("host")); }
  catch { return new NextResponse(null, { status: 404 }); }
  let outcome = "connected";
  let reason: ChatGptSignInFailure = "session";
  try {
    const owner = await getAuthenticatedContext();
    reason = "unknown";
    // Next.js can normalize request.url to localhost even for a 127.0.0.1 Host.
    // Rebuild from the strictly checked local Host, preserving the OAuth query.
    const callback = new URL(CHATGPT_CALLBACK, origin);
    callback.search = new URL(request.url).search;
    await finishLocalChatGptSignIn(owner, callback, request.cookies.get(CHATGPT_COOKIE)?.value);
  } catch (error) {
    // OAuth query parameters and provider exceptions can contain credentials.
    outcome = "failed";
    if (reason !== "session") reason = chatGptSignInFailure(error);
    console.warn("chatgpt.sign_in.failed", { reason });
  }
  const result = new URL("/dashboard/profile", origin);
  result.searchParams.set("chatgpt", outcome);
  if (outcome === "failed") result.searchParams.set("chatgpt_error", reason);
  const response = NextResponse.redirect(result, 303);
  response.cookies.set(CHATGPT_COOKIE, "", { path: "/auth/chatgpt/callback", maxAge: 0, httpOnly: true, sameSite: "lax" });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

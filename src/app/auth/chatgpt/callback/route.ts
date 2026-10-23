import { NextResponse, type NextRequest } from "next/server";

import { assertLocalChatGptHost, CHATGPT_COOKIE, finishLocalChatGptSignIn } from "@/lib/ai/chatgpt-local-auth";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = assertLocalChatGptHost(request.headers.get("host")); }
  catch { return new NextResponse(null, { status: 404 }); }
  let outcome = "connected";
  try {
    const owner = await getAuthenticatedContext();
    await finishLocalChatGptSignIn(owner, new URL(request.url), request.cookies.get(CHATGPT_COOKIE)?.value);
  } catch {
    // OAuth query parameters and provider exceptions can contain credentials.
    outcome = "failed";
  }
  const response = NextResponse.redirect(`${origin}/dashboard/profile?chatgpt=${outcome}`, 303);
  response.cookies.set(CHATGPT_COOKIE, "", { path: "/auth/chatgpt/callback", maxAge: 0, httpOnly: true, sameSite: "lax" });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

"use client";

import { isLoopbackHostname } from "@/lib/ai/access/loopback";

export function currentPageUrl(): URL {
  return new URL(window.location.href);
}

/** Whether the page was opened on this Mac's loopback address: only there may a key be typed (it travels to the server). */
export function isLoopbackPage(url: URL = currentPageUrl()) {
  return isLoopbackHostname(url.hostname);
}

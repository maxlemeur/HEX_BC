"use client";

/** The address of the page as the browser shows it. */
export function currentPageUrl(): URL {
  return new URL(window.location.href);
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Whether the page was opened on this Mac's loopback address: only there may a key be typed (it travels to the server). */
export function isLoopbackPage(url: URL = currentPageUrl()) {
  return LOOPBACK.has(url.hostname);
}

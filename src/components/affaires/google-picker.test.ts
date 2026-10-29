import { afterEach, describe, expect, it, vi } from "vitest";

describe("Google Picker loading", () => {
  afterEach(() => {
    document.querySelectorAll('script[src="https://apis.google.com/js/api.js"]').forEach((script) => script.remove());
    vi.useRealTimers();
    vi.resetModules();
  });

  it("does not leave the user waiting forever when the Google script never loads", async () => {
    vi.useFakeTimers();
    const { openGooglePicker } = await import("./google-picker");
    let rejected = false;
    void openGooglePicker({ accessToken: "fixture-token", apiKey: "fixture-key", projectNumber: "123" })
      .catch(() => { rejected = true; });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(rejected).toBe(true);
    expect(document.querySelector('script[src="https://apis.google.com/js/api.js"]')).toBeNull();
  });
});

// Guard of TesterArmy writing campaigns on a remote Supabase
// (scripts/tester-army/shared-write-guard.mjs, AGENTS.md "Runtime and workspaces").
//
// From 02/10 to 18/10/2026 direct `run-tester-army.mjs` campaigns created 510
// affaires in the shared base, which is also production's: its journeys keep
// what they create, and a .env file pointed them there by default. Pinned below:
// 1. a writing run on a remote host is refused without an acknowledgement;
// 2. only the exact host acknowledges it, never another one or an empty value;
// 3. loopback stacks and runs that write nothing are never asked for it.
// The runner's own refusal, and an acknowledgement coming only from a .env
// file, run in scripts/tester-army/check-setup-archive.mjs ("shared-write-refusal").
import { describe, expect, it } from "vitest";

import {
  SHARED_WRITE_ACKNOWLEDGEMENT,
  assertSharedWriteAcknowledged,
} from "../../scripts/tester-army/shared-write-guard.mjs";

const sharedHost = "shared-project.supabase.co";

describe("TesterArmy shared-base write guard", () => {
  it("refuses a writing run on a remote host without an acknowledgement", () => {
    expect(() =>
      assertSharedWriteAcknowledged({ hostname: sharedHost, writes: true, acknowledgement: undefined })
    ).toThrow(`${SHARED_WRITE_ACKNOWLEDGEMENT}=${sharedHost}`);
  });

  it("accepts only the exact remote host as acknowledgement", () => {
    for (const acknowledgement of ["", " ", "1", "true", "other-project.supabase.co", `${sharedHost}.example.test`]) {
      expect(() => assertSharedWriteAcknowledged({ hostname: sharedHost, writes: true, acknowledgement }), acknowledgement)
        .toThrow("never delete their data");
    }
    expect(() =>
      assertSharedWriteAcknowledged({ hostname: sharedHost, writes: true, acknowledgement: ` ${sharedHost.toUpperCase()} ` })
    ).not.toThrow();
  });

  it("never asks loopback stacks or runs that write nothing", () => {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
      expect(() => assertSharedWriteAcknowledged({ hostname, writes: true, acknowledgement: undefined })).not.toThrow();
    }
    expect(() => assertSharedWriteAcknowledged({ hostname: sharedHost, writes: false, acknowledgement: undefined })).not.toThrow();
  });
});

import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3000" })) }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: () => true, assertLocalChatGptHost: () => undefined, hasLocalChatGptPlanAccess: () => true,
}));

import { readTakeoffExecution } from "@/lib/takeoff/resume-viewer-server";

const member = { userId: "11111111-1111-4111-8111-111111111111", tenantId: "10000000-0000-4000-8000-000000000001" };

// Fix round 1, point 8: reading what a member may do never writes the Mac's private directory or its identifier.
describe("readTakeoffExecution", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "takeoff-execution-"));
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(workspace, { recursive: true, force: true });
  });

  it("finds no Mac where none was ever set up, and creates nothing", async () => {
    expect(await readTakeoffExecution(member)).toEqual({ hostId: null, planStatus: null });
    expect(await readdir(workspace)).toEqual([]);
  });

  it("reads the Mac's identifier where it exists", async () => {
    const directory = path.join(workspace, ".private", "chatgpt-local");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "host.json"), JSON.stringify("urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(await readTakeoffExecution(member)).toMatchObject({ hostId: "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(await readdir(directory)).toEqual(["host.json"]);
  });
});

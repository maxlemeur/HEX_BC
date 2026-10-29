import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const reference = vi.hoisted(() => ({ backend: undefined as unknown }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () =>
    (reference.backend as ReturnType<typeof memoryBackend>).supabase,
}));
import { memoryBackend, fakeDrive } from "./memory.test-utils";
import { driveConfiguration } from "./secrets";
import {
  saveDriveConnection,
  readDriveAuthorizationGeneration,
  listDriveConnections,
  disableDriveWriting,
  driveWriteToken,
  disconnectDriveConnection,
} from "./connections";

describe("one Google account with optional writing (Google simulated)", () => {
  let backend: ReturnType<typeof memoryBackend>;
  const config = () =>
    driveConfiguration() as Extract<
      ReturnType<typeof driveConfiguration>,
      { enabled: true }
    >;
  const account = {
    permissionId: "account_demo",
    emailAddress: "fixture@example.invalid",
    displayName: "Fixture",
  };
  const grant = {
    refreshToken: "read-refresh",
    accessToken: "read-access",
    expiresAt: 0,
  };
  const save = async (
    identity = account,
    purpose: "read" | "write" = "read",
    generation?: string,
  ) =>
    saveDriveConnection(
      backend.access.context,
      config(),
      identity,
      {
        ...grant,
        ...(purpose === "write"
          ? { refreshToken: "write-refresh", accessToken: "write-access" }
          : {}),
      },
      {
        purpose,
        generation:
          generation ??
          (await readDriveAuthorizationGeneration(backend.access.context)),
      },
    );
  beforeEach(() => {
    backend = memoryBackend();
    reference.backend = backend;
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_ENABLED", "true");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_ID", "fixture-client");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_SECRET", "fixture-secret");
    vi.stubEnv(
      "MERGEONE_GOOGLE_DRIVE_TOKEN_KEY",
      Buffer.alloc(32, 4).toString("base64"),
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-role");
    vi.stubGlobal("fetch", fakeDrive().fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("defaults to read and rejects a second Google identity without replacing the first", async () => {
    const id = await save();
    const first = (await listDriveConnections(backend.access.context))[0];
    expect(first).toMatchObject({ id, writeEnabled: false });
    await expect(
      save({ ...account, permissionId: "other_account" }),
    ).rejects.toMatchObject({ code: "DRIVE_SINGLE_ACCOUNT" });
    expect(await listDriveConnections(backend.access.context)).toEqual([first]);
    await expect(
      driveWriteToken(config(), id, backend.access.context, first.grantVersion),
    ).rejects.toMatchObject({ code: "DRIVE_WRITE_DISABLED" });
  });
  it("keeps the read connection while enabling writing for the same account only", async () => {
    const id = await save();
    const readSecret = backend
      .rows("google_drive_connection_secrets")
      .get(id)!.refresh_token_ciphertext;
    await expect(
      save({ ...account, permissionId: "other_account" }, "write"),
    ).rejects.toMatchObject({ code: "DRIVE_SINGLE_ACCOUNT" });
    expect(await save(account, "write")).toBe(id);
    expect(
      backend.rows("google_drive_connection_secrets").get(id)!
        .refresh_token_ciphertext,
    ).toBe(readSecret);
    expect(
      (await listDriveConnections(backend.access.context))[0],
    ).toMatchObject({ id, writeEnabled: true });
  });
  it("disables writing and prevents an older OAuth return from restoring it", async () => {
    const id = await save();
    await save(account, "write");
    const displayed = (await listDriveConnections(backend.access.context))[0];
    const oldGeneration = await readDriveAuthorizationGeneration(
      backend.access.context,
    );
    await disableDriveWriting(
      backend.access.context,
      id,
      displayed.grantVersion,
    );
    expect(
      (await listDriveConnections(backend.access.context))[0],
    ).toMatchObject({ writeEnabled: false });
    await expect(save(account, "write", oldGeneration)).rejects.toMatchObject({
      code: "DRIVE_AUTHORIZATION_EXPIRED",
    });
    await expect(
      disableDriveWriting(backend.access.context, id, displayed.grantVersion),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects an older removal after reconnection and a late OAuth return after removal", async () => {
    const id = await save();
    const old = (await listDriveConnections(backend.access.context))[0];
    await save();
    await expect(
      disconnectDriveConnection(backend.access.context, id, old.grantVersion),
    ).rejects.toMatchObject({ status: 409 });
    const current = (await listDriveConnections(backend.access.context))[0];
    const generation = await readDriveAuthorizationGeneration(
      backend.access.context,
    );
    await disconnectDriveConnection(
      backend.access.context,
      id,
      current.grantVersion,
    );
    await expect(save(account, "read", generation)).rejects.toMatchObject({
      code: "DRIVE_AUTHORIZATION_EXPIRED",
    });
    expect(await listDriveConnections(backend.access.context)).toEqual([]);
  });
  it("returns to reading when Google revokes the write grant after a read reconnection", async () => {
    const id = await save();
    await save(account, "write");
    // A stale cached access token must not hide a revoked refresh token after
    // reconnection. Explicit disabling and stale generations are covered above.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      access_token: "previous-write-access",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/drive.file",
    })));
    const before = (await listDriveConnections(backend.access.context))[0];
    await expect(driveWriteToken(config(), id, backend.access.context, before.grantVersion))
      .resolves.toBe("previous-write-access");
    await save();
    const displayed = (await listDriveConnections(backend.access.context))[0];
    expect(displayed.writeEnabled).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 })));
    await expect(driveWriteToken(config(), id, backend.access.context, displayed.grantVersion))
      .rejects.toMatchObject({ code: "DRIVE_RECONNECT" });
    expect((await listDriveConnections(backend.access.context))[0]).toMatchObject({ writeEnabled: false, status: "active" });
    expect(backend.rows("google_drive_connection_secrets").get(id)!.write_refresh_token_ciphertext).toBeNull();
  });
});

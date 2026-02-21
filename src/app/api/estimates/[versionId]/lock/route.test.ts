import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/locks", () => ({
  acquireLock: vi.fn(),
  renewLock: vi.fn(),
  releaseLock: vi.fn(),
}));

import {
  DELETE,
  PATCH,
  POST,
} from "@/app/api/estimates/[versionId]/lock/route";
import { conflict, forbidden } from "@/lib/estimates/errors";
import { acquireLock, releaseLock, renewLock } from "@/lib/estimates/locks";

const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("estimate lock route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 when lock is acquired", async () => {
    vi.mocked(acquireLock).mockResolvedValue({
      lock: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version_id: VERSION_ID,
      },
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/lock`, {
      method: "POST",
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(vi.mocked(acquireLock)).toHaveBeenCalledWith(VERSION_ID);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          lock: expect.objectContaining({
            version_id: VERSION_ID,
          }),
        }),
      })
    );
  });

  it("returns 400 when versionId is invalid", async () => {
    const request = new Request("http://localhost/api/estimates/not-a-uuid/lock", {
      method: "POST",
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: "not-a-uuid" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      })
    );
    expect(vi.mocked(acquireLock)).not.toHaveBeenCalled();
  });

  it("forwards force=1 to renew", async () => {
    vi.mocked(renewLock).mockResolvedValue({
      lock: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        version_id: VERSION_ID,
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/lock?force=1`,
      {
        method: "PATCH",
      }
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(renewLock)).toHaveBeenCalledWith(VERSION_ID, {
      force: true,
    });
  });

  it("forwards force=false by default to release", async () => {
    vi.mocked(releaseLock).mockResolvedValue({
      released: true,
      lock: null,
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/lock`, {
      method: "DELETE",
    });

    const response = await DELETE(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(releaseLock)).toHaveBeenCalledWith(VERSION_ID, {
      force: false,
    });
  });

  it("returns 400 when force query param is invalid", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/lock?force=maybe`,
      {
        method: "DELETE",
      }
    );

    const response = await DELETE(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "BAD_REQUEST",
          message: "Parametre force invalide.",
        }),
      })
    );
    expect(vi.mocked(releaseLock)).not.toHaveBeenCalled();
  });

  it("maps conflicts and forbidden errors", async () => {
    vi.mocked(acquireLock).mockRejectedValue(
      conflict("Cette version est deja verrouillee par un autre utilisateur.", {
        lock: {
          user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        },
      })
    );

    const postRequest = new Request(`http://localhost/api/estimates/${VERSION_ID}/lock`, {
      method: "POST",
    });

    const postResponse = await POST(postRequest, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const postPayload = await postResponse.json();

    expect(postResponse.status).toBe(409);
    expect(postPayload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "CONFLICT",
        }),
      })
    );

    vi.mocked(renewLock).mockRejectedValue(
      forbidden("Seuls les admins peuvent forcer le verrou de brouillon.")
    );

    const patchRequest = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/lock?force=1`,
      {
        method: "PATCH",
      }
    );

    const patchResponse = await PATCH(patchRequest, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const patchPayload = await patchResponse.json();

    expect(patchResponse.status).toBe(403);
    expect(patchPayload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "FORBIDDEN",
        }),
      })
    );
  });
});

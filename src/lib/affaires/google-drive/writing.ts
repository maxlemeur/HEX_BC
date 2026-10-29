import "server-only";
import { driveWriteToken, forgetDriveAccess, type DriveMember } from "./connections";
import type { DriveConnectionRequest } from "./contracts";
import { DriveError } from "./errors";
import type { DriveConfiguration } from "./secrets";
import { z } from "zod";

export async function writeDriveFile(
  member: DriveMember,
  configuration: Extract<DriveConfiguration, { enabled: true }>,
  input: Extract<DriveConnectionRequest, { action: "rename" | "comment" }>,
  signal: AbortSignal,
) {
  signal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const authorization = await driveWriteToken(
    configuration,
    input.connectionId,
    member,
    input.grantVersion,
    signal,
  );
  const fileUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}`;
  const query = new URLSearchParams({
    fields: "capabilities(canRename,canComment)",
    supportsAllDrives: "true",
  });
  const metadata = await fetch(`${fileUrl}?${query}`, {
    headers: { Authorization: `Bearer ${authorization}` },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!metadata.ok) {
    await metadata.body?.cancel();
    if (metadata.status === 401) {
      forgetDriveAccess(input.connectionId);
      throw new DriveError(401, "DRIVE_RECONNECT", "L’accès Google a expiré. Réessayez pour renouveler l’autorisation.");
    }
    throw new DriveError(
      422,
      "DRIVE_WRITE_FORBIDDEN",
      "Ce fichier n’est pas accessible avec le droit d’écriture choisi.",
    );
  }
  const file = z
    .object({
      capabilities: z.object({
        canRename: z.boolean().optional(),
        canComment: z.boolean().optional(),
      }),
    })
    .parse(await metadata.json());
  if (
    !(input.action === "comment"
      ? file.capabilities.canComment
      : file.capabilities.canRename)
  )
    throw new DriveError(
      403,
      "DRIVE_WRITE_FORBIDDEN",
      "Google n’autorise pas cette opération sur ce fichier.",
    );
  // Check again after the potentially slow metadata request. A request already
  // dispatched cannot be undone when another tab disables writing meanwhile.
  const current = await driveWriteToken(
    configuration,
    input.connectionId,
    member,
    input.grantVersion,
    signal,
  );
  const url =
    input.action === "comment"
      ? `${fileUrl}/comments?fields=id`
      : `${fileUrl}?supportsAllDrives=true&fields=id`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: input.action === "comment" ? "POST" : "PATCH",
      headers: {
        Authorization: `Bearer ${current}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        input.action === "comment"
          ? { content: input.content }
          : { name: input.name },
      ),
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    throw new DriveError(
      422,
      "DRIVE_WRITE_UNKNOWN",
      "Le résultat de l’opération n’a pas pu être confirmé. Vérifiez le fichier dans Google Drive avant de réessayer.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status >= 500 || response.status === 408)
      throw new DriveError(
        422,
        "DRIVE_WRITE_UNKNOWN",
        "Le résultat de l’opération n’a pas pu être confirmé. Vérifiez le fichier dans Google Drive avant de réessayer.",
      );
    throw new DriveError(
      422,
      "DRIVE_WRITE_FAILED",
      "Google a refusé l’opération. Vérifiez le fichier et vos droits avant de réessayer.",
    );
  }
  await response.body?.cancel();
  return { done: true };
}

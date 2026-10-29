import { createHash } from "node:crypto";

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex").toLowerCase();
}

export function canonicalJsonHash(value: unknown) {
  return sha256(JSON.stringify(value));
}

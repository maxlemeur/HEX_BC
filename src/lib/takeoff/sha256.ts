import { createHash } from "node:crypto";

/** The SHA-256 of a text (UTF-8) or of bytes, as lower-case hex. */
export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

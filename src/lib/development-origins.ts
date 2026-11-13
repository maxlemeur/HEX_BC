import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/** Explicit development-resource origins; never authorize arbitrary browser sites. */
export function resolveDevelopmentOrigins(
  interfaces = networkInterfaces(),
  extraHosts = process.env.MERGEONE_DEV_HOSTS ?? "",
): string[] {
  const origins = new Set(["127.0.0.1", "[::1]"]);
  for (const entries of Object.values(interfaces)) {
    for (const { address } of entries ?? []) {
      if (isIP(address) === 4) origins.add(address);
      if (isIP(address) === 6) origins.add(`[${address}]`);
    }
  }
  for (const raw of extraHosts.split(",")) {
    const host = raw.trim().toLowerCase();
    if (!host) continue;
    const address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (isIP(address) === 6) {
      origins.add(`[${address}]`);
      continue;
    }
    if (host.length > 253 || !host.split(".").every(label =>
      label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
      throw new Error("MERGEONE_DEV_HOSTS doit contenir des noms d’hôte exacts séparés par des virgules, sans protocole, port ni joker.");
    }
    origins.add(host);
  }
  return [...origins].sort();
}

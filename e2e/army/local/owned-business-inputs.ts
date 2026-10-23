// Paths are supplied by the owned native campaign. Never reuse an old output.
export function requiredFixturePath(variable: string) {
  const value = process.env[variable];
  if (!value) throw new Error(`A fresh native fixture is required: ${variable}`);
  return value;
}

export function isOwnedLoopback(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && !!url.port &&
      !["45585", "33485"].includes(url.port) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

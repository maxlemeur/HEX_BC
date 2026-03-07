import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DIRECTION_DEBUG_LOG_PATH = path.join(
  process.cwd(),
  ".next",
  "dev",
  "logs",
  "direction-debug.log"
);

export async function writeDirectionDebugLog(
  scope: "route" | "server",
  message: string
) {
  const line = `[${new Date().toISOString()}] [direction-${scope}] ${message}\n`;

  console.log(line.trimEnd());

  try {
    await mkdir(path.dirname(DIRECTION_DEBUG_LOG_PATH), { recursive: true });
    await appendFile(DIRECTION_DEBUG_LOG_PATH, line, "utf8");
  } catch {
    // Keep debug logging best-effort; never break the page because of it.
  }
}

export { DIRECTION_DEBUG_LOG_PATH };

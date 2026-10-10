import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

const names = ["E2E_LOGIN_PASSWORD", "E2E_LOGIN_EMAIL"];
const values = names.map((name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required report-safety credential: " + name);
  return value;
});
const needles = values.flatMap((value) => [
  value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value),
]).map((value) => Buffer.from(value));

function check(bytes) {
  if (needles.some((needle) => Buffer.from(bytes).includes(needle))) {
    throw new Error("Login credential detected in a Playwright artifact; upload blocked.");
  }
}

async function inspect(file) {
  let info;
  try { info = await fs.lstat(file); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (info.isSymbolicLink()) throw new Error("Report artifacts must not be symlinks.");
  if (info.isDirectory()) {
    for (const entry of await fs.readdir(file)) await inspect(path.join(file, entry));
    return;
  }
  if (!/\.(html|json|md|txt|log)$/i.test(file)) return;
  const bytes = await fs.readFile(file);
  check(bytes);
  if (path.extname(file).toLowerCase() !== ".html") return;
  const text = bytes.toString("utf8");
  const match = text.match(/<template id="playwrightReportBase64">data:application\/zip;base64,([\s\S]*?)<\/template>/);
  if (!match) throw new Error("Playwright HTML report has no inspectable embedded ZIP.");
  const files = unzipSync(Buffer.from(match[1], "base64"), {
    filter: (entry) => {
      if (entry.originalSize > 32 * 1024 * 1024) throw new Error("Report entry exceeds the safety limit.");
      return true;
    },
  });
  for (const content of Object.values(files)) check(content);
}

try {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) throw new Error("Provide report paths to inspect.");
  for (const input of inputs) await inspect(input);
  process.stdout.write("Playwright artifacts contain no login credentials.\n");
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}

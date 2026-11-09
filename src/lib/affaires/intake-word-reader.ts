import "server-only";

import { spawn } from "node:child_process";
import { validateXlsxArchiveBudget } from "@/lib/affaires/intake-office-archive";
import { WORD_READER_PROGRAM } from "@/lib/affaires/intake-word-program";

export const WORD_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const WORD_MESSAGES = {
  WORD_INVALID: "Le fichier Word est invalide ou corrompu. Réenregistrez-le en DOCX ou exportez-le en PDF.",
  WORD_PROTECTED: "Le fichier Word est protégé ou chiffré. Retirez son mot de passe avant de relancer.",
  WORD_EMPTY: "Le fichier Word ne contient pas de texte lisible. Exportez-le en PDF si son contenu est constitué d’images.",
  WORD_TOO_LARGE: "Le fichier Word dépasse la limite d’analyse de 10 Mo. Réduisez-le ou exportez les pages utiles en PDF.",
  WORD_LIMIT: "Le fichier Word dépasse les limites de décompression ou de lecture. Réenregistrez-le ou utilisez un export PDF.",
  WORD_TIMEOUT: "La lecture du fichier Word a dépassé le délai autorisé. Réenregistrez-le ou utilisez un export PDF.",
} as const;
export class WordReadError extends Error {
  constructor(readonly code: keyof typeof WORD_MESSAGES) { super(WORD_MESSAGES[code]); this.name = "WordReadError"; }
}
export function isWordFile(fileName: string, mimeType: string) {
  return /\.(doc|docx)$/i.test(fileName.trim()) || ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mimeType);
}

/** Bounds input/output, V8 heap and elapsed time; no source file or document text is written to disk. */
export async function readWordText(bytes: ArrayBuffer): Promise<{ text: string; truncated: boolean }> {
  if (bytes.byteLength > WORD_MAX_INPUT_BYTES) throw new WordReadError("WORD_TOO_LARGE");
  const input = Buffer.from(bytes);
  const ole = input.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  const zip = input.length >= 4 && input.readUInt32LE(0) === 0x04034b50;
  if (!ole && !zip) throw new WordReadError("WORD_INVALID");
  if (zip) {
    try { validateXlsxArchiveBudget(input); } catch (error) {
      const message = error instanceof Error ? error.message : "";
      throw new WordReadError(/chiffr/i.test(message) ? "WORD_PROTECTED" : /budget|depasse|decompression|ratio/i.test(message) ? "WORD_LIMIT" : "WORD_INVALID");
    }
  }
  const child = spawn(process.execPath, ["--max-old-space-size=128", "-e", WORD_READER_PROGRAM, require.resolve("word-extractor")], {
    stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "development" },
  });
  return new Promise((resolve, reject) => {
    let output = ""; let outputBytes = 0; let failure: WordReadError | null = null; let settled = false;
    const timer = setTimeout(() => { failure = new WordReadError("WORD_TIMEOUT"); child.kill("SIGKILL"); }, 10_000);
    const fail = (error: WordReadError) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > 128_000) { failure = new WordReadError("WORD_LIMIT"); child.kill("SIGKILL"); }
      else output += chunk;
    });
    child.once("error", () => fail(new WordReadError("WORD_INVALID")));
    child.stdin.on("error", () => undefined);
    child.once("close", (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      if (failure) return fail(failure);
      if (code !== 0) return fail(new WordReadError(signal === "SIGABRT" || signal === "SIGKILL" ? "WORD_LIMIT" : "WORD_INVALID"));
      try {
        const result = JSON.parse(output);
        if (typeof result.error === "string" && Object.hasOwn(WORD_MESSAGES, result.error)) return fail(new WordReadError(result.error as keyof typeof WORD_MESSAGES));
        if (typeof result.text !== "string" || !result.text.trim() || result.text.length > 12000 || typeof result.truncated !== "boolean") return fail(new WordReadError("WORD_INVALID"));
        settled = true; resolve({ text: result.text, truncated: result.truncated });
      } catch { fail(new WordReadError("WORD_INVALID")); }
    });
    child.stdin.end(input);
  });
}

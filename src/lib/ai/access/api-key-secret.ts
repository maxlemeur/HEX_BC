import "server-only";

import { timingSafeEqual } from "node:crypto";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";

// An API key in server memory. Its value leaves only through `reveal`, called
// by the OpenAI adapter for the Authorization header of a request to its fixed
// origin, and by the Keychain store for its write. Printing it (string, JSON,
// util.inspect, an error report) shows a placeholder.

// OpenAI keys: « sk- », « sk-proj- », « sk-svcacct- »… then letters, digits, « - » and « _ ».
// The narrow alphabet also keeps any value out of the shell-like syntax of `security -i`.
const OPENAI_KEY = /^sk-[A-Za-z0-9_-]{20,500}$/;
const PLACEHOLDER = "[clé API masquée]";

export type ApiKeySecretUse = "openai-request" | "keychain-write";

export class ApiKeySecret {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /** A key as a person pasted it: surrounding blanks removed, nothing else. */
  static parseOpenAi(input: unknown): ApiKeySecret {
    const value = typeof input === "string" ? input.trim() : "";
    if (!OPENAI_KEY.test(value)) throw new ApiKeyError("AI_KEY_FORMAT");
    return new ApiKeySecret(value);
  }

  /** A key read back from the Keychain; anything else there is not ours. */
  static fromStore(value: string): ApiKeySecret | null {
    return OPENAI_KEY.test(value) ? new ApiKeySecret(value) : null;
  }

  /** The last four characters, as OpenAI shows them. */
  get suffix() {
    return this.#value.slice(-4);
  }

  reveal(use: ApiKeySecretUse): string {
    void use;
    return this.#value;
  }

  /** The text with every occurrence of this key replaced: provider text that echoes it never leaves the adapter. */
  maskIn(text: string, mask: string): string {
    return text.split(this.#value).join(mask);
  }

  equals(other: ApiKeySecret) {
    const left = Buffer.from(this.#value);
    const right = Buffer.from(other.#value);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  toString() {
    return PLACEHOLDER;
  }

  toJSON() {
    return PLACEHOLDER;
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return PLACEHOLDER;
  }
}

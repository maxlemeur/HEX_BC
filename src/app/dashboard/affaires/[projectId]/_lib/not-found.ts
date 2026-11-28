import { notFound } from "next/navigation";

/**
 * The failure of an affaire read: an error coded NOT_FOUND (an unknown affaire, or one of another
 * tenant) renders the 404, any other one is thrown again.
 */
export function notFoundOrRethrow(error: unknown): never {
  if (error !== null && typeof error === "object" && "code" in error && (error as { code: string }).code === "NOT_FOUND") {
    notFound();
  }
  throw error;
}

import path from "node:path";

export type BusinessCorpusSelection = {
  mode: "public" | "private";
  identity: string;
  root: string;
  journeyEnvironment: Record<string, string>;
};

/** Pure routing shared by the supervisor and journey fixtures; never loads corpus files. */
export function selectBusinessCorpus(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd()
): BusinessCorpusSelection {
  const mode = environment.E2E_BUSINESS_CORPUS ?? "public";
  if (mode !== "public" && mode !== "private") throw new Error("E2E_BUSINESS_CORPUS must be public or private.");
  const privateRoot = environment.E2E_BUSINESS_PRIVATE_ROOT;
  if (mode === "private" && !privateRoot) throw new Error("The private corpus requires E2E_BUSINESS_PRIVATE_ROOT; no public fallback is allowed.");
  const root = mode === "public"
    ? path.resolve(workingDirectory, "e2e/fixtures/business")
    : path.resolve(workingDirectory, privateRoot!);
  return {
    mode,
    identity: mode === "public" ? "fictional-business-corpus-1" : "private-original-business-corpus",
    root,
    journeyEnvironment: {
      E2E_BUSINESS_CORPUS: mode,
      ...(mode === "private" ? { E2E_BUSINESS_PRIVATE_ROOT: root } : {}),
    },
  };
}

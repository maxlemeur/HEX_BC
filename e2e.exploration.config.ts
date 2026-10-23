import path from "node:path";
import type { E2EConfig } from "e2e";
import { chatgpt } from "e2e/oauth/chatgpt";
import base from "./e2e.config";

if (process.env.E2E_ARMY_EXPLORATION_OWNED !== "1" || process.env.E2E_ARMY_SUITE !== "critical") {
  throw new Error("Use npm run e2e:army:explore on its owned ephemeral stack.");
}
const output = path.resolve(process.env.E2E_ARMY_EXPLORATION_OUTPUT ?? "");
if (!output.startsWith(path.resolve(".e2e/army/exploration") + path.sep)) throw new Error("Exploration output escaped the owned campaign.");
const persona = (role: string) => ({
  model: chatgpt(process.env.E2E_ARMY_MODEL ?? "gpt-6-luna"), maxSteps: 10, maxModelCalls: 10,
  system: `${role} Navigate using the visible interface and verify the destination. Read only: never create, edit, delete, submit, upload, send, approve or follow an external link.`,
  context: "MergeOne est une application française de chiffrage. Une affaire regroupe les pièces et devis ; les métrés analysent les plans ; Produits & prix de référence est le catalogue. La session ARMY est déjà connectée à une base locale jetable.",
});
export default {
  ...base, projectId: "mergeone-business-exploration", output, workers: 1, retries: 0, cache: "off", trace: "off",
  tests: ["e2e/army/critical/auth.setup.e2e.ts", "e2e/army/exploration/business-personas.e2e.ts"],
  agents: { estimator: persona("You are a new estimator."), purchaser: persona("You prepare purchases."), reviewer: persona("You review technical dossiers.") },
} satisfies E2EConfig;

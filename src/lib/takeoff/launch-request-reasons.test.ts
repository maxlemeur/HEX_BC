import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  describeTakeoffLaunchReason, describeTakeoffLaunchReasonWithKey, TAKEOFF_LAUNCH_DOSSIER_REASONS, TAKEOFF_LAUNCH_MANDATE_REASONS, TAKEOFF_LAUNCH_TRANSIENT_REASONS,
} from "@/lib/takeoff/launch-request";

// The reasons a launch request waits on are decided in SQL (the claim, the allowed gesture) and shown by the server:
// the TypeScript lists are the latest migration's definition (20261121170448_takeoff_launch_requests.sql, replaced by
// later ones such as 20261121230719_takeoff_item_lists.sql), in the same order, so that a reason added to one is added
// to the other.
const directory = path.resolve("supabase/migrations");
const migrations = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()
  .map((file) => readFileSync(path.join(directory, file), "utf8"));
function sqlList(name: string) {
  const pattern = new RegExp(`create (?:or replace )?function private\\.${name}\\(\\) returns text\\[\\][^$]*\\$\\$\\s*select array\\[([^\\]]*)\\]`);
  const body = migrations.map((migration) => pattern.exec(migration)).filter(Boolean).at(-1);
  if (!body) throw new Error(`${name} not found in the migrations.`);
  return [...body[1].matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
}

describe("launch request reasons", () => {
  it.each([
    ["takeoff_launch_mandate_reasons", TAKEOFF_LAUNCH_MANDATE_REASONS],
    ["takeoff_launch_dossier_reasons", TAKEOFF_LAUNCH_DOSSIER_REASONS],
    ["takeoff_launch_transient_reasons", TAKEOFF_LAUNCH_TRANSIENT_REASONS],
  ])("lists %s as the migration does", (name, list) => {
    expect([...list]).toEqual(sqlList(name));
  });
});

// A request is taken on or resumed with the plan or with a personal key (the gesture's own label says which): a reason
// that tells the member to resume names neither. The reasons about ChatGPT itself keep naming the plan.
describe("what a launch request's reason tells the member to do", () => {
  it.each([
    ["MANDATE_REQUIRED", "Métré non démarré — la confirmation du dossier n’a engagé aucun forfait ChatGPT. Un métreur peut le prendre en charge."],
    ["LOCAL_RUNTIME_REQUIRED", "Métré non démarré — ouvrez MergeOne sur le Mac connecté, puis reprenez la demande."],
    ["EVALUATION_FAILED", "Métré non démarré — la vérification du dossier a échoué plusieurs fois. Reprenez la demande pour réessayer."],
    ["PAYER_NOT_ELIGIBLE", "Métré non démarré — la personne qui devait payer ne peut plus lancer de métré sur cette affaire. Un métreur peut le prendre en charge."],
  ] as const)("names no payment source for %s", (reason, message) => {
    expect(describeTakeoffLaunchReason(reason)).toBe(message);
    expect(message).not.toMatch(/votre forfait|avec le sien/);
  });

  it.each(["CHATGPT_NOT_CONNECTED", "CHATGPT_SELECTION_CHANGED"] as const)("keeps naming the plan for %s, which is about it", (reason) => {
    expect(describeTakeoffLaunchReason(reason)).toMatch(/reprenez avec votre forfait/i);
  });

  // Beside a gesture that reads « Reprendre avec ma clé API », the same reason does not tell the member to resume with a plan.
  it.each([
    ["CHATGPT_NOT_CONNECTED", "Métré non démarré — forfait ChatGPT non connecté. Reprenez la demande avec la source IA choisie."],
    ["CHATGPT_SELECTION_CHANGED", "Métré non démarré — le compte, le modèle ou l’effort ChatGPT a changé depuis la confirmation. "
      + "Reprenez la demande pour confirmer les réglages affichés."],
  ] as const)("tells a member who chose their key to resume %s without naming a plan to resume with", (reason, message) => {
    expect(describeTakeoffLaunchReasonWithKey(reason)).toBe(message);
    expect(message).not.toMatch(/avec votre forfait/);
  });

  it("reads the same with either source for every other reason", () => {
    for (const reason of ["MANDATE_REQUIRED", "LOCAL_RUNTIME_REQUIRED", "API_KEY_CONNECTION_CHANGED", "BUDGET_EXHAUSTED", null, "unknown"]) {
      expect(describeTakeoffLaunchReasonWithKey(reason)).toBeNull();
    }
  });
});

import {
  createEmptyTakeoffPreparation,
  createTakeoffPreparationSnapshot,
  takeoffPreparationSourceSchema,
} from "@/lib/takeoff/preparation";

/** Confirmed gate fixture for tests focused on creation, compensation and engine parity. */
export function confirmedPreparationFixture() {
  const preparation = createEmptyTakeoffPreparation();
  preparation.objective = "extract_quantities";
  preparation.objective_confirmed = true;
  preparation.scope.inclusions = ["Quantités documentaires du dossier fictif"];
  preparation.scope.exclusions = ["Variantes non retenues"];
  preparation.scope.confirmed = true;
  preparation.sources = [takeoffPreparationSourceSchema.parse({
    document_id: "fixture-document",
    document_name: "Quantités fictives.csv",
    kind: "other",
    revision: "A",
    source_version: "fixture-a",
    pages: [],
    active: true,
    confirmed: true,
  })];
  preparation.conventions.unit = "u";
  preparation.conventions.confirmed = true;
  preparation.destination.confirmed = true;
  return createTakeoffPreparationSnapshot({
    preparation,
    confirmedBy: "11111111-1111-4111-8111-111111111111",
    confirmedAt: "2026-10-29T00:00:00.000Z",
    revision: 1,
  });
}

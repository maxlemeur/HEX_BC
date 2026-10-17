import { describe, expect, it } from "vitest";

import { controlCents } from "../../scripts/engine-v3/optima-control";

// Lot 2, sous-lot 2.4 (docs/testing/estimate-engine-v3-2.4.md) : les cellules de contrôle OPTIMA
// (« Prix Unitaire », « Prix Total ») sont lues aux 15 chiffres significatifs d'Excel, puis
// arrondies au centime, demi supérieur, comme ARRONDI(…;2). Isolation justifiée : demi-centimes
// au-delà de 10 000 € qu'aucun classeur versionné ne contient.
describe("OPTIMA control cells (Excel 15 significant digits, then half up to the cent)", () => {
  it.each([
    [17459.995, 1_746_000],
    [12345.675, 1_234_568],
    [48310.555, 4_831_056],
    [0.1 + 0.2, 30],
    [166.63, 16_663],
    [1.005, 101],
    [2.675, 268],
  ])("%s € gives %s c", (value, cents) => {
    expect(controlCents(value)).toBe(cents);
  });
});

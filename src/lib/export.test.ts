import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser-download", () => ({ downloadBlob: vi.fn() }));

import { downloadBlob } from "@/lib/browser-download";
import { writeEstimateV3Csv } from "@/lib/estimates/v3-csv-export";
import { exportToCSV } from "@/lib/export";

// CSV is opened by spreadsheet software outside the browser journey. Assert the
// actual serialized bytes: a leading formula (also after whitespace/control
// characters) must be inert, while ordinary text and numeric cells survive.
describe("CSV spreadsheet boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("neutralizes formula-leading v3 text without changing numeric cells", () => {
    const csv = writeEstimateV3Csv([
      ["Désignation", "Quantité"],
      ["=1+1", 2],
      ["\t@SUM(1)", 3],
      ["Normal; libellé", 4],
    ]);

    expect(csv).toContain("'=1+1;2");
    expect(csv).toContain("'\t@SUM(1);3");
    expect(csv).toContain('"Normal; libellé";4');
  });

  it("neutralizes order and legacy estimate strings in the shared CSV writer", async () => {
    await exportToCSV(
      [
        { designation: " +CMD|'/C calc'!A0", amount: 12.5 },
        { designation: "-1+2", amount: 0 },
        { designation: "Ordinaire", amount: 7 },
      ],
      [
        { key: "designation", header: "Désignation" },
        { key: "amount", header: "Montant" },
      ],
      { filename: "test" },
    );

    const [blob] = vi.mocked(downloadBlob).mock.calls[0];
    const csv = await blob.text();
    expect(csv).toContain("' +CMD|'/C calc'!A0;12.5");
    expect(csv).toContain("'-1+2;0");
    expect(csv).toContain("Ordinaire;7");
  });
});

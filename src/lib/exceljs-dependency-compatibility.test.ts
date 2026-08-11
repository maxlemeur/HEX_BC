import { PassThrough } from "node:stream";

import { Workbook, stream } from "exceljs";
import { describe, expect, it } from "vitest";

function collectStream(output: PassThrough) {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk: Buffer | Uint8Array | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    output.once("end", () => resolve(Buffer.concat(chunks)));
    output.once("error", reject);
  });
}

describe("ExcelJS patched dependency compatibility", () => {
  it("writes conditional formatting through the overridden uuid v4 export", async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Security");
    worksheet.getCell("A1").value = 1;
    worksheet.getCell("A2").value = 2;
    worksheet.addConditionalFormatting({
      ref: "A1:A2",
      rules: [
        {
          type: "iconSet",
          priority: 1,
          iconSet: "3Stars",
          cfvo: [
            { type: "percent", value: 0 },
            { type: "percent", value: 33 },
            { type: "percent", value: 67 },
          ],
        },
      ],
    });

    const bytes = await workbook.xlsx.writeBuffer();
    const loaded = new Workbook();
    await loaded.xlsx.load(Buffer.from(bytes) as never);

    expect(loaded.getWorksheet("Security")?.getCell("A2").value).toBe(2);
  });

  it("keeps the production streaming writer and archive path readable", async () => {
    const output = new PassThrough();
    const collected = collectStream(output);
    const workbook = new stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: true,
    });
    const worksheet = workbook.addWorksheet("Export");
    worksheet.addRow(["Reference", "Quantity"]).commit();
    worksheet.addRow(["ABC", 3]).commit();
    worksheet.commit();

    await workbook.commit();
    const bytes = await collected;
    const loaded = new Workbook();
    await loaded.xlsx.load(bytes as never);

    expect(loaded.getWorksheet("Export")?.getCell("A2").value).toBe("ABC");
    expect(loaded.getWorksheet("Export")?.getCell("B2").value).toBe(3);
  });
});

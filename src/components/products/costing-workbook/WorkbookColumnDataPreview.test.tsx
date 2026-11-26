import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { WorkbookColumnDataPreview } from "./WorkbookColumnDataPreview";

it("sorts prices numerically and filters source values while keeping their Excel row numbers", async () => {
  const user = userEvent.setup();
  render(<WorkbookColumnDataPreview
    rows={[
      ["ID", "PR. FO", "Matériau"],
      ["TUBE", "12,40", "Acier"],
      ["COUDE", 2.75, "Inox"],
      [],
      ["TÉ", null, "Acier"],
    ]}
    headerRow={1}
    columns={[
      { header: "ID", field: "ID", index: 0, label: "Référence" },
      { header: "PR. FO", field: "PR. FO", index: 1, label: "Prix de fourniture" },
      { header: "Matériau", field: "Matériau", index: 2, label: "Matériau" },
    ]}
  />);
  const table = screen.getByRole("table", { name: "Valeurs du classeur" });
  const lineNumbers = () => within(table).getAllByRole("rowheader").map((header) => header.textContent);
  expect(lineNumbers()).toEqual(["2", "3", "5"]);
  expect(within(table).getByText("12,40")).toBeVisible();
  const sort = within(table).getByRole("button", { name: "Trier par Prix de fourniture" });
  await user.click(sort);
  expect(lineNumbers()).toEqual(["3", "2", "5"]);
  expect(sort.closest("th")).toHaveAttribute("aria-sort", "ascending");
  await user.click(sort);
  expect(lineNumbers()).toEqual(["2", "3", "5"]);
  await user.selectOptions(screen.getByRole("combobox", { name: "Rechercher dans" }), "2");
  await user.type(screen.getByRole("searchbox", { name: "Valeur à rechercher" }), "acier");
  expect(lineNumbers()).toEqual(["2", "5"]);
});

it("lets users reach rows past the first page and resets pagination when searching", async () => {
  const user = userEvent.setup();
  render(<WorkbookColumnDataPreview
    rows={[["ID"], ...Array.from({ length: 31 }, (_, index) => [`ARTICLE-${index + 1}`])]}
    headerRow={1}
    columns={[{ header: "ID", field: "ID", index: 0, label: "Référence" }]}
  />);

  expect(screen.queryByText("ARTICLE-31")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Suivante" }));
  expect(screen.getByText("ARTICLE-31")).toBeVisible();
  expect(screen.getByRole("rowheader")).toHaveTextContent("32");
  await user.type(screen.getByRole("searchbox", { name: "Valeur à rechercher" }), "ARTICLE-12");
  expect(screen.getByText("ARTICLE-12")).toBeVisible();
  expect(screen.getByRole("rowheader")).toHaveTextContent("13");
});

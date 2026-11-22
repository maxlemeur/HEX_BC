import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ToastProvider, useToast } from "@/components/feedback/toast-provider";

// Review of #499, round two, point 6: a notice of a send written while the member was elsewhere offers the way to it.

function Trigger() {
  const toast = useToast();
  return <button type="button" onClick={() => toast.success({ title: "Plan « A » envoyé au devis", description: "1 ligne écrite.",
    action: { label: "Ouvrir le devis sur la ligne écrite", href: "/dashboard/estimates/fiction/edit?focusItemId=line" } })}>Notifier</button>;
}

it("shows a notice's link where it says what it reports", async () => {
  render(<ToastProvider><Trigger /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Notifier" }));
  expect(await screen.findByRole("link", { name: "Ouvrir le devis sur la ligne écrite" }))
    .toHaveAttribute("href", "/dashboard/estimates/fiction/edit?focusItemId=line");
});

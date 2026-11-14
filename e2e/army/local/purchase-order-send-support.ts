import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import { extractPdfText } from "../../../scripts/tester-army/pdf-text";
import { apiRequest, type ArmyState } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { draftOrderOfAnAffaire, type Envelope } from "../critical/order-draft-support";
import type { PurchaseOrderSent } from "@/lib/purchase-orders/send";

type Ui = Parameters<typeof draftOrderOfAnAffaire>[0];

/** A message the local collector holds, as the application handed it to the e-mail provider. */
export type CollectedMessage = {
  directory: string;
  id: string;
  idempotencyKey: string;
  payload: {
    from: string; to: string | string[]; cc?: string[]; reply_to?: string | string[]; subject: string; html: string; text: string;
    attachments: Array<{ filename: string; content: string }>;
  };
};

function receiptsRoot(): string {
  const run = path.resolve(process.env.E2E_OFFER_RUN_DIRECTORY ?? "");
  const collector = path.resolve(process.env.E2E_OFFER_COLLECTOR_DIRECTORY ?? "");
  if (!process.env.E2E_OFFER_RUN_DIRECTORY || collector !== path.join(run, "collector")) {
    throw new Error("The send journeys read the collector of their own owned campaign only.");
  }
  return path.join(collector, "receipts");
}

/** Every message the collector committed in this campaign whose subject names `marker` (a journey's own prefix). */
export async function collectedMessages(marker: string): Promise<CollectedMessage[]> {
  const root = receiptsRoot();
  const messages: CollectedMessage[] = [];
  for (const entry of (await readdir(root)).filter((name) => /^[a-f0-9]{64}$/.test(name)).sort()) {
    const directory = path.join(root, entry);
    const packet = JSON.parse(await readFile(path.join(directory, "private", "payload.json"), "utf8")) as {
      id: string; idempotencyKey: string; payload: CollectedMessage["payload"];
    };
    if (packet.payload.subject.includes(marker)) messages.push({ directory, ...packet });
  }
  return messages;
}

export function recipientsOf(message: CollectedMessage): string[] {
  return [message.payload.to].flat();
}

/** The text of the PDF the collector stored for a message: the bytes the provider received. */
export async function attachedOrderText(message: CollectedMessage): Promise<string> {
  const stored = await readFile(path.join(message.directory, "private", "attachment.pdf"));
  expect(Buffer.from(message.payload.attachments[0]!.content, "base64").equals(stored)).toBe(true);
  return (await extractPdfText(stored)).pages.join(" ").replace(/\s+/g, " ");
}

/** A fictional address of this journey's own: the collector refuses anything outside `.invalid`. */
export function inventedAddress(army: ArmyState, local: string): string {
  return `${local}@${army.runPrefix.toLowerCase()}.invalid`;
}

/** Opens the send dialog of an order from its page. */
export async function openSendDialog({ screen, browser }: Ui, order: { id: string; reference: string }) {
  await browser.goto(`/dashboard/orders/${order.id}`, { waitUntil: "domcontentloaded" });
  // The button is in the server's HTML before React handles it: a press then is lost.
  await waitForHydration(browser);
  await screen.getByRole("button", "Envoyer au fournisseur…", { exact: true }).tap({ timeout: 60_000 });
  const dialog = screen.getByRole("dialog", `Envoyer le bon ${order.reference} au fournisseur`, { exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Sends from the open dialog and answers what the server said. */
export async function sendFromDialog({ browser }: Ui, dialog: Awaited<ReturnType<typeof openSendDialog>>, orderId: string) {
  const [response] = await Promise.all([
    browser.waitForResponse(`**/api/purchase-orders/${orderId}/send`, { timeout: 60_000 }),
    dialog.getByRole("button", "Envoyer le bon", { exact: true }).tap(),
  ]);
  return { status: response.status, body: await response.json<Envelope<PurchaseOrderSent>>() };
}

/** The same send asked through the API, as a second click or a retry would. */
export function sendThroughApi(browser: Ui["browser"], orderId: string, body: Record<string, unknown>) {
  return apiRequest<Envelope<PurchaseOrderSent>>(browser, "POST", `/api/purchase-orders/${orderId}/send`, body);
}

export { draftOrderOfAnAffaire };

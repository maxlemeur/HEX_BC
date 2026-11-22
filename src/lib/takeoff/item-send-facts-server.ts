import "server-only";

import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type {
  ItemSendAnswer,
  ItemSendEarlierSection,
  ItemSendEarlierTarget,
  ItemSendListItem,
} from "@/lib/takeoff/item-send-plan";

/**
 * Lot 4, PR 5a: the one reader of what the send by item needs that other pull requests store — the stored answers of a
 * plan (lot 4 PR 3a, migration B1), their review decisions and the entries (PR 4, migration B2), and the targets and
 * sections earlier sends by item wrote in a draft (the writer's migration C). Every read of them goes through this
 * module, so that the pull request that stores each replaces its inside and nothing else.
 *
 * Until those relations exist on `main`, it reads none: a plan's answers are « not stored » (the preview says so and
 * writes nothing) and a draft holds no earlier target nor section of a send by item. Read with the member's session, so
 * that each fact follows its own policy.
 */

type Member = Pick<AuthenticatedTakeoffContext, "supabase" | "tenantId" | "userId">;

/** What a plan's job answered for the sealed list it read. */
export type ItemSendReading = {
  /** The sealed list revision, in document order. */
  items: ItemSendListItem[];
  /** The items this plan was asked about: the sealed order of its unit. */
  scope: string[];
  /** One answer per item of the scope, each with its decision (taken on this revision) and the entry of this plan. */
  answers: ItemSendAnswer[];
  /** Quantities entered for an item on the whole affaire. */
  affaireEntries: Array<{ itemId: string; revision: number }>;
};

export type ItemSendFacts = { state: "not_stored" } | { state: "stored"; reading: ItemSendReading };

export async function readItemSendFacts(member: Member, input: {
  jobId: string;
  projectId: string;
  list: { revisionId: string; revision: number; itemCount: number };
}): Promise<ItemSendFacts> {
  void member;
  void input;
  return { state: "not_stored" };
}

/** The targets and sections earlier sends by item wrote in this draft, with the live parts each target holds. */
export async function readItemSendEarlierState(member: Member, input: { projectId: string; versionId: string }): Promise<{
  targets: ItemSendEarlierTarget[];
  sections: ItemSendEarlierSection[];
}> {
  void member;
  void input;
  return { targets: [], sections: [] };
}

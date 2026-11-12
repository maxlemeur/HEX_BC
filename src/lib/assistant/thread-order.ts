/** A saved message as far as its place in the conversation goes. */
export type ThreadOrderRow = { id: string; role: "user" | "assistant"; reply_to: string | null };

/**
 * The conversation as the member followed it: each question, then its answers.
 *
 * `rows` are in the order they were saved. Two tabs can answer at once, so an
 * answer is not always saved right after its question: it is placed under the
 * question it names. An answer whose question is not among `rows` (older than
 * the messages read) is left out rather than shown without its question.
 */
export function inConversationOrder<T extends ThreadOrderRow>(rows: readonly T[]): T[] {
  const answers = new Map<string, T[]>();
  for (const row of rows) {
    if (row.role !== "assistant" || !row.reply_to) continue;
    const list = answers.get(row.reply_to);
    if (list) list.push(row);
    else answers.set(row.reply_to, [row]);
  }
  return rows.flatMap((row) => (row.role === "user" ? [row, ...(answers.get(row.id) ?? [])] : []));
}

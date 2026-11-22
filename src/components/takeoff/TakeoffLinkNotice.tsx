import { NavigationLink as Link } from "@/components/navigation/NavigationFeedback";
import { formatTakeoffCompletionDate } from "@/lib/takeoff/completion-outcome";
import { readLinkedListAnalysis } from "@/lib/takeoff/earlier-analysis-server";
import { readItemTableAddress } from "@/lib/takeoff/item-table-query";
import { ITEM_TABLE_PARAM_PREFIX } from "@/lib/takeoff/item-detail-address";
import { readTakeoffLinkNotice, withoutTakeoffLinkNotice } from "@/lib/takeoff/review-link";

/**
 * Why the table of items opened as it did, after a link to the review of an analysis read against the list (lot 4,
 * review-link.ts): which analysis, what the table shows of it, and the warnings its reading kept (its review showed
 * them; the table does not). Shown only for a job of this affaire read against the list; « Masquer » removes it from
 * the address, the table's own parameters kept.
 */
export async function TakeoffLinkNotice({ projectId, query }: { projectId: string; query: URLSearchParams }) {
  const notice = readTakeoffLinkNotice(query);
  if (!notice) return null;
  // A read that fails shows no explanation: the table below reads (and refuses) on its own.
  const analysis = await readLinkedListAnalysis(projectId, notice.jobId).catch(() => null);
  if (!analysis) return null;
  const address = readItemTableAddress(query, ITEM_TABLE_PARAM_PREFIX);
  const onPlan = address.scope.kind === "plan";
  const named = `l’analyse « ${analysis.fileName ?? "sans nom"} » du ${formatTakeoffCompletionDate(analysis.at)}`;
  const sentence = notice.kind === "analyse"
    ? `Ce lien ouvrait la revue de ${named}, lue contre la liste des postes : ses réponses se revoient dans le tableau des postes, `
      + (onPlan ? "filtré sur son plan." : "qui montre les postes de l’affaire (elle n’a publié aucune réponse).")
    : notice.kind === "ecarts"
      ? `Ce lien ouvrait les écarts à trancher de ${named}, lue contre la liste des postes : le tableau des postes est filtré sur `
        + (onPlan ? "son plan et sur les postes à vérifier." : "les postes à vérifier.")
      : notice.kind === "retire"
        // The table and the detail read the latest list: the item withdrawn since its send is in neither.
        ? `La ligne que nommait ce lien vers ${named} a été alimentée par un poste retiré depuis de la liste des postes : `
          + "sa lecture est conservée, mais le tableau, qui suit la liste actuelle, ne la montre pas. Le tableau est "
          + (onPlan ? "filtré sur le plan de cette analyse." : "celui de l’affaire.")
        : address.focusItemId
          ? `La ligne que nommait ce lien vers ${named} vient d’un poste que cette analyse n’a pas lu : le tableau le montre parmi les postes de l’affaire.`
          : `La ligne que nommait ce lien vers ${named} n’est rattachée à aucun poste : le tableau des postes est `
            + (onPlan ? "filtré sur le plan de cette analyse." : "celui de l’affaire.");
  const hidden = withoutTakeoffLinkNotice(query).toString();
  const count = analysis.warnings.length + analysis.unreadableWarnings;
  return (
    <div role="note" aria-labelledby="metre-lien-explication" className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <p id="metre-lien-explication">{sentence}</p>
      {count > 0 ? (
        <details>
          <summary className="cursor-pointer">Avertissements de cette lecture ({count})</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {analysis.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}
            {analysis.unreadableWarnings > 0 ? (
              <li>{analysis.unreadableWarnings} avertissement{analysis.unreadableWarnings > 1 ? "s" : ""} conservé{analysis.unreadableWarnings > 1 ? "s" : ""} dans un format que cette version ne lit pas.</li>
            ) : null}
          </ul>
        </details>
      ) : null}
      <Link href={`/dashboard/affaires/${projectId}/takeoff${hidden ? `?${hidden}` : ""}`} replace scroll={false} className="underline">
        Masquer
      </Link>
    </div>
  );
}

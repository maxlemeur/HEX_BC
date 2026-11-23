"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import { requestContributionRevision } from "@/lib/takeoff/client";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { reconcileRevisionChoices, revisionQuestions } from "@/lib/takeoff/contribution-revision-choices";
import {
  revisionRequestSchema,
  type RevisionChoices,
  type RevisionItem,
  type RevisionPreview as Preview,
  type RevisionRequest,
  type RevisionVersion,
} from "@/lib/takeoff/contribution-revision-contracts";
import { RevisionPreview } from "./RevisionPreview";
import { RevisionQuantities } from "./RevisionQuantities";
import { RevisionSources } from "./RevisionSources";

type Confirmation = Extract<RevisionRequest, { action: "confirm" }>;
export function RevisionPanel({
  version,
  item,
  viewer,
  planId,
  editable,
  measuredAnswer,
  onItem,
  refresh,
  onRefused,
}: {
  version: RevisionVersion;
  item: RevisionItem;
  viewer: string;
  planId: string;
  editable: boolean;
  measuredAnswer: boolean;
  onItem: (id: string) => void;
  refresh: () => Promise<RevisionVersion | undefined>;
  onRefused: (e: unknown) => boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<RevisionChoices>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<Confirmation | null>(null);
  const questions = useRef(new Map<string, string>());
  const gate = useRef(false);
  const alive = useRef(true);
  const { job_id: job, version_id: versionId, receipt_id: receipt } = version;
  const key = `takeoff:revise:${viewer}:${job}:${versionId}`;
  useEffect(() => {
    alive.current = true;
    try {
      const saved = revisionRequestSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
      if (saved.success && saved.data.action === "confirm" && saved.data.version_id === versionId)
        setRetry(saved.data);
    } catch {
      /* Storage is optional. The mounted screen also retains its intent. */
    }
    return () => {
      alive.current = false;
    };
  }, [key, versionId]);
  function remember(value: Confirmation | null) {
    if (alive.current) setRetry(value);
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      /* See above. */
    }
  }
  async function run(work: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      if (alive.current && !onRefused(error))
        setMessage(error instanceof Error ? error.message : "Impossible de vérifier la correction.");
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function read(c: RevisionChoices, head = receipt) {
    if (!head) throw new Error("L’envoi initial de ce poste est introuvable.");
    const result = await requestContributionRevision(job, {
      action: "preview",
      version_id: versionId,
      receipt_id: head,
      choices: c,
    });
    if (result.action !== "preview") throw new Error("Impossible de lire l’aperçu de correction.");
    return result.preview;
  }
  function display(c: RevisionChoices, next: Preview) {
    if (alive.current) {
      setChoices(next.additions.length ? { ...c, additions: c.additions ?? {} } : c);
      for (const [key, facts] of revisionQuestions(next)) questions.current.set(key, facts);
      setPreview(next);
    }
  }
  async function show(c: RevisionChoices, head = receipt) {
    setPreview(null);
    display(c, await read(c, head));
  }
  async function working(action: Extract<RevisionRequest, { action: "choose" | "entry" }>) {
    await run(async () => {
      await requestContributionRevision(job, action);
      await refresh();
      if (alive.current) {
        setPreview(null);
        setChoices({});
        questions.current.clear();
        setMessage("Correction préparée. Le devis garde sa quantité jusqu’à la confirmation.");
      }
    });
  }
  async function confirm(stored?: Confirmation) {
    const command =
      stored ??
      (receipt && preview
        ? {
            action: "confirm" as const,
            receipt_id: receipt,
            version_id: versionId,
            choices,
            digest: preview.digest,
            intent_id: crypto.randomUUID(),
          }
        : null);
    if (!command) return;
    await run(async () => {
      let release = false;
      async function underLease() {
        const lock = await ensureTakeoffApplyDraftLock(versionId);
        release = lock.shouldRelease || (lock.acquireAttempted === true && !lock.lockedByOther);
        if (!lock.acquired)
          throw new Error(lock.errorMessage ?? "Le brouillon doit vous être réservé pour confirmer.");
        return requestContributionRevision(job, command!);
      }
      try {
        remember(command);
        // An identical retry can recover its receipt after issue, without taking
        // a lease on a document that is now read-only.
        const result = stored
          ? await requestContributionRevision(job, command).catch((e) => {
              if (
                e instanceof TakeoffApiError &&
                typeof e.details === "object" &&
                e.details &&
                "reason" in e.details &&
                e.details.reason === "TAKEOFF_REVISION_LEASE"
              )
                return underLease();
              throw e;
            })
          : await underLease();
        if (result.action !== "confirm") throw new Error("Le reçu de la correction est indisponible.");
        remember(null);
        if (alive.current) {
          setPreview(null);
          setChoices({});
          setMessage(
            result.replayed
              ? "Correction déjà confirmée. Le reçu initial est retrouvé, même après émission du devis."
              : "Correction confirmée dans le devis.",
          );
        }
        await refresh();
      } catch (e) {
        if (!(e instanceof TakeoffApiError) || e.status !== 409) throw e;
        remember(null);
        const current = await refresh();
        if (!alive.current) return;
        setPreview(null);
        if (current?.editable && current.receipt_id) {
          const prior = command.choices;
          let applied: RevisionChoices = prior.additions?.breakdown
            ? { additions: { breakdown: prior.additions.breakdown } }
            : {};
          let fresh = await read(applied, current.receipt_id);
          // Resolving a held page can reveal a typed line. Each pass restores
          // additional decisions the member already made on the same facts.
          const tried = new Set([JSON.stringify(applied)]);
          while (alive.current) {
            const next = reconcileRevisionChoices(prior, fresh, planId, questions.current, applied);
            const key = JSON.stringify(next);
            if (tried.has(key)) break;
            tried.add(key);
            applied = next;
            fresh = await read(applied, current.receipt_id);
          }
          display(applied, fresh);
        }
        setMessage(`${e.message} Les choix encore applicables sont conservés.`);
      } finally {
        if (release) await releaseEstimateDraftLock(versionId).catch(() => false);
      }
    });
  }
  const commandScope = { version_id: versionId, receipt_id: receipt ?? "", answer_id: item.answer_id };
  return (
    <section className="space-y-2 border-t bg-surface px-3 py-2 text-sm" data-testid="revision-detail">
      <RevisionQuantities item={item} version={version.version_number} />
      {editable && receipt && (
        <RevisionSources
          key={item.sources.plan_entry_revision ?? 0}
          item={item}
          measuredAnswer={measuredAnswer}
          busy={busy || !!retry}
          onEntry={(entry) =>
            void working({
              ...commandScope,
              action: "entry",
              entry,
              intent_id: crypto.randomUUID(),
              expected_revision: item.sources.plan_entry_revision ?? 0,
            })
          }
          onChoose={(choice) =>
            void working({
              ...commandScope,
              action: "choose",
              choice,
              intent_id: crypto.randomUUID(),
              expected: {
                answer_revision: item.answer_revision,
                work_revision: item.work_revision,
                marks_revision: item.sources.marks_revision,
                plan_entry_revision: item.sources.plan_entry_revision,
              },
            })
          }
        />
      )}
      {version.editable && receipt && (
        <Button
          size="xs"
          variant="outline"
          disabled={busy || !!retry}
          onClick={() => void run(() => show(choices))}
        >
          Prévisualiser la correction
        </Button>
      )}
      {!version.editable && <p>Les apports de cette version du devis sont en lecture seule.</p>}
      {message && <p role="status">{message}</p>}
      {retry && !busy && (
        <Button size="xs" variant="outline" onClick={() => void confirm(retry)}>
          Retrouver la confirmation précédente
        </Button>
      )}
      {preview && (
        <RevisionPreview
          preview={preview}
          choices={choices}
          planId={planId}
          busy={busy || !!retry}
          update={(c) => void run(() => show(c))}
          onConfirm={() => void confirm()}
          onItem={onItem}
        />
      )}
    </section>
  );
}

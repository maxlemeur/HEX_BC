"use client";
import { useMemo } from "react";
import { createCountMarksReader } from "@/lib/takeoff/count-marks-client";
import { requestContributionRevision } from "@/lib/takeoff/client";

export function useRevisionMarksReader(
  projectId: string,
  sentJob: string | null | undefined,
  revisionVersion: string | undefined,
  revisionReceipt: string | null | undefined,
) {
  return useMemo(() => {
    if (!sentJob || !revisionVersion || !revisionReceipt) return undefined;
    const ordinary = createCountMarksReader(projectId);
    return {
      ...ordinary,
      readPage: async (...args: Parameters<typeof ordinary.readPage>) => {
        const view = await ordinary.readPage(...args);
        return view.edit.reason === "sent" ? { ...view, edit: { allowed: true, reason: null } } : view;
      },
      edit: async (command: Parameters<typeof ordinary.edit>[0]) => {
        const result = await requestContributionRevision(sentJob, {
          action: "marks",
          version_id: revisionVersion,
          receipt_id: revisionReceipt,
          command,
        });
        if (result.action !== "marks") throw new Error("Les repères corrigés sont indisponibles.");
        return result.result;
      },
    };
  }, [projectId, sentJob, revisionVersion, revisionReceipt]);
}

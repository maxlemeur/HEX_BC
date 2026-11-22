"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchConsultationTemplates, materialRequestErrorMessage } from "@/lib/material-requests/client";
import { templateInForce } from "@/lib/material-requests/consultation-template-contracts";
import type { ConsultationTemplate } from "@/lib/material-requests/consultation-template";

/**
 * The consultation message template in force for the member (TI-691): their own, else the company's, else null
 * (today's built-in message). Read once for the page; a read error is said, never replaced by today's message.
 */
export type ConsultationTemplateState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "ready"; template: ConsultationTemplate | null };

export function useConsultationTemplate(enabled: boolean): ConsultationTemplateState {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; template: ConsultationTemplate | null }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchConsultationTemplates(controller.signal)
      .then((templates) => setState({ status: "ready", template: templateInForce(templates) }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: materialRequestErrorMessage(error, "Erreur inconnue.") });
      });
    return () => controller.abort();
  }, [enabled, attempt]);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }, []);
  return state.status === "error" ? { ...state, retry } : state;
}

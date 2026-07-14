import type { CockpitSuggestion, CockpitSurfaceId } from "@/lib/cockpit/suggestions";

export const COCKPIT_EXECUTE_ACTION_EVENT = "cockpit-execute-action";
export const COCKPIT_OPEN_SURFACE_EVENT = "cockpit-open-surface";

export type CockpitExecuteActionEventDetail = {
  projectId: string | null;
  suggestion: CockpitSuggestion;
};

export type CockpitOpenSurfaceEventDetail = {
  projectId: string;
  actionId: string;
  surfaceId: CockpitSurfaceId;
  triggerFilePicker?: boolean;
  files?: File[];
};

export function dispatchCockpitExecuteAction(
  detail: CockpitExecuteActionEventDetail,
) {
  document.dispatchEvent(
    new CustomEvent<CockpitExecuteActionEventDetail>(
      COCKPIT_EXECUTE_ACTION_EVENT,
      { detail },
    ),
  );
}

export function dispatchCockpitOpenSurface(
  detail: CockpitOpenSurfaceEventDetail,
) {
  document.dispatchEvent(
    new CustomEvent<CockpitOpenSurfaceEventDetail>(
      COCKPIT_OPEN_SURFACE_EVENT,
      { detail },
    ),
  );
}

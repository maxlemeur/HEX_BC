"use client";

import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { TAKEOFF_MODULE_ENABLED_FLAG_KEY } from "@/lib/takeoff/constants";

export type TakeoffEnabledStatus = "loading" | "error" | "ready";

export function resolveTakeoffEnabledStatus(input: {
  isLoading: boolean;
  error: Error | null;
}): TakeoffEnabledStatus {
  if (input.isLoading) {
    return "loading";
  }

  if (input.error) {
    return "error";
  }

  return "ready";
}

export function useTakeoffEnabled() {
  const featureFlag = useFeatureFlag(TAKEOFF_MODULE_ENABLED_FLAG_KEY);
  const status = resolveTakeoffEnabledStatus({
    isLoading: featureFlag.isLoading,
    error: featureFlag.error,
  });

  return {
    status,
    enabled: status === "ready" && featureFlag.enabled,
    error: featureFlag.error,
    refresh: featureFlag.refresh,
    isLoading: featureFlag.isLoading,
  };
}

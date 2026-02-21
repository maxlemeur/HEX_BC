"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { useUserContext } from "@/components/UserContext";

type FeatureFlagListItem = {
  flag_key: string;
  enabled: boolean;
  value?: string | null;
};

type FeatureFlagsResponse = {
  tenant_id: string;
  flags: FeatureFlagListItem[];
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
  };
};

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const envelope = payload as ApiEnvelope<unknown>;
  return envelope.error?.message ?? fallback;
}

function normalizeFeatureFlagKey(value: string) {
  return value.trim().toUpperCase();
}

async function fetchFeatureFlags([
  route,
  tenantId,
]: readonly [string, string]): Promise<FeatureFlagsResponse> {
  const query = new URLSearchParams({ tenant_id: tenantId }).toString();
  const response = await fetch(`${route}?${query}`, {
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Impossible de charger les feature flags."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Reponse feature flags invalide.");
  }

  const envelope = payload as ApiEnvelope<FeatureFlagsResponse>;
  if (!envelope.ok || !envelope.data) {
    throw new Error(resolveErrorMessage(payload, "Reponse feature flags invalide."));
  }

  return envelope.data;
}

export function useFeatureFlag(key: string) {
  const { tenantId } = useUserContext();
  const normalizedKey = useMemo(() => normalizeFeatureFlagKey(key), [key]);

  const swrKey = tenantId && normalizedKey ? (["/api/feature-flags", tenantId] as const) : null;
  const { data, error, isLoading, mutate } = useSWR<FeatureFlagsResponse>(
    swrKey,
    fetchFeatureFlags
  );

  const enabled = useMemo(() => {
    if (!data) return false;

    const flag = data.flags.find(
      (entry) => normalizeFeatureFlagKey(entry.flag_key) === normalizedKey
    );

    return flag?.enabled === true;
  }, [data, normalizedKey]);

  const value = useMemo(() => {
    if (!data) return null;

    const flag = data.flags.find(
      (entry) => normalizeFeatureFlagKey(entry.flag_key) === normalizedKey
    );
    return typeof flag?.value === "string" ? flag.value : null;
  }, [data, normalizedKey]);

  return {
    enabled,
    value,
    isLoading: Boolean(swrKey && isLoading),
    error: error instanceof Error ? error : null,
    refresh: mutate,
  };
}

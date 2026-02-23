"use client";

import Link from "next/link";
import useSWR from "swr";

import {
  EstimateDashboard,
  type EstimateStatsPayload,
} from "@/components/estimates/EstimateDashboard";

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
  };
};

async function fetcher(url: string): Promise<EstimateStatsPayload> {
  const response = await fetch(url, {
    method: "GET",
  });
  const payload = (await response.json()) as ApiEnvelope<EstimateStatsPayload>;

  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Impossible de charger les statistiques.");
  }

  return payload.data;
}

export default function EstimateDashboardPage() {
  const { data, error, isLoading } = useSWR<EstimateStatsPayload>(
    "/api/estimates/stats",
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 60000,
    }
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard chiffrages</h1>
          <p className="page-description">
            Suivez vos KPI commerciaux et la tendance des 6 derniers mois.
          </p>
        </div>
        <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates">
          Retour a la liste
        </Link>
      </div>

      {isLoading && (
        <div className="dashboard-card p-6 text-sm text-[var(--slate-500)]">
          Chargement du tableau de bord...
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          {error.message || "Impossible de charger les statistiques."}
        </div>
      )}

      {data ? <EstimateDashboard data={data} /> : null}
    </div>
  );
}

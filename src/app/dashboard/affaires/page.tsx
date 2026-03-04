import { Suspense } from "react";

import { fetchAffairePageData } from "@/lib/affaires/server";
import {
  AFFAIRE_PAGE_SIZE_OPTIONS,
  type AffairePageSize,
  type AffaireStatus,
} from "@/lib/affaires/schemas";
import { AffairesPageClient } from "@/components/affaires/AffairesPageClient";
import AffairesLoading from "./loading";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseStatuses(raw: string | string[] | undefined): AffaireStatus[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  const all: AffaireStatus[] = ["draft", "sent", "accepted", "archived"];
  return value
    .split(",")
    .filter((s): s is AffaireStatus => all.includes(s as AffaireStatus));
}

function parseSize(raw: string | string[] | undefined): AffairePageSize {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const num = Number(value);
  if (AFFAIRE_PAGE_SIZE_OPTIONS.includes(num as AffairePageSize)) {
    return num as AffairePageSize;
  }
  return 20;
}

function parseString(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

export default async function AffairesPage({ searchParams }: Props) {
  const params = await searchParams;

  const q = parseString(params.q).trim() || undefined;
  const statuses = parseStatuses(params.status);
  const cursor = parseString(params.cursor) || undefined;
  const size = parseSize(params.size);

  const data = await fetchAffairePageData({
    q: q ?? null,
    status: statuses.length > 0 ? statuses : null,
    cursor: cursor ?? null,
    size,
  });

  return (
    <Suspense fallback={<AffairesLoading />}>
      <AffairesPageClient
        initialData={data}
        initialQ={q ?? ""}
        initialStatuses={statuses}
        initialCursor={cursor ?? null}
        initialSize={size}
      />
    </Suspense>
  );
}

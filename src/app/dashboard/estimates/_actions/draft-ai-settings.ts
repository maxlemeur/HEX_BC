"use server";

import { z } from "zod";

import { readEstimateDraftAiOptionsForVersion } from "@/lib/estimates/structure-drafts";

export async function loadEstimateDraftAiOptions(versionId: string) {
  return readEstimateDraftAiOptionsForVersion(z.uuid().parse(versionId));
}

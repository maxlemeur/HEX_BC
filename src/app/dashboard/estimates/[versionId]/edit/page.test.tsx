import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import EditEstimateRoutePage from "@/app/dashboard/estimates/[versionId]/edit/page";

type EstimateEditorPageProps = {
  versionId: string;
  focusItemId?: string | null;
  autoOpenVersionZero?: boolean;
  autoOpenStructureDraft?: boolean;
  autoImportLinkedDpgf?: boolean;
};

describe("EditEstimateRoutePage", () => {
  it("passes the hybrid import deep link to the estimate editor page", async () => {
    const pageElement = (await EditEstimateRoutePage({
      params: Promise.resolve({ versionId: "version-1" }),
      searchParams: Promise.resolve({
        importLinkedDpgf: "1",
      }),
    })) as ReactElement<EstimateEditorPageProps>;

    expect(pageElement.props).toMatchObject({
      versionId: "version-1",
      autoImportLinkedDpgf: true,
      autoOpenVersionZero: false,
      autoOpenStructureDraft: false,
    });
  });

  it("keeps the existing deep links independent from the hybrid import flag", async () => {
    const pageElement = (await EditEstimateRoutePage({
      params: Promise.resolve({ versionId: "version-2" }),
      searchParams: Promise.resolve({
        openVersionZero: "true",
        openStructureDraft: "true",
        importLinkedDpgf: "false",
      }),
    })) as ReactElement<EstimateEditorPageProps>;

    expect(pageElement.props).toMatchObject({
      versionId: "version-2",
      autoOpenVersionZero: true,
      autoOpenStructureDraft: true,
      autoImportLinkedDpgf: false,
    });
  });
});

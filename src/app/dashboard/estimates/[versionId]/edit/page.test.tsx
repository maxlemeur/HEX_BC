import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import EditEstimateRoutePage from "@/app/dashboard/estimates/[versionId]/edit/page";
import type { SettingsSection } from "@/components/estimates/EstimateSettingsSummaryBar";

type EstimateEditorPageProps = {
  versionId: string;
  focusItemId?: string | null;
  autoOpenVersionZero?: boolean;
  autoOpenStructureDraft?: boolean;
  autoOpenSettingsSection?: SettingsSection | null;
};

describe("EditEstimateRoutePage", () => {
  it("ignores the legacy import query string and keeps the editor route non-mutating", async () => {
    const pageElement = (await EditEstimateRoutePage({
      params: Promise.resolve({ versionId: "version-1" }),
      searchParams: Promise.resolve({
        importLinkedDpgf: "1",
      }),
    })) as ReactElement<EstimateEditorPageProps>;

    expect(pageElement.props).toMatchObject({
      versionId: "version-1",
      autoOpenVersionZero: false,
      autoOpenStructureDraft: false,
      autoOpenSettingsSection: null,
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
      autoOpenSettingsSection: null,
    });
  });

  it("opens the requested estimate settings section", async () => {
    const pageElement = (await EditEstimateRoutePage({
      params: Promise.resolve({ versionId: "version-3" }),
      searchParams: Promise.resolve({
        openSettings: "margin",
      }),
    })) as ReactElement<EstimateEditorPageProps>;

    expect(pageElement.props).toMatchObject({
      versionId: "version-3",
      autoOpenSettingsSection: "margin",
    });
  });

  it("ignores an unknown settings section", async () => {
    const pageElement = (await EditEstimateRoutePage({
      params: Promise.resolve({ versionId: "version-4" }),
      searchParams: Promise.resolve({
        openSettings: "unknown",
      }),
    })) as ReactElement<EstimateEditorPageProps>;

    expect(pageElement.props.autoOpenSettingsSection).toBeNull();
  });
});

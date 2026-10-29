import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

// Mock toast (required by TakeoffReviewTable import chain)
const mockToast = {
  push: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => mockToast,
}));

import { EvidencePanel } from "@/components/takeoff/EvidencePanel";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

const ITEM_ID = "44444444-4444-4444-8444-444444444444";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: ITEM_ID,
    designation: "Tube PVC 100mm",
    quantity: 12,
    unit: "ml",
    confidence: 0.85,
    evidence: "Extrait page 3, ligne 12: tube PVC diametre 100",
    source_file_name: "plan.pdf",
    source_page: 3,
    metadata: { category: "tuyauterie" },
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T09:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    _dirty: false,
    _saving: false,
    _error: null,
    ...overrides,
  };
}

describe("EvidencePanel", () => {
  const defaultProps = {
    itemIndex: 2,
    totalItems: 10,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onUpdateEvidence: vi.fn(),
    onUpdateSourcePage: vi.fn(),
    onMarkVerified: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render signed document link for unsafe urls", () => {
    render(
      <EvidencePanel
        item={makeItem({
          metadata: {
            category: "tuyauterie",
            signed_document_url: "javascript:alert('x')",
          },
        })}
        {...defaultProps}
      />
    );

    expect(
      screen.queryByRole("link", { name: /ouvrir le document source/i })
    ).toBeNull();
  });
});

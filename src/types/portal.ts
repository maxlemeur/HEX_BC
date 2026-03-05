import type { EstimateDocumentProps } from "@/components/EstimateDocument";

export type PortalTokenStatus = "pending" | "accepted" | "rejected" | "expired";

export type PortalEstimateView = Omit<EstimateDocumentProps, "portalUrl"> & {
  status: PortalTokenStatus;
  expiresAt: string;
};

export type NegotiationMessage = {
  id: string;
  created_at: string;
  author_type: "client" | "engineer";
  author_name: string | null;
  message: string;
};

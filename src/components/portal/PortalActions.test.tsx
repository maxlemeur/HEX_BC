import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PortalActions } from "@/components/portal/PortalActions";

describe("PortalActions document copy", () => {
  beforeEach(() => {
    window.print = vi.fn();
  });

  it.each(["accepted", "rejected"] as const)(
    "keeps printing available after a %s decision",
    (status) => {
      render(<PortalActions token="portal-token" status={status} />);

      fireEvent.click(
        screen.getByRole("button", {
          name: "Imprimer / Enregistrer en PDF",
        })
      );
      expect(window.print).toHaveBeenCalledOnce();
    }
  );
});

afterEach(cleanup);

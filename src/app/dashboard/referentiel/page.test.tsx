import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

import ReferentielHubPage from "@/app/dashboard/referentiel/page";

describe("ReferentielHubPage", () => {
  it("presents reusable assemblies as business kits", () => {
    const markup = renderToStaticMarkup(<ReferentielHubPage />);

    expect(markup).toContain('href="/dashboard/estimates/assemblies"');
    expect(markup).toContain("Kits métiers");
    expect(markup).toContain("Ouvrages réutilisables pour vos chiffrages");
    expect(markup).not.toContain("Consultation du catalogue fournisseur");
  });
});

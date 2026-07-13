import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserContextMock, isTakeoffEnabledMock } = vi.hoisted(() => ({
  getUserContextMock: vi.fn(),
  isTakeoffEnabledMock: vi.fn(),
}));

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

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  getUserContext: getUserContextMock,
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: isTakeoffEnabledMock,
}));

import AdminHubPage from "@/app/dashboard/admin/page";

beforeEach(() => {
  getUserContextMock.mockResolvedValue({
    userEmail: "admin@test.com",
    tenantId: "tenant-123",
    profile: {
      tenant_role: "admin",
    },
  });
  isTakeoffEnabledMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

function getSectionMarkup(markup: string, labelledBy: string) {
  const labelledByIndex = markup.indexOf(`aria-labelledby="${labelledBy}"`);
  const sectionStart = markup.lastIndexOf("<section", labelledByIndex);
  const sectionEnd = markup.indexOf("</section>", labelledByIndex);

  expect(labelledByIndex).toBeGreaterThanOrEqual(0);
  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);

  return markup.slice(sectionStart, sectionEnd + "</section>".length);
}

describe("AdminHubPage", () => {
  it("keeps four balanced configuration links and isolates destructive tools", async () => {
    const markup = renderToStaticMarkup(await AdminHubPage());

    const configuration = getSectionMarkup(
      markup,
      "admin-configuration-heading"
    );
    expect(configuration.match(/<a\b/g) ?? []).toHaveLength(4);
    expect(configuration).not.toContain("Nettoyage des achats");

    const dangerZone = getSectionMarkup(markup, "admin-danger-heading");
    expect(dangerZone).toContain("Nettoyage des achats");
    expect(dangerZone).toContain('href="/dashboard/admin/procurement-reset"');
  });

  it("uses professional French labels throughout the hub", async () => {
    const markup = renderToStaticMarkup(await AdminHubPage());

    expect(markup).toContain("Organisation");
    expect(markup).toContain("Apprentissage des suggestions");
    expect(markup).toContain("Règles de contrôle");
    expect(markup).toContain("Fonctionnalités");
    expect(markup).toContain("Suivi des métrés");
  });
});

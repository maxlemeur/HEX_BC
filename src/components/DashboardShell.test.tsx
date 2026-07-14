import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigationState } = vi.hoisted(() => ({
  navigationState: { pathname: "/dashboard/orders" },
}));

vi.mock("next/image", () => ({
  default: function MockImage({ alt }: { alt: string }) {
    return <span role="img" aria-label={alt} />;
  },
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    children,
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) {
    void _prefetch;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("@/components/SignOutButton", () => ({
  SignOutButton: () => <button type="button">Se deconnecter</button>,
}));

vi.mock("@/components/UserContext", () => ({
  useUserContext: () => ({
    profile: { id: "profile-1", tenant_role: "admin" },
  }),
}));

vi.mock("@/components/ui/KeyboardShortcutsModal", () => ({
  KeyboardShortcutsModal: () => null,
}));

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock("@/hooks/useLastAffaireContext", () => ({
  setLastAffaire: vi.fn(),
  useLastAffaireId: () => null,
}));

vi.mock("@/hooks/useTakeoffEnabled", () => ({
  useTakeoffEnabled: () => ({ status: "ready", enabled: false }),
}));

vi.mock("@/hooks/useUiMode", () => ({
  useUiMode: () => ({ isExpert: false, setMode: vi.fn() }),
}));

vi.mock("@/lib/navigation/build-nav-groups", () => ({
  buildNavGroups: () => [
    {
      key: "main",
      label: "Principal",
      items: [
        {
          navId: "orders",
          href: "/dashboard/orders",
          label: "Bons de commande",
          title: "Gerer les bons de commande",
          icon: null,
        },
      ],
    },
  ],
}));

vi.mock("@/lib/stores/last-affaire-store", () => ({
  initStore: vi.fn(),
}));

import { DashboardShell } from "./DashboardShell";

beforeEach(() => {
  navigationState.pathname = "/dashboard/orders";
  window.localStorage.clear();
  document.body.style.overflow = "";
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("DashboardShell mobile navigation", () => {
  it("toggles the drawer, exposes its state and locks background scrolling", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell displayName="Jean Dupont">
        <div>Contenu</div>
      </DashboardShell>
    );

    const openButton = screen.getByRole("button", { name: "Ouvrir le menu" });
    const sidebar = document.getElementById("dashboard-sidebar");

    expect(openButton).toHaveAttribute("aria-expanded", "false");
    expect(openButton).toHaveAttribute("aria-controls", "dashboard-sidebar");
    expect(sidebar).not.toHaveAttribute("data-mobile-open");

    await user.click(openButton);

    const closeButton = screen.getByRole("button", { name: "Fermer le menu" });
    expect(sidebar).toHaveAttribute("data-mobile-open", "true");
    expect(sidebar).toHaveAttribute("role", "dialog");
    expect(sidebar).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(closeButton);

    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(sidebar).not.toHaveAttribute("data-mobile-open");
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
  });

  it("closes with Escape, restores focus and keeps navigation/footer reachable", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell displayName="Jean Dupont">
        <div>Contenu</div>
      </DashboardShell>
    );

    await user.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    await user.keyboard("{Escape}");

    const openButton = screen.getByRole("button", { name: "Ouvrir le menu" });
    await waitFor(() => expect(openButton).toHaveFocus());
    expect(document.getElementById("dashboard-sidebar")).not.toHaveAttribute(
      "data-mobile-open"
    );

    const navigation = screen.getByRole("navigation", { name: "Menu principal" });
    expect(navigation).toHaveClass("min-h-0", "overflow-y-auto");
    expect(screen.getByText("Jean Dupont")).toBeInTheDocument();
  });

  it("moves initial focus into the modal drawer and traps Tab navigation", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell displayName="Jean Dupont">
        <div>Contenu</div>
      </DashboardShell>
    );

    await user.click(screen.getByRole("button", { name: "Ouvrir le menu" }));

    const closeButton = screen.getByRole("button", { name: "Fermer le menu" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    const signOutButton = screen.getByRole("button", { name: "Se deconnecter" });
    signOutButton.focus();
    await user.keyboard("{Tab}");
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(signOutButton).toHaveFocus();
  });

  it("provides a skip link and focuses main content after client navigation", async () => {
    const { rerender } = render(
      <DashboardShell displayName="Jean Dupont">
        <div>Contenu</div>
      </DashboardShell>
    );

    expect(
      screen.getByRole("link", { name: "Aller au contenu principal" })
    ).toHaveAttribute("href", "#dashboard-main-content");

    navigationState.pathname = "/dashboard/affaires";
    rerender(
      <DashboardShell displayName="Jean Dupont">
        <div>Nouveau contenu</div>
      </DashboardShell>
    );

    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });

  it("keeps dashboard content below the mobile header through tablet widths", () => {
    render(
      <DashboardShell displayName="Jean Dupont">
        <div>Contenu</div>
      </DashboardShell>
    );

    const contentContainer = screen.getByRole("main").firstElementChild;

    expect(contentContainer).toHaveClass(
      "pt-[4.5rem]",
      "sm:pb-8",
      "lg:py-8"
    );
    expect(contentContainer).not.toHaveClass("sm:py-8");
  });
});

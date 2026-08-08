import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
      key: "affaires",
      label: "Mes affaires",
      items: [
        {
          navId: "affaires",
          href: "/dashboard/affaires",
          label: "Mes affaires",
          title: "Gerer les affaires",
          icon: null,
        },
        {
          navId: "takeoff",
          href: "/dashboard/affaires/project-1/takeoff",
          label: "Métrés plans",
          title: "Ouvrir les métrés",
          icon: null,
        },
      ],
    },
    {
      key: "commandes",
      label: "Commandes",
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

describe("DashboardShell universal topbar navigation", () => {
  it("renders the same horizontal navigation on standard dashboard screens", () => {
    render(
      <DashboardShell
        appBuildId="abcdef1"
        appVersion="1.2.3"
        displayName="Jean Dupont"
      >
        <div>Contenu</div>
      </DashboardShell>
    );

    const topbar = screen.getByRole("banner");
    const brandLink = within(topbar).getByRole("link", {
      name: "Hydro Express — Accueil",
    });
    expect(topbar).toHaveClass("dashboard-global-topbar");
    expect(brandLink).toHaveTextContent("Hydro Express");
    expect(within(brandLink).queryByRole("img")).toBeNull();
    expect(
      screen.getByRole("menubar", { name: "Espaces de travail" })
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Commandes" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    const main = screen.getByRole("main");
    const sidebar = document.getElementById("dashboard-sidebar");
    expect(sidebar).toHaveClass("dashboard-sidebar--overlay");
    expect(sidebar).not.toHaveClass("dashboard-sidebar--collapsed");
    expect(main).toHaveClass("lg:pl-0");
    expect(main.style.getPropertyValue("--sidebar-offset")).toBe("0px");
    expect(main.firstElementChild).toHaveClass("py-6", "sm:py-8");
    expect(main.firstElementChild).not.toHaveClass("dashboard-workspace-content");
    expect(
      screen.getByRole("note", {
        name: "Version de l'application 1.2.3, build abcdef1",
      })
    ).toHaveTextContent("v1.2.3 · abcdef1");
  });

  it("opens grouped destinations from the topbar with keyboard navigation", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell
        appBuildId={null}
        appVersion="1.2.3"
        displayName="Jean Dupont"
      >
        <div>Contenu</div>
      </DashboardShell>
    );

    const affairesTrigger = screen.getByRole("menuitem", {
      name: "Affaires",
    });
    affairesTrigger.focus();
    await user.keyboard("{ArrowDown}");

    const affairesMenu = await screen.findByRole("menu", {
      name: "Mes affaires",
    });
    const menuItems = within(affairesMenu).getAllByRole("menuitem");
    await waitFor(() => expect(menuItems[0]).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(menuItems[1]).toHaveFocus();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(affairesTrigger).toHaveFocus());
    expect(screen.queryByRole("menu", { name: "Mes affaires" })).toBeNull();
  });

  it("opens an accessible overlay menu, traps focus and restores it on Escape", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell
        appBuildId={null}
        appVersion="1.2.3"
        displayName="Jean Dupont"
      >
        <div>Contenu</div>
      </DashboardShell>
    );

    const menuButton = screen.getByRole("button", {
      name: "Ouvrir le menu principal",
    });
    const sidebar = document.getElementById("dashboard-sidebar");
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(menuButton).toHaveAttribute("aria-controls", "dashboard-sidebar");
    expect(menuButton).not.toHaveTextContent("Menu");

    await user.click(menuButton);

    const closeButton = screen.getByRole("button", { name: "Fermer le menu" });
    expect(sidebar).toHaveAttribute("data-drawer-open", "true");
    expect(sidebar).toHaveAttribute("role", "dialog");
    expect(sidebar).toHaveAttribute("aria-modal", "true");
    expect(sidebar).toHaveAttribute("aria-label", "Navigation principale");
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(closeButton).toHaveFocus());

    const signOutButton = screen.getByRole("button", { name: "Se deconnecter" });
    signOutButton.focus();
    await user.keyboard("{Tab}");
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(menuButton).toHaveFocus());
    expect(sidebar).not.toHaveAttribute("data-drawer-open");
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
  });

  it("provides a skip link and focuses main content after client navigation", async () => {
    const { rerender } = render(
      <DashboardShell
        appBuildId={null}
        appVersion="1.2.3"
        displayName="Jean Dupont"
      >
        <div>Contenu</div>
      </DashboardShell>
    );

    expect(
      screen.getByRole("link", { name: "Aller au contenu principal" })
    ).toHaveAttribute("href", "#dashboard-main-content");

    navigationState.pathname = "/dashboard/affaires";
    rerender(
      <DashboardShell
        appBuildId={null}
        appVersion="1.2.3"
        displayName="Jean Dupont"
      >
        <div>Nouveau contenu</div>
      </DashboardShell>
    );

    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });

  it("keeps production workspaces full width below the same topbar", () => {
    navigationState.pathname = "/dashboard/estimates/version-1/edit";

    render(
      <DashboardShell
        appBuildId={null}
        appVersion="1.2.3"
        displayName="Jean Dupont"
      >
        <div>Éditeur</div>
      </DashboardShell>
    );

    expect(
      screen.getAllByRole("menubar", { name: "Espaces de travail" })
    ).toHaveLength(1);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("lg:pl-0");
    expect(main.firstElementChild).toHaveClass(
      "dashboard-workspace-content",
      "pt-0"
    );
  });
});

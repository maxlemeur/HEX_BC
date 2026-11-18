export function isDashboardNavItemActive(pathname: string, href: string, navId?: string) {
  const isTakeoff = /^\/dashboard\/affaires\/[^/]+\/(?:takeoff|plans)(?:\/|$)/.test(pathname);
  if (navId === "takeoff") return isTakeoff;
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  if (href === "/dashboard/affaires") {
    if (isTakeoff) return false;
    return (
      pathname.startsWith("/dashboard/affaires") ||
      pathname.startsWith("/dashboard/estimates")
    );
  }

  if (href === "/dashboard/orders") {
    return pathname.startsWith("/dashboard/orders");
  }

  if (href === "/dashboard/admin") {
    return (
      pathname.startsWith("/dashboard/admin") ||
      pathname.startsWith("/dashboard/tenants")
    );
  }

  if (href === "/dashboard/referentiel") {
    return ["referentiel", "suppliers", "sites", "products", "catalogue"].some(
      (segment) => pathname.startsWith(`/dashboard/${segment}`)
    );
  }

  if (href === "/dashboard/tarifs") {
    return ["tarifs", "prices", "indices"].some((segment) =>
      pathname.startsWith(`/dashboard/${segment}`)
    );
  }

  return pathname.startsWith(href);
}

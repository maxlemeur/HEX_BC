function isTakeoffRoute(pathname: string) {
  return (
    pathname.startsWith("/dashboard/takeoff") ||
    /^\/dashboard\/affaires\/[^/]+\/takeoff/.test(pathname) ||
    /^\/dashboard\/estimates\/[^/]+\/takeoff/.test(pathname)
  );
}

export function isDashboardNavItemActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  if (
    href === "/dashboard/takeoff" ||
    /\/dashboard\/affaires\/[^/]+\/takeoff$/.test(href)
  ) {
    return isTakeoffRoute(pathname);
  }

  if (href === "/dashboard/affaires") {
    if (isTakeoffRoute(pathname)) return false;
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

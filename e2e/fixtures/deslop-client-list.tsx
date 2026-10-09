import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import EstimatesPage from "../../src/app/dashboard/estimates/page";

function EstimateListFixture() {
  const [href, setHref] = useState(window.location.href);
  const location = useMemo(() => new URL(href), [href]);
  const navigate = useCallback((next: string, replace: boolean) => {
    if (replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
    setHref(window.location.href);
  }, []);
  const router = useMemo<AppRouterInstance>(() => ({
    push: (next) => navigate(next, false),
    replace: (next) => navigate(next, true),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
    prefetch: () => {},
    bfcacheId: "deslop-client-list",
  }), [navigate]);

  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={location.pathname}>
        <SearchParamsContext.Provider value={location.searchParams}>
          <SWRConfig value={{ provider: () => new Map() }}>
            <EstimatesPage />
          </SWRConfig>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<EstimateListFixture />);

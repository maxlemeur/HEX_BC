import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Guards that replace the static-source tests removed under the E2E-first policy.
// Table, column and RPC names are ASCII: an accent pass once rewrote "reference" into
// "référence" inside a query and broke every catalogue price suggestion.
const noAccentedQueryIdentifier = {
  selector:
    "CallExpression[callee.property.name=/^(from|select|eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|order|rpc|not|filter)$/] > Literal:first-child[value=/[^\\x00-\\x7F]/]",
  message:
    "Supabase table, column and RPC names are ASCII. Keep accents in labels and data, never in query identifiers.",
};
const noServiceRoleInClientModule = {
  selector:
    "Program:has(ExpressionStatement[directive='use client']) ImportDeclaration[source.value=/supabase\\/service-role$/]",
  message: "The service-role client bypasses RLS and must never be imported by a client module.",
};
const noArtisanRouteAuth = {
  selector:
    "CallExpression[callee.property.name='getUser'][callee.object.property.name='auth']",
  message:
    "Route handlers resolve the caller through getAuthenticatedTenantContext() or getAuthenticatedContext() from @/lib/auth/tenant-context, never auth.getUser().",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react-hooks 7.1 enables React Compiler diagnostics through
    // the Next.js preset. The application does not enable React Compiler yet;
    // keep the established runtime lint baseline outside migrated scopes.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
    },
  },
  {
    // Re-enable Compiler diagnostics only on controllers whose state ownership
    // and async scope guards have been migrated. The facade, quality controller,
    // sync controller, and remaining application stay on the legacy baseline
    // until their effect-driven hydration is redesigned.
    files: [
      "src/hooks/useEstimateEditorActivityController.ts",
      "src/hooks/useEstimateEditorAiDialogsController.ts",
      "src/hooks/useEstimateEditorAiImportCoordinator.ts",
      "src/hooks/useEstimateEditorBulkController.ts",
      "src/hooks/useEstimateEditorExportController.ts",
      "src/hooks/useEstimateEditorHistoryController.ts",
      "src/hooks/useEstimateEditorImportController.ts",
      "src/hooks/useEstimateEditorItemsController.ts",
      "src/hooks/useEstimateEditorOrderingController.ts",
      "src/hooks/useEstimateEditorPasteController.ts",
      "src/hooks/useEstimateEditorStatusController.ts",
      "src/hooks/useEstimateEditorStructureController.ts",
      "src/hooks/useEstimateEditorSuggestionsController.ts",
      "src/hooks/useEstimateEditorSupplierController.ts",
    ],
    rules: {
      "react-hooks/immutability": "error",
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/use-memo": "error",
    },
  },
  {
    // Screens use the Base UI primitives of src/components/ui. ui-legacy only keeps the toast
    // API, NumberInput and the shell modules it still hosts; the frozen estimate grid keeps
    // its Modal / ConfirmModal / Popover.
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui-legacy/**",
      "src/components/estimates/EstimateEditorTable.tsx",
      "src/components/estimates/components/estimate-editor-table/**",
      "src/components/estimates/components/estimate-editor-row/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/components/ui-legacy",
              message: "Use the primitives of @/components/ui instead of the ui-legacy barrel.",
            },
          ],
          patterns: [
            {
              // gitignore syntax: listing the folder itself would forbid re-including its files.
              group: [
                "@/components/ui-legacy/*",
                "!@/components/ui-legacy/Toast",
                "!@/components/ui-legacy/NumberInput",
                "!@/components/ui-legacy/KeyboardShortcutsModal",
                "!@/components/ui-legacy/CommandPaletteLoader",
              ],
              message:
                "Use the primitives of @/components/ui (Button, Dialog, Input, Combobox, Skeleton…) instead of ui-legacy.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", noAccentedQueryIdentifier, noServiceRoleInClientModule],
    },
  },
  {
    // A later block replaces the rule options for the files it matches, so it repeats the
    // src-wide guards next to the route-handler boundary.
    files: ["src/app/api/**/*.ts"],
    ignores: ["src/app/api/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        noAccentedQueryIdentifier,
        noServiceRoleInClientModule,
        noArtisanRouteAuth,
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "docs/old_gemini_chiffrage/**",
    // Local e2e outputs and agent scratch directories (git-ignored, may hold huge traces).
    ".e2e/**",
    "**/.codex-tmp/**",
    // Proof scripts of the independent audits, kept verbatim as evidence (CommonJS included).
    "docs/audit-independant-*/reproductions/**",
  ]),
]);

export default eslintConfig;

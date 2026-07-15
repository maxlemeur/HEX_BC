import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "docs/old_gemini_chiffrage/**",
  ]),
]);

export default eslintConfig;

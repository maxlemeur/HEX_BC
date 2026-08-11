import { runArchitectureBudgetCheck } from "../src/test/architecture-budgets";

const result = runArchitectureBudgetCheck();
const cycleCount = result.analysis.cycles.length;
console.log(
  `Architecture budgets passed (${result.analysis.modules.length} modules, ` +
    `${cycleCount} allowed runtime ${cycleCount === 1 ? "cycle" : "cycles"}).`
);

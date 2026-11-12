// Ways the Decisions token ceiling can fail, written before the code (TI-663 C1-C3):
// a call starts although calls in flight could exceed the ceiling; the reserve
// ignores the largest call seen; a failed call without usage is not counted; a
// finish without a start corrupts the in-flight count; a zero or fractional
// ceiling is accepted. A browser journey cannot observe any of this. TI-704:
// asking whether a call fits (to wait for one in flight) reserves a slot or
// counts a refusal.
import { describe, expect, it } from "vitest";

import { createDecisionsTokenBudget } from "@/lib/ai/decisions-budget";

describe("Decisions token budget", () => {
  it("counts one reserve per call in flight before starting another", () => {
    const budget = createDecisionsTokenBudget(100, 30);
    expect([budget.tryStart(), budget.tryStart(), budget.tryStart(), budget.tryStart()]).toEqual([true, true, true, false]);
    expect(budget.snapshot()).toMatchObject({ spent_tokens: 0, refused_starts: 1 });
  });

  it("tells whether one more call fits without reserving it or counting a refusal (TI-704: wait for a call in flight)", () => {
    const budget = createDecisionsTokenBudget(100, 30);
    expect([budget.tryStart(), budget.tryStart(), budget.tryStart()]).toEqual([true, true, true]);
    // 3 reserves in flight: a fourth would pass 100.
    expect([budget.fits(), budget.fits()]).toEqual([false, false]);
    budget.finish({ total_tokens: 10 });
    // 10 spent and 2 reserves of 30 in flight: one more fits exactly, not when each call counts at least 31.
    expect(budget.fits()).toBe(true);
    expect(budget.fits(31)).toBe(false);
    expect(budget.snapshot()).toMatchObject({ refused_starts: 0, calls: 1, spent_tokens: 10 });
    expect(budget.tryStart()).toBe(true);
    expect(budget.fits()).toBe(false);
    expect(budget.snapshot().refused_starts).toBe(0);
  });

  it("raises the reserve to the largest call seen and stops before exceeding", () => {
    const budget = createDecisionsTokenBudget(100, 10);
    expect(budget.tryStart()).toBe(true);
    budget.finish({ total_tokens: 45 });
    expect(budget.tryStart()).toBe(true);
    expect(budget.tryStart()).toBe(false);
    budget.finish({ total_tokens: 40 });
    expect(budget.snapshot()).toMatchObject({ spent_tokens: 85, calls: 2, largest_call_tokens: 45 });
    expect(budget.tryStart()).toBe(false);
  });

  it("counts a failed call without usage and refuses an unmatched finish", () => {
    const budget = createDecisionsTokenBudget(50, 10);
    expect(budget.tryStart()).toBe(true);
    budget.finish(null);
    expect(budget.snapshot()).toMatchObject({ calls: 1, calls_without_usage: 1, spent_tokens: 0 });
    expect(() => budget.finish({ total_tokens: 1 })).toThrow();
  });

  it("refuses an invalid ceiling or estimate", () => {
    expect(() => createDecisionsTokenBudget(0, 10)).toThrow();
    expect(() => createDecisionsTokenBudget(10.5, 10)).toThrow();
    expect(() => createDecisionsTokenBudget(10, 0)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { runScenario } from "./balance";

/**
 * Guards the difficulty curve: a sensible player starting homeless with nothing should be able to
 * survive and find work, but not instantly. Run `npm run balance` for the full report.
 */
describe("balance", () => {
  const runs = [
    runScenario("Lyon", "hardEconomic", "homeless", 11, 150),
    runScenario("Tokyo", "hardEconomic", "homeless", 22, 150),
    runScenario("Lagos", "hardEconomic", "homeless", 33, 150),
    runScenario("Warsaw", "hardEconomic", "homeless", 22, 150),
  ];

  it("lets a homeless start survive", () => {
    for (const r of runs) {
      expect(r.hospitalVisits, r.city).toBeLessThanOrEqual(2);
      expect(r.finalHealth, r.city).toBeGreaterThan(30);
    }
  });

  it("makes finding work possible but not instant", () => {
    const employed = runs.filter((r) => r.jobsHeld > 0).length;
    expect(employed).toBeGreaterThanOrEqual(3);
    const instant = runs.filter((r) => r.firstJobDay === 0).length;
    expect(instant).toBeLessThan(runs.length);
  });

  it("starting at your parents' house is easier than starting homeless", () => {
    const parents = runScenario("Lyon", "economic", "parents", 11, 150);
    expect(parents.daysHomeless).toBe(0);
    expect(parents.jobsHeld).toBeGreaterThan(0);
  });
});

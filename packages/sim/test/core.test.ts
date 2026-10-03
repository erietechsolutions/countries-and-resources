import { describe, expect, it } from "vitest";
import {
  addYears,
  ageInYears,
  EventBus,
  formatDate,
  formatMoney,
  formatTime,
  fromDate,
  Rng,
  toDateParts,
} from "../src";

describe("Rng", () => {
  it("is deterministic for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it("resumes from a saved state", () => {
    const a = new Rng(7);
    a.next();
    const resumed = new Rng(a.state);
    expect(resumed.next()).toBe(a.next());
  });

  it("gives keyed streams that differ by key", () => {
    expect(Rng.fromKey(1, "country:FRA").next()).not.toBe(Rng.fromKey(1, "country:DEU").next());
  });

  it("keeps int() within inclusive bounds", () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe("calendar", () => {
  it("round-trips dates", () => {
    const t = fromDate(2026, 10, 3, 8);
    expect(toDateParts(t)).toMatchObject({ year: 2026, month: 10, day: 3, hour: 8, weekday: 6 });
    expect(formatDate(t)).toBe("October 3, 2026");
    expect(formatTime(t)).toBe("8:00 AM");
  });

  it("computes ages across birthdays", () => {
    const birth = fromDate(2008, 6, 15);
    expect(ageInYears(birth, fromDate(2026, 6, 14))).toBe(17);
    expect(ageInYears(birth, fromDate(2026, 6, 15))).toBe(18);
  });

  it("maps February 29 to February 28 in non-leap years", () => {
    expect(toDateParts(addYears(fromDate(2024, 2, 29), 1))).toMatchObject({ month: 2, day: 28 });
  });
});

describe("EventBus", () => {
  it("delivers typed and wildcard events and supports unsubscribing", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.on("day", (e) => seen.push(`day:${e.time}`));
    bus.onAny((e) => seen.push(`any:${e.type}`));
    bus.emit({ type: "day", time: 5 });
    off();
    bus.emit({ type: "day", time: 6 });
    expect(seen).toEqual(["day:5", "any:day", "any:day"]);
  });
});

describe("formatMoney", () => {
  it("formats cents", () => {
    expect(formatMoney(200_000)).toBe("$2,000.00");
    expect(formatMoney(-1_505)).toBe("-$15.05");
    expect(formatMoney(123_456, true)).toBe("$1,235");
  });
});

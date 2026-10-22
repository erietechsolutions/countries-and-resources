import type { System } from "../core/systems";
import { militiaDaily, militiaMonthly } from "./militia";
import { nationDaily } from "./nation";
import { warMonthly, warWeekly } from "./war";

/** Militias, uprisings, wars and new nations. */
export const conflictSystem: System = {
  id: "conflict",
  onDay(ctx, date) {
    militiaDaily(ctx);
    nationDaily(ctx);
    warWeekly(ctx, date);
  },
  onMonth(ctx) {
    militiaMonthly(ctx);
    warMonthly(ctx);
  },
};

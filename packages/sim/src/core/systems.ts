import { economySystem } from "../economy/economy";
import { financeSystem } from "../finance/finance";
import { activitySystem } from "../life/activities";
import { familySystem } from "../life/family";
import { housingSystem } from "../life/housing";
import { immigrationSystem } from "../life/moving";
import { businessSystem } from "../business/business";
import { politicsSystem } from "../politics/system";
import { socialSystem } from "../social/social";
import { jobsSystem } from "../work/jobs";
import { ageInYears, type DateParts, toDateParts } from "./calendar";
import type { GameContext } from "./game";

/**
 * A system is one slice of the simulation (needs, jobs, markets, elections...). Each hook runs
 * at the matching calendar boundary, in the order systems are listed.
 */
export interface System {
  id: string;
  onHour?(ctx: GameContext): void;
  onDay?(ctx: GameContext, date: DateParts): void;
  onMonth?(ctx: GameContext, date: DateParts): void;
  onYear?(ctx: GameContext, date: DateParts): void;
}

export const birthdaySystem: System = {
  id: "birthday",
  onDay(ctx, date) {
    const birth = toDateParts(ctx.state.player.birthTime);
    if (birth.month === date.month && birth.day === date.day) {
      const age = ageInYears(ctx.state.player.birthTime, ctx.state.time);
      ctx.log("life", `Happy birthday! You turned ${age}.`);
    }
  },
};

export const newYearSystem: System = {
  id: "newYear",
  onYear(ctx, date) {
    ctx.log("system", `Welcome to ${date.year}.`);
  },
};

/**
 * Order matters: the player's hour (needs, activities, shifts) happens first, then the systems
 * that settle money and housing, and finally the wider world.
 */
export const defaultSystems: readonly System[] = [
  activitySystem,
  jobsSystem,
  financeSystem,
  housingSystem,
  familySystem,
  immigrationSystem,
  socialSystem,
  businessSystem,
  politicsSystem,
  economySystem,
  birthdaySystem,
  newYearSystem,
];

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

export const defaultSystems: readonly System[] = [birthdaySystem, newYearSystem];

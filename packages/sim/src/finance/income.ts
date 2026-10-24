import { activeBusinesses, type Business } from "../business/business";
import type { GameContext } from "../core/game";
import { propertyRent } from "../wealth/wealth";
import { monthlyIncomeCents } from "./finance";

/** Days of steady pay before landlords and lenders count an income. */
export const VERIFIED_DAYS = 14;
const DAY = 24;

/**
 * What a business can keep paying its owner: its recent average monthly profit (before the
 * owner's salary), or, before it has a full month of results, a third of its cash.
 */
export function sustainableSalary(b: Business): number {
  const recent = b.history.slice(-3);
  if (recent.length === 0) return Math.max(0, Math.round(b.cashCents / 3));
  return Math.max(0, Math.round(recent.reduce((s, m) => s + m.profitCents, 0) / recent.length));
}

/** Whether a business has paid its owner without a miss for long enough to count. */
export function salaryVerified(ctx: GameContext, b: Business): boolean {
  return (
    (b.ownerSalaryCents ?? 0) > 0 &&
    b.salaryPaidSince !== undefined &&
    b.salaryPaidSince !== null &&
    ctx.state.time - b.salaryPaidSince >= VERIFIED_DAYS * DAY
  );
}

export interface DocumentedIncome {
  /** Monthly, from a job held at least 14 days. */
  job: number;
  /** Monthly owner salaries that have been paid steadily for 14 days, capped at what the business earns. */
  business: number;
  /** Monthly rent from tenants. */
  rent: number;
  total: number;
  /** The player has a job or business income that hasn't been steady for 14 days yet. */
  pending: boolean;
}

/** The income landlords and lenders will accept as proof. */
export function documentedIncome(ctx: GameContext): DocumentedIncome {
  const p = ctx.state.player;
  const now = ctx.state.time;
  const jobSteady = p.job !== null && now - p.job.startedAt >= VERIFIED_DAYS * DAY;
  const job = jobSteady ? monthlyIncomeCents(p) : 0;
  let business = 0;
  let pending = p.job !== null && !jobSteady;
  for (const b of activeBusinesses(ctx)) {
    if (!(b.ownerSalaryCents ?? 0)) continue;
    if (!salaryVerified(ctx, b)) {
      pending = true;
      continue;
    }
    business += Math.min(b.ownerSalaryCents!, sustainableSalary(b));
  }
  const rent = ctx.state.wealth.properties
    .filter(
      (x) =>
        x.rentedOut && !(p.housing.kind === "owned" && p.housing.propertyId === x.id) && !x.vacant,
    )
    .reduce((s, x) => s + propertyRent(ctx, x), 0);
  return { job, business, rent, total: job + business + rent, pending };
}

/** Monthly salaries the player has set for themselves, whether or not they're steady yet. */
export function ownerSalaries(ctx: GameContext): number {
  return activeBusinesses(ctx).reduce((s, b) => s + (b.ownerSalaryCents ?? 0), 0);
}

/** Holding a job or running a business: parents, dates and the player's mood all notice. */
export function isWorking(ctx: GameContext): boolean {
  return ctx.state.player.job !== null || activeBusinesses(ctx).length > 0;
}

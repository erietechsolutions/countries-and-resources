import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { cityCosts, UNIT_TYPES, unitType } from "../economy/costs";
import { monthlyIncomeCents, transact } from "../finance/finance";
import { formatMoney } from "../world/format";
import { averageRelationship, MOVE_BACK_RELATIONSHIP } from "./family";
import { hasDocuments } from "./moving";
import type { UnitType } from "./types";

/** Landlords want a monthly income of at least this many times the rent. */
export const INCOME_TO_RENT = 2.5;
/** Parents will co-sign a lease above this relationship. */
export const COSIGN_RELATIONSHIP = 60;
/** Landlords want proof of steady work before renting without a co-signer. */
export const MIN_JOB_DAYS = 30;

export interface Listing {
  unit: UnitType;
  label: string;
  rentCents: number;
  /** Security deposit plus first month's rent. */
  upfrontCents: number;
  available: boolean;
  reason?: string;
  cosigned: boolean;
}

export function canCosign(ctx: GameContext): boolean {
  const fam = ctx.state.family;
  return fam.length > 0 && averageRelationship(fam) >= COSIGN_RELATIONSHIP && fam[0]!.wealth >= 0.8;
}

export function rentalListings(ctx: GameContext): Listing[] {
  const p = ctx.state.player;
  const costs = cityCosts(ctx, p.cityId);
  const income = monthlyIncomeCents(p);
  const cosign = canCosign(ctx);
  const evicted = (p.cooldowns.evicted ?? 0) > ctx.state.time;
  return UNIT_TYPES.map((u) => {
    const rent = costs.rentCents(u.id);
    const upfront = rent * 2;
    const tenureOk = p.job !== null && ctx.state.time - p.job.startedAt >= MIN_JOB_DAYS * 24;
    const incomeOk = income >= rent * INCOME_TO_RENT && tenureOk;
    let reason: string | undefined;
    if (p.housing.kind === "renting" && p.housing.unit === u.id) reason = "You already live here.";
    else if (!hasDocuments(ctx)) reason = "Landlords require legal residency papers.";
    else if (evicted) reason = "Landlords won't rent to you so soon after an eviction.";
    else if (!incomeOk && !cosign) {
      reason =
        income >= rent * INCOME_TO_RENT && !tenureOk
          ? `Landlords want to see ${MIN_JOB_DAYS} days at your job (or a co-signer).`
          : `Needs a monthly income of ${formatMoney(rent * INCOME_TO_RENT, true)} or a co-signer.`;
    } else if (p.cashCents < upfront)
      reason = `Needs ${formatMoney(upfront, true)} up front (deposit + first month).`;
    return {
      unit: u.id,
      label: u.label,
      rentCents: rent,
      upfrontCents: upfront,
      available: !reason,
      reason,
      cosigned: !incomeOk && cosign,
    };
  });
}

function returnDeposit(ctx: GameContext): void {
  const h = ctx.state.player.housing;
  if (h.kind === "renting" && h.missedPayments === 0) {
    transact(ctx, h.rentCents, "deposit", "Security deposit returned");
  }
}

export function rentUnit(ctx: GameContext, unit: UnitType): string | null {
  const listing = rentalListings(ctx).find((l) => l.unit === unit);
  if (!listing) return "Unknown apartment.";
  if (!listing.available) return listing.reason ?? "Not available.";
  const p = ctx.state.player;
  returnDeposit(ctx);
  transact(ctx, -listing.rentCents, "deposit", "Security deposit");
  transact(ctx, -listing.rentCents, "rent", `First month's rent: ${listing.label.toLowerCase()}`);
  p.housing = {
    kind: "renting",
    unit,
    rentCents: listing.rentCents,
    since: ctx.state.time,
    missedPayments: 0,
  };
  p.shelterBedUntil = null;
  ctx.alert(
    "good",
    `You moved into a ${listing.label.toLowerCase()}. Rent is ${formatMoney(listing.rentCents)} a month.`,
  );
  return null;
}

export function moveBackHome(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (p.housing.kind === "parents") return "You already live with your parents.";
  if (ctx.state.family[0] && ctx.state.family[0].cityId !== p.cityId)
    return "Your parents live in another city.";
  if (ctx.state.family.length === 0) return "You have no family to move in with.";
  if (averageRelationship(ctx.state.family) < MOVE_BACK_RELATIONSHIP) {
    return `Your parents won't take you back yet (relationship ${MOVE_BACK_RELATIONSHIP}+ needed).`;
  }
  returnDeposit(ctx);
  p.housing = { kind: "parents" };
  p.shelterBedUntil = null;
  ctx.alert("info", "You moved back in with your parents.");
  return null;
}

export const housingSystem: System = {
  id: "housing",
  onMonth(ctx) {
    const p = ctx.state.player;
    const h = p.housing;
    if (h.kind !== "renting") return;
    // Rent follows the local housing market each month.
    const market = cityCosts(ctx, p.cityId).rentCents(h.unit);
    if (market > h.rentCents)
      h.rentCents = Math.round((h.rentCents + (market - h.rentCents) * 0.25) / 100) * 100;
    if (p.cashCents >= h.rentCents) {
      transact(ctx, -h.rentCents, "rent", `Rent: ${unitType(h.unit).label.toLowerCase()}`);
      h.missedPayments = 0;
      return;
    }
    h.missedPayments++;
    if (h.missedPayments >= 2) {
      p.housing = { kind: "homeless" };
      p.cooldowns.evicted = ctx.state.time + 90 * 24;
      ctx.alert(
        "bad",
        "You were evicted for not paying rent. You lost your deposit and are now homeless.",
      );
    } else {
      ctx.alert(
        "bad",
        `You couldn't pay this month's rent (${formatMoney(h.rentCents)}). Miss another and you'll be evicted.`,
      );
    }
  },
};

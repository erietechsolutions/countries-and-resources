import { addDays } from "../core/calendar";
import type { GameContext } from "../core/game";
import { cityCosts } from "../economy/costs";
import { transact } from "../finance/finance";
import { adjustReputation } from "../social/social";
import { formatMoney, formatPercent } from "../world/format";
import type { CityId, ProvinceId } from "../world/geography";
import type { Party } from "../world/types";
import { playerParty } from "./party";

/**
 * Parties grow from the ground up. On top of its national support, a party can build support in
 * a city and its region through volunteering, flyers, rallies and town halls. Small parties need
 * this to be taken seriously: rallies draw crowds from 3% local support, and a party needs 8%
 * locally before voters there will back its candidates for local office.
 */
export const RALLY_SUPPORT = 0.03;
export const TOWN_HALL_SUPPORT = 0.05;
export const FILING_SUPPORT = 0.08;

export type Locality = { level: "city"; id: CityId } | { level: "region"; id: ProvinceId };

function key(where: Locality, partyId: string): string {
  return `${where.level}:${where.id}|${partyId}`;
}

/** Support built locally on top of national popularity, as a share of voters. */
export function localBoost(ctx: GameContext, where: Locality, partyId: string): number {
  return ctx.state.politics.localSupport?.[key(where, partyId)] ?? 0;
}

/** A party's support in a city or region: national popularity plus what's been built there. */
export function localSupport(ctx: GameContext, where: Locality, party: Party): number {
  return Math.min(0.95, party.popularity + localBoost(ctx, where, party.id));
}

/** The player's city and region. */
export function homeLocalities(ctx: GameContext): { city: Locality; region: Locality } {
  const cityId = ctx.state.player.cityId;
  return {
    city: { level: "city", id: cityId },
    region: { level: "region", id: ctx.geography.cities[cityId]!.provinceId },
  };
}

/** How well the player sells the party: community standing, activism and fame. */
function persuasiveness(ctx: GameContext): number {
  const rep = ctx.state.player.reputation;
  return 1 + Math.max(-0.5, (rep.community + rep.activists) / 200) + rep.fame / 200;
}

/**
 * Builds local support for the player's party. Each point is harder to win than the last: the
 * easy converts come first.
 */
export function growSupport(ctx: GameContext, cityGain: number): number {
  const party = playerParty(ctx);
  if (!party) return 0;
  const { city, region } = homeLocalities(ctx);
  const current = localSupport(ctx, city, party);
  const diminishing = Math.max(0.12, 1 - current / 0.25);
  const gain = cityGain * diminishing * persuasiveness(ctx);
  const all = (ctx.state.politics.localSupport ??= {});
  all[key(city, party.id)] = Math.round(((all[key(city, party.id)] ?? 0) + gain) * 1e5) / 1e5;
  all[key(region, party.id)] =
    Math.round(((all[key(region, party.id)] ?? 0) + gain * 0.4) * 1e5) / 1e5;
  return gain;
}

/** Why the player's party can't hold an event needing this much local support, or null. */
export function eventBlocker(ctx: GameContext, needed: number): string | null {
  const party = playerParty(ctx);
  if (!party) return "Join or found a party first.";
  const support = localSupport(ctx, homeLocalities(ctx).city, party);
  if (support < needed)
    return `Your party needs ${formatPercent(needed, 0)} support here (now ${formatPercent(support, 1)}).`;
  return null;
}

export function flyerMinimum(ctx: GameContext): number {
  return cityCosts(ctx, ctx.state.player.cityId).medianWageCents * 10;
}

/** Flyers, posters and online ads: money buys reach, with fast-falling returns. */
export function promoteParty(ctx: GameContext, amountCents: number): string | null {
  const p = ctx.state.player;
  if (!playerParty(ctx)) return "Join or found a party first.";
  if (!Number.isInteger(amountCents) || amountCents < flyerMinimum(ctx))
    return `A campaign costs at least ${formatMoney(flyerMinimum(ctx), true)}.`;
  if (amountCents > p.cashCents) return "You don't have that much cash.";
  if ((p.cooldowns.partyAds ?? 0) > ctx.state.time) return "Your last campaign is still running.";
  p.cooldowns.partyAds = addDays(ctx.state.time, 7);
  transact(ctx, -amountCents, "other", "Flyers and ads for your party");
  const wage = cityCosts(ctx, p.cityId).medianWageCents;
  const gain = growSupport(ctx, 0.0015 * Math.log10(1 + amountCents / (wage * 10)));
  ctx.log(
    "politics",
    `Your campaign reached thousands of people (+${formatPercent(gain, 2)} locally).`,
  );
  return null;
}

/** Monthly: support fades without work, and strong local support spreads nationally. */
export function grassrootsMonth(ctx: GameContext): void {
  const all = ctx.state.politics.localSupport;
  if (!all) return;
  for (const [k, v] of Object.entries(all)) {
    const next = Math.round(v * 0.94 * 1e5) / 1e5;
    if (next < 0.0005) delete all[k];
    else all[k] = next;
    // A city's worth of new supporters nudges the party's national standing.
    if (k.startsWith("city:")) {
      const partyId = k.split("|")[1]!;
      const country = Object.values(ctx.state.world.countries).find((c) =>
        c.parties.some((x) => x.id === partyId),
      );
      const party = country?.parties.find((x) => x.id === partyId);
      if (party) party.popularity += v * 0.01;
    }
  }
}

/** Effects of a rally or town hall, used by the activities. */
export function holdEvent(ctx: GameContext, kind: "rally" | "townHall"): void {
  const party = playerParty(ctx);
  if (!party) return;
  // Turnout is never guaranteed.
  const turnout = ctx.rng.float(0.3, 1.3);
  const gain = growSupport(ctx, (kind === "rally" ? 0.003 : 0.0025) * turnout);
  if (kind === "rally") {
    adjustReputation(ctx, "fame", 1 * turnout);
    adjustReputation(ctx, "activists", 1.5);
    party.popularity += 0.0003 * turnout;
  } else {
    adjustReputation(ctx, "community", 2);
  }
  ctx.state.player.politics.standing += 4;
  const what = kind === "rally" ? "rally" : "town hall";
  ctx.alert(
    turnout > 0.7 ? "good" : "info",
    turnout > 0.7
      ? `Your ${what} drew a big crowd (+${formatPercent(gain, 2)} support here).`
      : `Your ${what} was half empty (+${formatPercent(gain, 2)} support here).`,
    "politics",
  );
}

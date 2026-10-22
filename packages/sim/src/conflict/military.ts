import type { GameContext } from "../core/game";
import { hashString } from "../core/rng";
import { ruleOfLaw } from "../politics/policies";
import type { CountryId, ProvinceId } from "../world/geography";
import type { CountryState, GovernmentType, Ideology, Military } from "../world/types";
import { pairKey, type War } from "./types";

/** How militarized each kind of government tends to be. */
const ARMY_FACTOR: Record<GovernmentType, number> = {
  democracy: 1,
  constitutionalMonarchy: 1,
  oligarchy: 1.1,
  oneParty: 1.4,
  militaryJunta: 1.8,
  absoluteMonarchy: 1.3,
  theocracy: 1.3,
};

/** The size of army a country keeps in peacetime at normal spending. */
export function peacetimeTroops(c: CountryState): number {
  return Math.round(c.population * 0.003 * ARMY_FACTOR[c.government]);
}

/** A country's armed forces, created from its size and wealth the first time they matter. */
export function militaryOf(c: CountryState): Military {
  c.military ??= {
    troops: peacetimeTroops(c),
    quality: Math.round((0.25 + c.development * 0.6) * 100) / 100,
    spending: 0.5,
    mobilization: 0,
    exhaustion: 0,
  };
  return c.military;
}

/** Fighting strength of a country's army in the field. */
export function armyPower(c: CountryState): number {
  const m = militaryOf(c);
  return (
    m.troops *
    (0.5 + m.quality) *
    (0.4 + m.mobilization) *
    (0.6 + c.stability / 250) *
    (1 - m.exhaustion / 200)
  );
}

/** Police and local garrisons holding one region against rebels. */
export function garrisonPower(ctx: GameContext, provinceId: ProvinceId): number {
  const country = ctx.state.world.countries[ctx.geography.provinces[provinceId]!.countryId]!;
  const province = ctx.state.world.provinces[provinceId]!;
  return (
    Math.max(15, province.population / 4000) *
    (0.4 + ruleOfLaw(country)) *
    (0.5 + province.stability / 100)
  );
}

/** Chance that a force with power `a` beats one with power `b`. */
export function winChance(a: number, b: number): number {
  const x = Math.max(1, a) ** 1.5;
  const y = Math.max(1, b) ** 1.5;
  return x / (x + y);
}

// ---------------------------------------------------------------------------------------------
// Diplomacy

function rulingIdeology(c: CountryState): Ideology {
  return (
    c.parties.find((p) => p.id === c.rulingPartyId)?.ideology ?? {
      economic: 0,
      social: 0,
      authority: c.government === "democracy" ? -0.3 : 0.5,
      nationalism: 0,
    }
  );
}

/** Where relations settle without diplomacy: similar governments get along. */
export function baseRelation(ctx: GameContext, a: CountryId, b: CountryId): number {
  const ca = ctx.state.world.countries[a];
  const cb = ctx.state.world.countries[b];
  if (!ca || !cb) return 0;
  const ia = rulingIdeology(ca);
  const ib = rulingIdeology(cb);
  const distance =
    Math.abs(ia.economic - ib.economic) +
    Math.abs(ia.social - ib.social) +
    Math.abs(ia.authority - ib.authority) +
    Math.abs(ia.nationalism - ib.nationalism);
  const noise = (hashString(pairKey(a, b)) % 51) - 25;
  const same = ca.government === cb.government ? 10 : 0;
  return Math.round(Math.max(-100, Math.min(100, 15 - distance * 12 + noise + same)));
}

export function relation(ctx: GameContext, a: CountryId, b: CountryId): number {
  return ctx.state.conflict.relations[pairKey(a, b)] ?? baseRelation(ctx, a, b);
}

export function adjustRelation(ctx: GameContext, a: CountryId, b: CountryId, delta: number): void {
  const next = Math.max(-100, Math.min(100, relation(ctx, a, b) + delta));
  ctx.state.conflict.relations[pairKey(a, b)] = Math.round(next);
}

export function allied(ctx: GameContext, a: CountryId, b: CountryId): boolean {
  return ctx.state.conflict.alliances.includes(pairKey(a, b));
}

export function alliesOf(ctx: GameContext, id: CountryId): CountryId[] {
  return ctx.state.conflict.alliances
    .map((k) => k.split("|") as [CountryId, CountryId])
    .filter(([a, b]) => a === id || b === id)
    .map(([a, b]) => (a === id ? b : a));
}

export function activeWars(ctx: GameContext): War[] {
  return ctx.state.conflict.wars.filter((w) => w.status === "active");
}

export function warsOf(ctx: GameContext, id: CountryId): War[] {
  return activeWars(ctx).filter((w) => w.attackers.includes(id) || w.defenders.includes(id));
}

/** The side a country fights on in a war, or null. */
export function sideOf(war: War, id: CountryId): "attackers" | "defenders" | null {
  if (war.attackers.includes(id)) return "attackers";
  if (war.defenders.includes(id)) return "defenders";
  return null;
}

export function warBetween(ctx: GameContext, a: CountryId, b: CountryId): War | undefined {
  return activeWars(ctx).find((w) => {
    const sa = sideOf(w, a);
    const sb = sideOf(w, b);
    return sa !== null && sb !== null && sa !== sb;
  });
}

/** The country the player leads as head of government, if any. */
export function playerRuledCountry(ctx: GameContext): CountryId | null {
  const office = ctx.state.politics.offices.find(
    (o) => o.kind === "headOfGovernment" && o.holders.includes("player"),
  );
  return office?.countryId ?? null;
}

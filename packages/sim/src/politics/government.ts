import { addDays, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import { cityCosts } from "../economy/costs";
import { createPerson, personById } from "../social/people";
import { adjustReputation } from "../social/social";
import type { CityId, CountryId } from "../world/geography";
import type { CountryState, GovernmentType, Party } from "../world/types";
import { parseScope, policyFor, type PolicyDef } from "./policies";
import type { HolderId, Office, OfficeKind, OfficeLevel } from "./types";

const YEAR = 365 * 24;

/** Whether a government type holds real elections. */
export function isDemocratic(g: GovernmentType): boolean {
  return g === "democracy" || g === "constitutionalMonarchy" || g === "oligarchy";
}

/** Presidential systems elect the head of government directly; others pick the largest party's leader. */
export function isPresidential(c: CountryState): boolean {
  return c.government === "democracy" && c.headOfStateTitle === "President";
}

interface OfficeTemplate {
  kind: OfficeKind;
  level: OfficeLevel;
  seats: number;
  termYears: number;
  /** Monthly salary as a multiple of the local median hourly wage. */
  salaryWages: number;
}

const TEMPLATES: Record<OfficeKind, OfficeTemplate> = {
  councilor: { kind: "councilor", level: "city", seats: 7, termYears: 4, salaryWages: 50 },
  mayor: { kind: "mayor", level: "city", seats: 1, termYears: 4, salaryWages: 220 },
  regionalCouncilor: {
    kind: "regionalCouncilor",
    level: "region",
    seats: 11,
    termYears: 4,
    salaryWages: 140,
  },
  governor: { kind: "governor", level: "region", seats: 1, termYears: 4, salaryWages: 320 },
  legislator: { kind: "legislator", level: "national", seats: 101, termYears: 4, salaryWages: 280 },
  headOfGovernment: {
    kind: "headOfGovernment",
    level: "national",
    seats: 1,
    termYears: 4,
    salaryWages: 600,
  },
};

export function officeTitle(ctx: GameContext, o: Office): string {
  const city = o.cityId !== undefined ? ctx.geography.cities[o.cityId]?.name : undefined;
  const region =
    o.provinceId !== undefined ? ctx.geography.provinces[o.provinceId]?.name : undefined;
  const country = ctx.geography.countries.find((c) => c.id === o.countryId)?.name;
  switch (o.kind) {
    case "councilor":
      return `${city} City Council`;
    case "mayor":
      return `Mayor of ${city}`;
    case "regionalCouncilor":
      return `${region} Regional Council`;
    case "governor":
      return `Governor of ${region}`;
    case "legislator":
      return `${country} National Legislature`;
    case "headOfGovernment":
      return `${ctx.state.world.countries[o.countryId]?.headOfStateTitle ?? "Leader"} of ${country}`;
  }
}

/** Picks a party weighted by popularity (legal parties only in democracies). */
function pickParty(ctx: GameContext, country: CountryState): Party | null {
  const parties = country.parties.filter((p) => p.legal || !isDemocratic(country.government));
  if (parties.length === 0) return null;
  if (!isDemocratic(country.government) && country.rulingPartyId) {
    return country.parties.find((p) => p.id === country.rulingPartyId) ?? null;
  }
  return ctx.rng.weighted(parties.map((p) => [p, p.popularity + 0.01] as const));
}

export function newPolitician(ctx: GameContext, cityId: CityId, party: Party | null): string {
  const person = createPerson(ctx, {
    cityId,
    minAge: 32,
    maxAge: 68,
    occupation: "Politician",
    role: "politician",
  });
  if (party) person.ideology = { ...party.ideology };
  return person.id;
}

function createOffice(
  ctx: GameContext,
  kind: OfficeKind,
  countryId: CountryId,
  anchorCity: CityId,
  extra: Partial<Office>,
): Office {
  const t = TEMPLATES[kind];
  const country = ctx.state.world.countries[countryId]!;
  const politics = ctx.state.politics;
  const holders: HolderId[] = [];
  const holderParties: (string | null)[] = [];
  for (let i = 0; i < t.seats; i++) {
    const party =
      kind === "headOfGovernment" && country.rulingPartyId
        ? (country.parties.find((p) => p.id === country.rulingPartyId) ?? null)
        : pickParty(ctx, country);
    holders.push(newPolitician(ctx, anchorCity, party));
    holderParties.push(party?.id ?? null);
  }
  const democratic = isDemocratic(country.government);
  const office: Office = {
    id: `o${politics.nextId++}`,
    kind,
    level: t.level,
    title: "",
    countryId,
    seats: t.seats,
    holders,
    holderParties,
    termYears: t.termYears,
    // Elections are staggered so they don't all happen at once.
    nextElection: democratic ? addDays(ctx.state.time, ctx.rng.int(60, t.termYears * 365)) : null,
    salaryCents: Math.round(cityCosts(ctx, anchorCity).medianWageCents * t.salaryWages),
    ...extra,
  };
  office.title = officeTitle(ctx, office);
  politics.offices.push(office);
  return office;
}

/** Sets up the offices relevant to where the player lives (city, region and country). */
export function ensurePolitics(ctx: GameContext): void {
  const politics = ctx.state.politics;
  const cityId = ctx.state.player.cityId;
  const geoCity = ctx.geography.cities[cityId]!;
  const countryId = geoCity.countryId;
  if (!ctx.state.world.countries[countryId]?.population) return;
  if (!politics.setUpCountries.includes(countryId)) {
    politics.setUpCountries.push(countryId);
    const capital =
      ctx.geography.countries.find((c) => c.id === countryId)?.capitalCityId ?? cityId;
    const legislature = createOffice(ctx, "legislator", countryId, capital ?? cityId, {});
    // Seats follow national party popularity.
    allocateSeatsByPopularity(ctx, legislature);
    // A first look at the public finances (debt starts from zero).
    const country = ctx.state.world.countries[countryId]!;
    if (!country.budget) {
      runBudget(country);
      country.budget!.debtCents = 0;
    }
    createOffice(ctx, "headOfGovernment", countryId, capital ?? cityId, {});
  }
  if (!politics.setUpCities.includes(cityId)) {
    politics.setUpCities.push(cityId);
    createOffice(ctx, "councilor", countryId, cityId, { cityId });
    createOffice(ctx, "mayor", countryId, cityId, { cityId });
    const regionHasOffices = politics.offices.some((o) => o.provinceId === geoCity.provinceId);
    if (!regionHasOffices) {
      createOffice(ctx, "regionalCouncilor", countryId, cityId, { provinceId: geoCity.provinceId });
      createOffice(ctx, "governor", countryId, cityId, { provinceId: geoCity.provinceId });
    }
  }
}

function allocateSeatsByPopularity(ctx: GameContext, office: Office): void {
  const country = ctx.state.world.countries[office.countryId]!;
  const legal = country.parties.filter((p) => p.legal);
  if (legal.length === 0) return;
  const seats = largestRemainder(
    legal.map((p) => p.popularity),
    office.seats,
  );
  let i = 0;
  legal.forEach((party, idx) => {
    for (let s = 0; s < seats[idx]!; s++) {
      office.holderParties[i] = party.id;
      const person = personById(ctx, office.holders[i]!);
      if (person) person.ideology = { ...party.ideology };
      i++;
    }
  });
}

/** Seat allocation by the largest remainder method. */
export function largestRemainder(shares: number[], seats: number): number[] {
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const quotas = shares.map((s) => (s / total) * seats);
  const result = quotas.map(Math.floor);
  let left = seats - result.reduce((a, b) => a + b, 0);
  const order = quotas.map((q, i) => [q - Math.floor(q), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    result[i]!++;
    left--;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Queries

export function officesFor(ctx: GameContext, cityId: CityId): Office[] {
  const geoCity = ctx.geography.cities[cityId];
  if (!geoCity) return [];
  return ctx.state.politics.offices.filter(
    (o) =>
      o.countryId === geoCity.countryId &&
      (o.level === "national" ||
        (o.level === "region" && o.provinceId === geoCity.provinceId) ||
        (o.level === "city" && o.cityId === cityId)),
  );
}

export function playerOffices(ctx: GameContext): Office[] {
  return ctx.state.politics.offices.filter((o) => o.holders.includes("player"));
}

export function officeScope(o: Office): string {
  if (o.level === "city") return `city:${o.cityId}`;
  if (o.level === "region") return `region:${o.provinceId}`;
  return `national:${o.countryId}`;
}

/** The executive office (mayor, governor, head of government) for a scope. */
export function executiveFor(ctx: GameContext, scope: string): Office | undefined {
  const { level, id } = parseScope(scope);
  return ctx.state.politics.offices.find(
    (o) =>
      (level === "city" && o.kind === "mayor" && String(o.cityId) === id) ||
      (level === "region" && o.kind === "governor" && String(o.provinceId) === id) ||
      (level === "national" && o.kind === "headOfGovernment" && o.countryId === id),
  );
}

/** The voting body (council or legislature) for a scope. */
export function legislatureFor(ctx: GameContext, scope: string): Office | undefined {
  const { level, id } = parseScope(scope);
  return ctx.state.politics.offices.find(
    (o) =>
      (level === "city" && o.kind === "councilor" && String(o.cityId) === id) ||
      (level === "region" && o.kind === "regionalCouncilor" && String(o.provinceId) === id) ||
      (level === "national" && o.kind === "legislator" && o.countryId === id),
  );
}

export function countryOfScope(ctx: GameContext, scope: string): CountryState {
  const { level, id } = parseScope(scope);
  if (level === "national") return ctx.state.world.countries[id]!;
  if (level === "city")
    return ctx.state.world.countries[ctx.geography.cities[Number(id)]!.countryId]!;
  return ctx.state.world.countries[ctx.geography.provinces[Number(id)]!.countryId]!;
}

// ---------------------------------------------------------------------------------------------
// Laws

/** Changes a policy lever, with all its knock-on effects. Returns false if already at the limit. */
export function enactPolicy(
  ctx: GameContext,
  scope: string,
  policy: PolicyDef,
  direction: 1 | -1,
  passedBy: HolderId,
  supporters: HolderId[] = [],
): boolean {
  const current = policy.get(ctx, scope);
  const next =
    Math.round(
      Math.max(policy.min, Math.min(policy.max, current + policy.step * direction)) * 1000,
    ) / 1000;
  if (next === current) return false;
  policy.set(ctx, scope, next);
  ctx.state.politics.laws.push({
    time: ctx.state.time,
    scope,
    policyId: policy.id,
    direction,
    passedBy,
  });
  if (ctx.state.politics.laws.length > 100) ctx.state.politics.laws.shift();

  // Social classes react; local laws move national mood less.
  const country = countryOfScope(ctx, scope);
  const weight = parseScope(scope).level === "national" ? 1 : 0.15;
  for (const pop of country.pops) {
    pop.satisfaction = Math.max(
      0,
      Math.min(100, pop.satisfaction + policy.classes[pop.class] * direction * weight),
    );
  }
  // The politicians who pushed it gain or lose standing with each group.
  if (passedBy === "player" || supporters.includes("player")) {
    for (const [group, delta] of Object.entries(policy.reputation)) {
      adjustReputation(
        ctx,
        group as Parameters<typeof adjustReputation>[1],
        (delta ?? 0) * direction,
      );
    }
  }
  return true;
}

export function lawDescription(
  ctx: GameContext,
  scope: string,
  policyId: string,
  direction: 1 | -1,
): string {
  const { level } = parseScope(scope);
  const policy = policyFor(policyId, level);
  if (!policy) return policyId;
  return `${direction > 0 ? "Raise" : "Lower"} ${policy.label.toLowerCase()} (now ${policy.format(policy.get(ctx, scope))})`;
}

// ---------------------------------------------------------------------------------------------
// Budgets

export interface Budget {
  debtCents: number;
  revenueCents: number;
  spendingCents: number;
}

export function budgetOf(c: CountryState): Budget {
  return c.budget ?? { debtCents: 0, revenueCents: 0, spendingCents: 0 };
}

/** One month of a country's public finances. Big deficits push up debt, inflation and unrest. */
export function runBudget(c: CountryState): void {
  const monthlyGdp = (c.gdpPerCapita * 100 * c.population) / 12;
  if (monthlyGdp <= 0) return;
  const revenue =
    monthlyGdp * (c.taxes.income * 0.42 + c.taxes.corporate * 0.1 + c.taxes.sales * 0.38);
  const healthcare =
    c.healthcare === "universal" ? 0.07 : c.healthcare === "insurance" ? 0.03 : 0.01;
  const spending =
    monthlyGdp *
    (0.06 +
      c.socialServices * 0.08 +
      healthcare +
      (c.ruleOfLaw ?? 0.5) * 0.025 +
      (c.businessRegulation ?? 0.5) * 0.005);
  const b = budgetOf(c);
  const interest = (b.debtCents * 0.03) / 12;
  b.revenueCents = Math.round(revenue);
  b.spendingCents = Math.round(spending + interest);
  b.debtCents = Math.max(0, Math.round(b.debtCents + spending + interest - revenue));
  c.budget = b;
  const debtRatio = b.debtCents / (monthlyGdp * 12);
  if (debtRatio > 1) {
    c.inflation = Math.min(3, c.inflation + 0.002);
    c.stability = Math.max(0, c.stability - 0.3);
  }
}

export function yearsFromNow(ctx: GameContext, years: number): GameTime {
  return ctx.state.time + Math.round(years * YEAR);
}

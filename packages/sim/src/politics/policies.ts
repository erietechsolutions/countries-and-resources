import type { GameContext } from "../core/game";
import type { RepGroup } from "../social/types";
import { formatPercent } from "../world/format";
import type { CityId } from "../world/geography";
import type { CountryState, Healthcare, Ideology } from "../world/types";
import { defaultLocalPolicies, type LocalPolicies, type OfficeLevel } from "./types";

/** Extra national levers, stored on the country with sensible defaults. */
export function ruleOfLaw(c: CountryState): number {
  return c.ruleOfLaw ?? Math.round((0.2 + c.development * 0.6) * 10) / 10;
}
export function businessRegulation(c: CountryState): number {
  return c.businessRegulation ?? 0.5;
}

const HEALTHCARE_ORDER: Healthcare[] = ["none", "insurance", "universal"];

export interface PolicyDef {
  id: string;
  label: string;
  description: string;
  levels: OfficeLevel[];
  step: number;
  min: number;
  max: number;
  get(ctx: GameContext, scope: string): number;
  set(ctx: GameContext, scope: string, value: number): void;
  format(value: number): string;
  /** Ideological direction of raising this lever by one step. */
  ideology: Partial<Ideology>;
  /** How each social class feels about a one-step increase (satisfaction points). */
  classes: { lower: number; middle: number; upper: number };
  /** Reputation change for the politician who pushes a one-step increase. */
  reputation: Partial<Record<RepGroup, number>>;
}

export function parseScope(scope: string): { level: OfficeLevel; id: string } {
  const [level, id] = scope.split(":") as [OfficeLevel, string];
  return { level, id };
}

function countryOfScope(ctx: GameContext, scope: string): CountryState {
  const { id } = parseScope(scope);
  const c = ctx.state.world.countries[id];
  if (!c) throw new Error(`No country for scope ${scope}`);
  return c;
}

function local(ctx: GameContext, scope: string): LocalPolicies {
  const all = ctx.state.politics.localPolicies;
  all[scope] ??= defaultLocalPolicies();
  return all[scope]!;
}

const pct = (v: number) => formatPercent(v, 0);

function nationalLever(
  id: string,
  label: string,
  description: string,
  step: number,
  min: number,
  max: number,
  get: (c: CountryState) => number,
  set: (c: CountryState, v: number) => void,
  format: (v: number) => string,
  ideology: Partial<Ideology>,
  classes: PolicyDef["classes"],
  reputation: PolicyDef["reputation"],
): PolicyDef {
  return {
    id,
    label,
    description,
    levels: ["national"],
    step,
    min,
    max,
    get: (ctx, scope) => get(countryOfScope(ctx, scope)),
    set: (ctx, scope, v) => set(countryOfScope(ctx, scope), v),
    format,
    ideology,
    classes,
    reputation,
  };
}

function localLever(
  key: keyof LocalPolicies,
  label: string,
  description: string,
  step: number,
  min: number,
  max: number,
  format: (v: number) => string,
  ideology: Partial<Ideology>,
  classes: PolicyDef["classes"],
  reputation: PolicyDef["reputation"],
): PolicyDef {
  return {
    id: key,
    label,
    description,
    levels: ["city", "region"],
    step,
    min,
    max,
    get: (ctx, scope) => local(ctx, scope)[key],
    set: (ctx, scope, v) => {
      local(ctx, scope)[key] = v;
    },
    format,
    ideology,
    classes,
    reputation,
  };
}

export const POLICIES: PolicyDef[] = [
  nationalLever(
    "incomeTax",
    "Income tax",
    "Average income tax rate. Funds the government; workers and the rich feel it.",
    0.02,
    0,
    0.5,
    (c) => c.taxes.income,
    (c, v) => (c.taxes.income = v),
    pct,
    { economic: -0.3 },
    { lower: -1, middle: -2, upper: -4 },
    { business: -1.5, activists: 0.5 },
  ),
  nationalLever(
    "corporateTax",
    "Corporate tax",
    "Tax on company profits.",
    0.02,
    0,
    0.45,
    (c) => c.taxes.corporate,
    (c, v) => (c.taxes.corporate = v),
    pct,
    { economic: -0.4 },
    { lower: 1, middle: 0, upper: -4 },
    { business: -2.5, workers: 1 },
  ),
  nationalLever(
    "salesTax",
    "Sales tax",
    "Tax on everything people buy. Hits the poor hardest.",
    0.01,
    0,
    0.27,
    (c) => c.taxes.sales,
    (c, v) => (c.taxes.sales = v),
    pct,
    { economic: 0.1 },
    { lower: -3, middle: -2, upper: -0.5 },
    { workers: -1 },
  ),
  nationalLever(
    "minimumWage",
    "Minimum wage",
    "Minimum hourly pay, as a share of the median wage.",
    0.05,
    0,
    0.8,
    (c) => Math.round((c.minimumWageCents / Math.max(1, c.medianWageCents)) * 100) / 100,
    (c, v) => (c.minimumWageCents = Math.round(c.medianWageCents * v)),
    (v) => (v === 0 ? "None" : `${pct(v)} of median`),
    { economic: -0.5 },
    { lower: 3, middle: 0.5, upper: -2 },
    { workers: 2, business: -2 },
  ),
  nationalLever(
    "socialServices",
    "Social services",
    "Shelters, food banks and welfare.",
    0.1,
    0.05,
    0.95,
    (c) => c.socialServices,
    (c, v) => (c.socialServices = v),
    pct,
    { economic: -0.4, social: -0.2 },
    { lower: 4, middle: 0, upper: -2 },
    { activists: 1.5, community: 1, business: -0.5 },
  ),
  nationalLever(
    "healthcare",
    "Healthcare system",
    "From pay-as-you-go to insurance to free universal care.",
    1,
    0,
    2,
    (c) => HEALTHCARE_ORDER.indexOf(c.healthcare),
    (c, v) => (c.healthcare = HEALTHCARE_ORDER[v]!),
    (v) => ["Pay out of pocket", "Insurance-based", "Universal"][v] ?? "?",
    { economic: -0.6 },
    { lower: 6, middle: 2, upper: -3 },
    { workers: 2, activists: 2, business: -2 },
  ),
  nationalLever(
    "immigration",
    "Immigration openness",
    "How easy it is to get visas and residency.",
    0.1,
    0.05,
    0.95,
    (c) => c.immigrationOpenness ?? 0.5,
    (c, v) => (c.immigrationOpenness = v),
    pct,
    { nationalism: -0.7, social: -0.3 },
    { lower: -1.5, middle: 0, upper: 1 },
    { business: 1, activists: 1, establishment: -0.5 },
  ),
  nationalLever(
    "policing",
    "Policing and courts",
    "Funding for police and the justice system.",
    0.1,
    0.1,
    1,
    (c) => ruleOfLaw(c),
    (c, v) => (c.ruleOfLaw = v),
    pct,
    { authority: 0.5 },
    { lower: -0.5, middle: 1.5, upper: 2 },
    { establishment: 1.5, underworld: -3, activists: -1 },
  ),
  nationalLever(
    "businessRegulation",
    "Business regulation",
    "Rules on safety, labor and the environment.",
    0.1,
    0,
    1,
    (c) => businessRegulation(c),
    (c, v) => (c.businessRegulation = v),
    pct,
    { economic: -0.4, authority: 0.1 },
    { lower: 1.5, middle: 0.5, upper: -2 },
    { business: -2, activists: 1.5 },
  ),
  localLever(
    "rentControl",
    "Rent control",
    "Caps how fast rents can rise.",
    1,
    0,
    2,
    (v) => ["None", "Moderate", "Strict"][v] ?? "?",
    { economic: -0.5 },
    { lower: 3, middle: 1, upper: -2 },
    { community: 1.5, business: -1.5 },
  ),
  localLever(
    "shelterFunding",
    "Homeless services",
    "Shelter beds and outreach.",
    0.1,
    0,
    1,
    pct,
    { economic: -0.3, social: -0.2 },
    { lower: 2, middle: 0, upper: -0.5 },
    { activists: 1.5, community: 1 },
  ),
  localLever(
    "localMinimumWage",
    "Local minimum wage",
    "A local wage floor above the national one, as a share of the median wage.",
    0.1,
    0,
    0.7,
    (v) => (v === 0 ? "None" : `${pct(v)} of median`),
    { economic: -0.5 },
    { lower: 2.5, middle: 0, upper: -1.5 },
    { workers: 2, business: -2 },
  ),
  localLever(
    "businessTax",
    "Local business tax",
    "An extra local tax on business profits.",
    0.02,
    0,
    0.1,
    pct,
    { economic: -0.3 },
    { lower: 0.5, middle: 0, upper: -1.5 },
    { business: -1.5 },
  ),
  localLever(
    "policing",
    "Local policing",
    "Police presence in the area.",
    0.1,
    0,
    1,
    pct,
    { authority: 0.4 },
    { lower: -0.5, middle: 1, upper: 1.5 },
    { establishment: 1, underworld: -2 },
  ),
];

const byId = new Map(
  POLICIES.map((p) => [`${p.levels.includes("national") ? "n" : "l"}:${p.id}`, p]),
);

export function policyFor(id: string, level: OfficeLevel): PolicyDef | undefined {
  return byId.get(`${level === "national" ? "n" : "l"}:${id}`);
}

export function policiesForLevel(level: OfficeLevel): PolicyDef[] {
  return POLICIES.filter((p) => p.levels.includes(level));
}

/** How strongly an ideology agrees with a policy direction (-1..1). */
export function alignment(ideology: Ideology, policy: PolicyDef, direction: 1 | -1): number {
  let dot = 0;
  let norm = 0;
  for (const [k, v] of Object.entries(policy.ideology) as [keyof Ideology, number][]) {
    dot += ideology[k] * v;
    norm += Math.abs(v);
  }
  return norm === 0 ? 0 : (dot / norm) * direction;
}

/** The effective local value of a lever for a city: the stronger of its city and regional settings. */
export function localPolicy(ctx: GameContext, cityId: CityId, key: keyof LocalPolicies): number {
  const geoCity = ctx.geography.cities[cityId];
  const all = ctx.state.politics?.localPolicies ?? {};
  const city = all[`city:${cityId}`]?.[key];
  const region = geoCity ? all[`region:${geoCity.provinceId}`]?.[key] : undefined;
  const fallback = defaultLocalPolicies()[key];
  if (key === "businessTax") return (city ?? 0) + (region ?? 0);
  return Math.max(city ?? fallback, region ?? (city === undefined ? fallback : 0));
}

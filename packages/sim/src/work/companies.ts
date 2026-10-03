import { LAST_NAMES } from "../character/names";
import type { GameContext } from "../core/game";
import type { Rng } from "../core/rng";
import type { CityId } from "../world/geography";
import type { Company, EconomicPhase } from "../world/types";
import { occupationsInSector, type Sector } from "./occupations";

const SECTOR_NAMES: Record<Sector, string[]> = {
  hospitality: ["Diner", "Grill", "Bistro", "Kitchen", "Café", "Burger Co.", "Eatery", "Taqueria"],
  retail: ["Mart", "Goods", "Outlet", "Market", "Supply", "Store", "Emporium"],
  logistics: ["Logistics", "Freight", "Distribution", "Shipping", "Fulfillment"],
  construction: ["Builders", "Construction", "Contracting", "Homes", "Concrete"],
  agriculture: ["Farms", "Agro", "Harvest Co.", "Orchards", "Growers"],
  manufacturing: ["Manufacturing", "Industries", "Works", "Fabrication", "Plastics", "Steel"],
  office: ["Services", "Solutions", "Partners", "Group", "Associates", "Consulting"],
  healthcare: ["Clinic", "Medical Center", "Care Home", "Hospital", "Health"],
  tech: ["Tech", "Software", "Digital", "Systems", "Labs", "Networks"],
  education: ["Academy", "School", "Learning Center", "College"],
  security: ["Security", "Protection Services", "Guard Co."],
  transport: ["Transport", "Trucking", "Lines", "Express", "Haulage"],
};

const PREFIXES = [
  "Riverside",
  "Summit",
  "Golden",
  "Northstar",
  "Pioneer",
  "Harbor",
  "Metro",
  "Evergreen",
  "Liberty",
  "Cedar",
  "Atlas",
  "Keystone",
  "Silverline",
  "Redwood",
  "Union",
  "Sunrise",
  "Lakeside",
  "Ironwood",
  "Crown",
  "Bluebird",
  "Granite",
  "Maple",
  "Horizon",
  "Westgate",
];

/** How much demand each sector sees in each phase of the business cycle. */
export const PHASE_DEMAND: Record<EconomicPhase, number> = {
  expansion: 1,
  recovery: 0.8,
  recession: 0.55,
};

function companyName(sector: Sector, cityName: string, rng: Rng): string {
  const suffix = rng.pick(SECTOR_NAMES[sector]);
  const style = rng.int(0, 2);
  if (style === 0) return `${rng.pick(PREFIXES)} ${suffix}`;
  if (style === 1) return `${rng.pick(LAST_NAMES)} ${suffix}`;
  return `${cityName} ${suffix}`;
}

function sectorWeights(ctx: GameContext, cityId: CityId): [Sector, number][] {
  const geoCity = ctx.geography.cities[cityId]!;
  const province = ctx.state.world.provinces[geoCity.provinceId]!;
  const dev = ctx.state.world.countries[geoCity.countryId]!.development;
  const has = (r: string) => (province.resources as string[]).includes(r);
  const big = geoCity.importance > 5.5;
  return [
    ["hospitality", 5],
    ["retail", 5],
    ["logistics", 3],
    ["construction", 3],
    ["agriculture", has("farmland") || has("livestock") ? 3 : 0.6],
    ["manufacturing", 1.5 + (dev > 0.3 && dev < 0.8 ? 2 : 0)],
    ["office", 1 + dev * 3 + (big ? 1 : 0)],
    ["healthcare", 1.5 + dev * 1.5],
    ["tech", dev * (big ? 3 : 1)],
    ["education", 1.2],
    ["security", 1.2],
    ["transport", 1.5],
  ];
}

/** Opens new positions for a company based on how strong demand is. */
export function refreshOpenings(company: Company, demand: number, rng: Rng): void {
  company.openings = {};
  for (const occ of occupationsInSector(company.sector)) {
    const base = occ.tier === 0 ? 0.55 : occ.tier === 1 ? 0.3 : 0.15;
    if (rng.chance(base * demand * (0.6 + company.health / 250))) {
      company.openings[occ.id] = occ.tier === 0 ? rng.int(1, 3) : 1;
    }
  }
}

export function createCompany(ctx: GameContext, cityId: CityId, sector: Sector, rng: Rng): Company {
  const geoCity = ctx.geography.cities[cityId]!;
  const world = ctx.state.world;
  const company: Company = {
    id: `c${world.nextCompanyId++}`,
    name: companyName(sector, geoCity.name, rng),
    sector,
    cityId,
    employees: Math.round(Math.exp(rng.normal(Math.log(25), 1.1))) + 2,
    wageFactor: Math.round(rng.float(0.85, 1.25) * 100) / 100,
    health: rng.int(35, 90),
    openings: {},
    foundedAt: ctx.state.time,
  };
  const phase = world.countries[geoCity.countryId]!.economy.phase;
  refreshOpenings(company, PHASE_DEMAND[phase], rng);
  return company;
}

/** Creates the employers of a city the first time the player lives there. */
export function ensureCompanies(ctx: GameContext, cityId: CityId): void {
  const world = ctx.state.world;
  if (world.companyCities.includes(cityId)) return;
  world.companyCities.push(cityId);
  const pop = world.cities[cityId]!.population;
  const count = Math.max(10, Math.min(60, Math.round(6 * Math.log10(Math.max(pop, 1000)) - 8)));
  const weights = sectorWeights(ctx, cityId).filter(([, w]) => w > 0);
  const rng = ctx.rng;
  // Every city gets the everyday employers people can actually get hired at.
  const guaranteed: Sector[] = ["hospitality", "retail", "logistics", "construction"];
  for (let i = 0; i < count; i++) {
    const sector = i < guaranteed.length ? guaranteed[i]! : rng.weighted(weights);
    world.companies.push(createCompany(ctx, cityId, sector, rng));
  }
}

export function companiesIn(ctx: GameContext, cityId: CityId): Company[] {
  return ctx.state.world.companies.filter((c) => c.cityId === cityId);
}

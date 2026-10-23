import type { Sector } from "../work/occupations";
import type { CityId, CountryId, ProvinceId } from "./geography";

/**
 * Dynamic world data that changes during play (unlike WorldGeography, which is the fixed map).
 * Money is always stored in whole cents to avoid floating-point drift.
 */

export type GovernmentType =
  | "democracy"
  | "constitutionalMonarchy"
  | "oligarchy"
  | "oneParty"
  | "militaryJunta"
  | "absoluteMonarchy"
  | "theocracy";

export const GOVERNMENT_LABELS: Record<GovernmentType, string> = {
  democracy: "Democratic Republic",
  constitutionalMonarchy: "Constitutional Monarchy",
  oligarchy: "Oligarchy",
  oneParty: "One-Party State",
  militaryJunta: "Military Junta",
  absoluteMonarchy: "Absolute Monarchy",
  theocracy: "Theocracy",
};

/** Each axis runs from -1 to 1. */
export interface Ideology {
  /** -1 = state-run economy, 1 = free market */
  economic: number;
  /** -1 = progressive, 1 = traditional */
  social: number;
  /** -1 = civil liberties, 1 = authoritarian */
  authority: number;
  /** -1 = internationalist, 1 = nationalist */
  nationalism: number;
}

export interface Party {
  id: string;
  name: string;
  shortName: string;
  ideology: Ideology;
  /** Share of public support, 0–1. Shares within a country sum to 1. */
  popularity: number;
  color: number;
  /** False if the party is banned and operates underground. */
  legal: boolean;
}

export interface Taxes {
  /** Average effective income tax rate, 0–1. */
  income: number;
  corporate: number;
  sales: number;
}

export type EconomicPhase = "expansion" | "recession" | "recovery";

export const PHASE_LABELS: Record<EconomicPhase, string> = {
  expansion: "Growing",
  recession: "Recession",
  recovery: "Recovering",
};

/** Price multipliers for broad categories of goods, relative to the world average. */
export interface GoodsPrices {
  food: number;
  energy: number;
  housing: number;
  goods: number;
}
export type Good = keyof GoodsPrices;

export interface Economy {
  phase: EconomicPhase;
  monthsInPhase: number;
  /** Yearly real GDP growth (0.025 = 2.5%). */
  growth: number;
  /** The unemployment rate the economy settles at in normal times. */
  naturalUnemployment: number;
  /** The inflation rate the economy settles at in normal times. */
  baseInflation: number;
  /** Cumulative price level since the game began (1 = start). */
  priceIndex: number;
  /** Cumulative nominal wage level since the game began (1 = start). */
  wageIndex: number;
  goods: GoodsPrices;
  /** Long-run goods price levels that temporary shocks decay back to. */
  goodsBaseline: GoodsPrices;
}

export type PopClass = "lower" | "middle" | "upper";

/** A large group of people in the same social class, tracked as one unit. */
export interface Pop {
  class: PopClass;
  /** Share of the population, 0–1. */
  share: number;
  /** Average monthly income per person, in cents. */
  incomeCents: number;
  /** 0–100: how well this class is doing. Drives national stability. */
  satisfaction: number;
}

export type Healthcare = "universal" | "insurance" | "none";

export const HEALTHCARE_LABELS: Record<Healthcare, string> = {
  universal: "Universal (free)",
  insurance: "Insurance-based",
  none: "Pay out of pocket",
};

export interface CountryState {
  id: CountryId;
  government: GovernmentType;
  headOfStateTitle: string;
  /** Overall development, 0–1. Drives wealth, institutions and services. */
  development: number;
  population: number;
  /** Yearly GDP per person, in dollars. */
  gdpPerCapita: number;
  /** 0–1 */
  unemployment: number;
  /** Yearly inflation rate (0.03 = 3%). */
  inflation: number;
  /** 0–100 */
  stability: number;
  taxes: Taxes;
  /** Hourly minimum wage in cents; 0 means no minimum wage. */
  minimumWageCents: number;
  medianWageCents: number;
  /** 100 = world average. */
  costOfLivingIndex: number;
  parties: Party[];
  rulingPartyId: string | null;
  /** Political map color. */
  color: number;
  economy: Economy;
  pops: Pop[];
  healthcare: Healthcare;
  /** 0–1: shelters, food banks and welfare available to people in need. */
  socialServices: number;
  /** 0–1: how welcoming immigration policy is (derived from the country when not set). */
  immigrationOpenness?: number;
  /** 0–1: police and courts (defaults from development). */
  ruleOfLaw?: number;
  /** 0–1: rules on business (default 0.5). */
  businessRegulation?: number;
  budget?: { debtCents: number; revenueCents: number; spendingCents: number };
  /** Next national election (countries without detailed offices). */
  nextElection?: number;
  /** Armed forces (derived from the country until first needed). */
  military?: Military;
  /** Budget priorities, projects and economic policy (defaults until a leader changes them). */
  statecraft?: Statecraft;
}

export type BudgetArea =
  "defense" | "healthcare" | "education" | "infrastructure" | "police" | "welfare";

export type ProjectKind =
  "railway" | "port" | "powerPlant" | "university" | "hospitals" | "fortress";

export interface Project {
  id: string;
  kind: ProjectKind;
  provinceId: ProvinceId;
  startedAt: number;
  doneAt: number;
  /** Total cost, paid in monthly installments. */
  costCents: number;
}

export interface Statecraft {
  /** 0–1 per area; 0.5 is normal spending. */
  budget: Record<BudgetArea, number>;
  /** 0–1: share of big industry the state owns. */
  stateOwnership: number;
  /** 0–0.4: average tariff on imports. */
  tariff: number;
  /** Extra yearly growth from finished projects. */
  growthBonus: number;
  projects: Project[];
  /** Provinces with fortifications. */
  forts: ProvinceId[];
  /** Months until markets forgive the last default. */
  defaultRecovery?: number;
}

/** A senior officer. Disloyal generals in an unstable country stage coups. */
export interface General {
  name: string;
  /** 0–1 */
  skill: number;
  /** 0–100 */
  loyalty: number;
}

/** A country's armed forces. */
export interface Military {
  troops: number;
  /** 0–1: equipment and training. */
  quality: number;
  /** 0–1: defense spending chosen by the government (0.5 = normal). */
  spending: number;
  /** 0–1: how far the country has mobilized for war. */
  mobilization: number;
  /** 0–100: how tired the country is of fighting. */
  exhaustion: number;
  /** Tanks and armored vehicles. */
  armor?: number;
  /** Combat aircraft. */
  air?: number;
  /** Warships: needed to land troops across the sea. */
  navy?: number;
  /** Drafting young people: more troops, less quality and goodwill. */
  conscription?: boolean;
  /** 0–1: military technology. */
  tech?: number;
  /** 0–1: research spending (0 = none). */
  research?: number;
  generals?: General[];
}

export type Biome =
  | "polar"
  | "tundra"
  | "boreal"
  | "temperate"
  | "grassland"
  | "mediterranean"
  | "steppe"
  | "desert"
  | "savanna"
  | "tropical"
  | "mountains";

export type Resource =
  | "farmland"
  | "livestock"
  | "timber"
  | "fish"
  | "oil"
  | "gas"
  | "coal"
  | "iron"
  | "copper"
  | "gold"
  | "uranium"
  | "rareEarths";

export interface ProvinceState {
  id: ProvinceId;
  population: number;
  gdpPerCapita: number;
  /** 0–1 */
  urbanization: number;
  biome: Biome;
  /** Ordered from most to least significant. */
  resources: Resource[];
  /** 0–100 */
  stability: number;
}

export interface CityState {
  id: CityId;
  population: number;
  medianWageCents: number;
  /** Monthly rent for a basic one-bedroom apartment, in cents. */
  rentCents: number;
  /** Monthly cost of food, transport and utilities for one person, in cents. */
  livingCostCents: number;
  costOfLivingIndex: number;
}

/** An NPC employer. Companies exist for the city the player lives in. */
export interface Company {
  id: string;
  name: string;
  sector: Sector;
  cityId: CityId;
  employees: number;
  /** Pay relative to the local norm (0.85–1.25). */
  wageFactor: number;
  /** 0–100 financial health. Falling below 0 means bankruptcy. */
  health: number;
  /** Open positions by occupation id. */
  openings: Record<string, number>;
  foundedAt: number;
}

export interface WorldState {
  geographyId: string;
  countries: Record<CountryId, CountryState>;
  companies: Company[];
  /** Cities whose companies have been generated. */
  companyCities: CityId[];
  nextCompanyId: number;
  /** Indexed by ProvinceId. */
  provinces: ProvinceState[];
  /** Indexed by CityId. */
  cities: CityState[];
  /**
   * Provinces that changed hands during play, by province id. The map file keeps the original
   * borders; these overrides are applied on top of it when a game loads (see world/territory.ts).
   */
  provinceOwners?: Record<ProvinceId, CountryId>;
  /** Countries founded during play. */
  foundedCountries?: FoundedCountry[];
  /** Bumped whenever borders change, so the map knows to redraw. */
  territoryVersion?: number;
}

export interface FoundedCountry {
  id: CountryId;
  name: string;
  /** The country it broke away from. */
  parentId: CountryId;
  /** "player", or the id of the insurgency that founded it. */
  founderId: string;
  foundedAt: number;
  capitalCityId: CityId | null;
}

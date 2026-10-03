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
}

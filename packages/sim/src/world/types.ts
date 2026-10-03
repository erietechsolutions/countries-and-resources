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

export interface WorldState {
  geographyId: string;
  countries: Record<CountryId, CountryState>;
  /** Indexed by ProvinceId. */
  provinces: ProvinceState[];
  /** Indexed by CityId. */
  cities: CityState[];
}

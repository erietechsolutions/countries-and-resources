import type { GameTime } from "../core/calendar";
import type { CityId, CountryId } from "../world/geography";
import type { Resource } from "../world/types";

/** World markets: one stock index per country and a price for each commodity. */
export interface MarketsState {
  /** 100 = level when the game began. */
  indexes: Record<CountryId, number>;
  /** 1 = long-run average price. */
  commodities: Record<Resource, number>;
  /** Last month's change, for the UI (0.02 = +2%). */
  lastChange: Record<string, number>;
  /** The richest people in the world (not counting the player). */
  richList: { name: string; countryId: CountryId; netWorthCents: number }[];
}

export type HoldingKind = "stocks" | "bonds" | "commodity";

export interface Holding {
  id: string;
  kind: HoldingKind;
  /** A country id (stocks, bonds) or a resource (commodities). */
  target: string;
  units: number;
  /** What the units cost in total, for capital gains. */
  costCents: number;
}

export type PropertyKind = "apartment" | "house" | "commercial";

export interface Mortgage {
  balanceCents: number;
  monthlyCents: number;
  /** Yearly interest rate. */
  rate: number;
}

export interface Property {
  id: string;
  kind: PropertyKind;
  cityId: CityId;
  purchasePriceCents: number;
  /** The city's rent level at purchase: values move with local rents. */
  basisRentCents: number;
  renovated: boolean;
  rentedOut: boolean;
  /** Months the current tenant has left before the unit may sit empty. */
  vacant: boolean;
  mortgage: Mortgage | null;
  boughtAt: GameTime;
}

export interface MediaOutlet {
  id: string;
  name: string;
  countryId: CountryId;
  /** The party the outlet's coverage favors, if any. */
  partyId: string | null;
  priceCents: number;
}

export interface WealthState {
  savingsCents: number;
  /** Money in an offshore account: out of reach of taxes and courts, but a secret. */
  offshoreCents: number;
  holdings: Holding[];
  properties: Property[];
  media: MediaOutlet[];
  /** Net worth milestones already celebrated (in dollars). */
  milestones: number[];
  nextId: number;
}

export function emptyWealth(): WealthState {
  return {
    savingsCents: 0,
    offshoreCents: 0,
    holdings: [],
    properties: [],
    media: [],
    milestones: [],
    nextId: 1,
  };
}
